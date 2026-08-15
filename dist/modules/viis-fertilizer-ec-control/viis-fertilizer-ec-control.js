"use strict";
/**
 * viis-fertilizer-ec-control
 *
 * Node-RED custom node for intelligent EC-based fertilizer control.
 *
 * Control Strategy:
 * - Feedforward: Lookup table predicts valve times before start
 * - Open-loop: PLC pulses valves per cycle_EC (e.g., 10 = 6s cycle)
 * - Learning: Post-run EC averaging updates lookup table for next run
 *
 * Features:
 * - Lookup table interpolation for valve time prediction
 * - Real-time context window (20s ramp-up, then averaging)
 * - Post-run adaptive learning (weighted average)
 * - Local MySQL storage for offline operation
 * - Backend API sync for machine learning
 *
 * Inputs:
 *   msg.action: 'start' | 'stop' | 'getValveTimes' | 'status' | 'sync'
 *   msg.ec_setpoint: Target EC value (e.g., 1.8)
 *   msg.schedule_name: Optional schedule reference
 *   msg.readings: Optional sensor readings for context window
 *
 * Outputs:
 *   Output 1: Modbus write commands (initial valve times only)
 *   Output 2: Status/telemetry
 *   Output 3: Errors
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const services_1 = require("./services");
const constants_1 = require("./constants");
const ModbusRegisterHelper_1 = require("./utils/ModbusRegisterHelper");
const viis_telemetry_constants_1 = require("../viis-telemetry/viis-telemetry-constants");
module.exports = function (RED) {
    function ViisFertilizerEcControlNode(config) {
        var _a;
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext = this.context();
        const globalContext = this.context().global;
        // Initialize GlobalContextHelper
        const globalHelper = new global_context_helper_1.GlobalContextHelper(nodeContext);
        // Get device ID
        const deviceId = globalHelper.getEnvVar('DEVICE_ID', '');
        if (!deviceId) {
            node.error('DEVICE_ID not configured in environment');
            node.status({ fill: 'red', shape: 'ring', text: 'No DEVICE_ID' });
            return;
        }
        // Configuration from environment only - all EC params from global context
        const rampUpSeconds = globalHelper.getNumericEnvVar('FERTILIZER_RAMP_UP_SECONDS', constants_1.EC_CONTROL_DEFAULTS.RAMP_UP_SECONDS);
        const adjustmentStep = globalHelper.getNumericEnvVar('FERTILIZER_ADJUSTMENT_STEP', constants_1.EC_CONTROL_DEFAULTS.ADJUSTMENT_STEP);
        const adjustmentThreshold = globalHelper.getNumericEnvVar('FERTILIZER_ADJUSTMENT_THRESHOLD', constants_1.EC_CONTROL_DEFAULTS.ADJUSTMENT_THRESHOLD);
        const maxValveTime = globalHelper.getNumericEnvVar('FERTILIZER_MAX_VALVE_TIME', constants_1.EC_CONTROL_DEFAULTS.MAX_VALVE_TIME);
        const debugEnable = (_a = config.debugEnable) !== null && _a !== void 0 ? _a : false;
        // RTU-specific delays
        const rtuInterWriteDelay = globalHelper.getNumericEnvVar('FERTILIZER_RTU_INTER_WRITE_DELAY', constants_1.EC_CONTROL_DEFAULTS.RTU_INTER_WRITE_DELAY);
        const rtuWriteSettleDelay = globalHelper.getNumericEnvVar('FERTILIZER_RTU_WRITE_SETTLE_DELAY', constants_1.EC_CONTROL_DEFAULTS.RTU_WRITE_SETTLE_DELAY);
        // Multi-board Modbus config
        let currentBoardId = config.boardId;
        let isMultiBoardMode = false;
        let currentModbusConfig = null;
        // Modbus register helper for dynamic address lookup
        const modbusHelper = new ModbusRegisterHelper_1.ModbusRegisterHelper(node, nodeContext, currentBoardId || 'board1');
        // Services
        let lookupService;
        let contextService;
        let runService;
        let syncService;
        // State
        let controlContext = {
            state: 'IDLE',
            ecBuffer: [],
            flowBuffers: { flow_1: [], flow_2: [], flow_3: [], flow_4: [], flow_5: [] },
            currentValveTimes: { time_on_valve_01: 0, time_on_valve_02: 0, time_on_valve_03: 0, time_on_valve_04: 0, time_on_valve_05: 0 },
            targetEc: 0,
        };
        let pollingInterval = null;
        let servicesInitialized = false;
        let isPolling = false; // Race condition guard
        // Debug logging helper
        const debugLog = (message) => {
            if (debugEnable) {
                node.warn(`[DEBUG] ${message}`);
            }
        };
        // Note: All EC control parameters read from global.holdingRegisterData
        debugLog('EC Control: All parameters read from global.holdingRegisterData (cycle_ec, set_ec, time_on_valve_XX)');
        // Initialize services
        async function initializeServices() {
            try {
                debugLog('Starting service initialization...');
                // Initialize lookup table service
                lookupService = new services_1.LookupTableService(node, deviceId);
                await lookupService.initialize(nodeContext);
                debugLog('✓ Lookup table service initialized');
                // Initialize context window service
                contextService = new services_1.ContextWindowService(node, {
                    windowSize: constants_1.EC_CONTROL_DEFAULTS.CONTEXT_WINDOW_SIZE,
                    adjustmentThreshold,
                    adjustmentStep,
                    maxValveTime,
                });
                debugLog('✓ Context window service initialized');
                // Initialize irrigation run service
                runService = new services_1.IrrigationRunService(node, deviceId);
                await runService.initialize(nodeContext);
                debugLog('✓ Irrigation run service initialized');
                // Initialize backend sync service
                syncService = new services_1.BackendSyncService(node, deviceId, globalHelper);
                debugLog('✓ Backend sync service initialized');
                // Clean up any stale runs from power outage
                await runService.cleanupStaleRuns();
                debugLog('✓ Cleaned up stale runs');
                servicesInitialized = true;
                debugLog('All services initialized successfully');
                node.status({ fill: 'green', shape: 'dot', text: 'Ready' });
                return true;
            }
            catch (error) {
                node.error(`Failed to initialize services: ${error.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Init failed' });
                servicesInitialized = false;
                return false;
            }
        }
        // Read Modbus config from global context
        function readModbusConfig() {
            const boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);
            if (boardsConfig) {
                try {
                    let boards = Array.isArray(boardsConfig)
                        ? boardsConfig
                        : JSON.parse(boardsConfig);
                    if (Array.isArray(boards) && boards.length > 0) {
                        isMultiBoardMode = true;
                        const defaultBoard = globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id);
                        currentBoardId = currentBoardId || defaultBoard;
                        const board = boards.find((b) => b.id === currentBoardId) || boards[0];
                        return {
                            host: board.host,
                            tcpPort: board.tcpPort || 502,
                            type: board.type || 'TCP',
                            unitId: board.unitId || 1,
                            serialPort: board.serialPort,
                            baudRate: board.baudRate,
                        };
                    }
                }
                catch (e) {
                    node.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                }
            }
            return null;
        }
        // Get Modbus client using ClientRegistry
        async function getModbusClient() {
            if (isMultiBoardMode && currentBoardId) {
                // Use multi-board API
                return await client_registry_1.default.getModbusClientV2(currentBoardId, node);
            }
            else {
                // Fall back to single-board mode
                const config = readModbusConfig();
                if (!config) {
                    throw new Error('No Modbus configuration available');
                }
                currentModbusConfig = config;
                return await client_registry_1.default.getModbusClient(config, node);
            }
        }
        // Check if using RTU connection
        function isRtuMode() {
            if ((currentModbusConfig === null || currentModbusConfig === void 0 ? void 0 : currentModbusConfig.type) === 'RTU')
                return true;
            if (isMultiBoardMode && currentBoardId) {
                const boards = globalHelper.getEnvVar('MODBUS_BOARDS', null);
                if (boards) {
                    try {
                        const boardsArray = Array.isArray(boards) ? boards : JSON.parse(boards);
                        const board = boardsArray.find((b) => b.id === currentBoardId);
                        return (board === null || board === void 0 ? void 0 : board.type) === 'RTU';
                    }
                    catch (e) {
                        return false;
                    }
                }
            }
            return false;
        }
        // Get appropriate polling interval based on connection type
        function getPollingInterval() {
            const isRtu = isRtuMode();
            const defaultInterval = isRtu ? constants_1.EC_CONTROL_DEFAULTS.POLLING_INTERVAL_RTU : constants_1.EC_CONTROL_DEFAULTS.POLLING_INTERVAL;
            const envInterval = globalHelper.getNumericEnvVar('FERTILIZER_POLLING_INTERVAL', defaultInterval);
            if (isRtu && envInterval < 1500) {
                node.warn(`RTU polling interval ${envInterval}ms is too aggressive. Using minimum 1500ms to prevent bus overload.`);
                return 1500;
            }
            return envInterval;
        }
        // RTU-safe delay helper
        async function rtuDelay(ms) {
            if (!isRtuMode())
                return; // No delay for TCP
            await new Promise(resolve => setTimeout(resolve, ms));
        }
        // Validate valve times are within safe boundaries
        function validateValveTimes(valveTimes) {
            const errors = [];
            const entries = Object.entries(valveTimes);
            for (const [key, value] of entries) {
                if (value < 0) {
                    errors.push(`${key} is negative: ${value}`);
                }
                else if (value > maxValveTime) {
                    errors.push(`${key} exceeds max (${maxValveTime}ms): ${value}`);
                }
            }
            return { valid: errors.length === 0, errors };
        }
        // Write valve times to Modbus
        async function writeValveTimes(valveTimes) {
            try {
                // Validate before writing
                const validation = validateValveTimes(valveTimes);
                if (!validation.valid) {
                    node.error(`Valve time validation failed: ${validation.errors.join(', ')}`);
                    return false;
                }
                const client = await getModbusClient();
                // Get addresses from global context
                const addr01 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_01);
                const addr02 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_02);
                const addr03 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_03);
                const addr04 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_04);
                const addr05 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_05);
                // Write time_on_valve_01-05 with RTU-safe delays
                await client.writeRegister(addr01, valveTimes.time_on_valve_01);
                await rtuDelay(rtuInterWriteDelay);
                await client.writeRegister(addr02, valveTimes.time_on_valve_02);
                await rtuDelay(rtuInterWriteDelay);
                await client.writeRegister(addr03, valveTimes.time_on_valve_03);
                await rtuDelay(rtuInterWriteDelay);
                await client.writeRegister(addr04, valveTimes.time_on_valve_04);
                await rtuDelay(rtuInterWriteDelay);
                await client.writeRegister(addr05, valveTimes.time_on_valve_05);
                await rtuDelay(rtuWriteSettleDelay); // Final settle delay
                debugLog(`Wrote valve times: ${JSON.stringify(valveTimes)} ${isRtuMode() ? '(RTU mode with delays)' : ''}`);
                return true;
            }
            catch (error) {
                node.error(`Failed to write valve times: ${error.message}`);
                return false;
            }
        }
        // Read sensor values from global context (populated by polling flow)
        // This avoids RTU bus contention by reusing existing polling data
        async function readSensors() {
            var _a, _b, _c, _d, _e;
            try {
                // Read from global context instead of direct Modbus polling
                let holdingData = globalContext.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA);
                // Handle multi-board structure: {board1: {...}, board2: {...}}
                if (holdingData && currentBoardId && holdingData[currentBoardId]) {
                    holdingData = holdingData[currentBoardId];
                }
                if (!holdingData) {
                    debugLog('No holding register data in global context. Waiting for polling flow...');
                    return null;
                }
                // Check data freshness (support both 'ts' and 'timestamp' fields)
                const timestamp = holdingData.ts || holdingData.timestamp || 0;
                const dataAge = Date.now() - timestamp;
                const maxAge = globalHelper.getNumericEnvVar('FERTILIZER_GLOBAL_DATA_MAX_AGE', constants_1.EC_CONTROL_DEFAULTS.GLOBAL_DATA_MAX_AGE);
                if (timestamp === 0) {
                    debugLog('Global context data has no timestamp. Using anyway...');
                }
                else if (dataAge > maxAge) {
                    node.warn(`Global context data is stale (${dataAge}ms old, max ${maxAge}ms). Polling flow may be stopped.`);
                    return null;
                }
                // Map keys from global context (already scaled by polling flow)
                // Note: Polling flow may scale current_ec by /1000 or /10 depending on config
                const currentEc = holdingData.current_ec;
                const currentFlow1 = (_a = holdingData.current_flow_1) !== null && _a !== void 0 ? _a : 0;
                const currentFlow2 = (_b = holdingData.current_flow_2) !== null && _b !== void 0 ? _b : 0;
                const currentFlow3 = (_c = holdingData.current_flow_3) !== null && _c !== void 0 ? _c : 0;
                const currentFlow4 = (_d = holdingData.current_flow_4) !== null && _d !== void 0 ? _d : 0;
                const currentFlow5 = (_e = holdingData.current_flow_5) !== null && _e !== void 0 ? _e : 0;
                if (currentEc === undefined || currentEc === null) {
                    debugLog('current_ec not found in global context data');
                    return null;
                }
                // Warn if EC is 0 (sensor might be disconnected)
                if (currentEc === 0) {
                    node.warn('⚠️ current_ec = 0. Check sensor connection or wait for first reading.');
                }
                const readings = {
                    current_ec: Number(currentEc),
                    current_flow_1: Number(currentFlow1),
                    current_flow_2: Number(currentFlow2),
                    current_flow_3: Number(currentFlow3),
                    current_flow_4: Number(currentFlow4),
                    current_flow_5: Number(currentFlow5),
                };
                debugLog(`Read from global context (age: ${timestamp ? dataAge + 'ms' : 'no timestamp'}): EC=${readings.current_ec}`);
                return readings;
            }
            catch (error) {
                node.error(`Failed to read sensors from global context: ${error.message}`);
                return null;
            }
        }
        // Get current EC setpoint from Modbus holding registers via global context
        // This prioritizes live config data over input message
        function getEcSetpointFromRegisters() {
            try {
                let holdingData = globalContext.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA);
                // Handle multi-board structure
                if (holdingData && currentBoardId && holdingData[currentBoardId]) {
                    holdingData = holdingData[currentBoardId];
                }
                if (!holdingData || !holdingData.set_ec) {
                    return null;
                }
                // Global context already contains scaled value (polling node divided by 1000)
                return Number(holdingData.set_ec);
            }
            catch (error) {
                debugLog(`Failed to read set_ec from registers: ${error.message}`);
                return null;
            }
        }
        // Get valve times from Modbus holding registers via global context
        // Used when lookup table has no data (manual user set via RPC)
        function getValveTimesFromRegisters(defaults) {
            try {
                let holdingData = globalContext.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA);
                // Handle multi-board structure
                if (holdingData && currentBoardId && holdingData[currentBoardId]) {
                    holdingData = holdingData[currentBoardId];
                }
                if (!holdingData) {
                    return null;
                }
                const v01 = holdingData.time_on_valve_01;
                const v02 = holdingData.time_on_valve_02;
                const v03 = holdingData.time_on_valve_03;
                const v04 = holdingData.time_on_valve_04;
                const v05 = holdingData.time_on_valve_05;
                const hasAny = [v01, v02, v03, v04, v05].some(v => typeof v === 'number');
                if (!hasAny) {
                    return null;
                }
                return {
                    time_on_valve_01: typeof v01 === 'number' ? Number(v01) : defaults.time_on_valve_01,
                    time_on_valve_02: typeof v02 === 'number' ? Number(v02) : defaults.time_on_valve_02,
                    time_on_valve_03: typeof v03 === 'number' ? Number(v03) : defaults.time_on_valve_03,
                    time_on_valve_04: typeof v04 === 'number' ? Number(v04) : defaults.time_on_valve_04,
                    time_on_valve_05: typeof v05 === 'number' ? Number(v05) : defaults.time_on_valve_05,
                };
            }
            catch (error) {
                debugLog(`Failed to read time_on_valve_XX from registers: ${error.message}`);
                return null;
            }
        }
        // Set control mode to EC
        async function setEcControlMode(ecSetpoint) {
            try {
                const client = await getModbusClient();
                // Get addresses from global context
                const addrControlMode = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CONTROL_MODE);
                const addrSetEc = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.SET_EC);
                // Set control_mode = 2 (EC mode)
                await client.writeRegister(addrControlMode, constants_1.CONTROL_MODES.EC);
                await rtuDelay(rtuInterWriteDelay);
                // Set EC setpoint (scale by factor)
                await client.writeRegister(addrSetEc, Math.round(ecSetpoint * constants_1.EC_CONTROL_DEFAULTS.EC_SCALE_FACTOR));
                await rtuDelay(rtuWriteSettleDelay);
                debugLog(`Set EC control mode: setpoint=${ecSetpoint}`);
                return true;
            }
            catch (error) {
                node.error(`Failed to set EC control mode: ${error.message}`);
                return false;
            }
        }
        // Start irrigation
        async function startIrrigation(ecSetpoint, scheduleName) {
            if (controlContext.state !== 'IDLE') {
                node.warn(`Cannot start: already in state ${controlContext.state}`);
                return;
            }
            controlContext.state = 'STARTING';
            controlContext.targetEc = ecSetpoint;
            node.status({ fill: 'yellow', shape: 'dot', text: `Starting EC=${ecSetpoint}` });
            try {
                // Get valve times from lookup table
                const interpolation = await lookupService.getValveTimesForEc(ecSetpoint);
                let selectedValveTimes = interpolation.valveTimes;
                // If lookup table is empty, allow manual user-set valve times from registers
                if (interpolation.confidence === 'default') {
                    const manualValveTimes = getValveTimesFromRegisters(interpolation.valveTimes);
                    if (manualValveTimes) {
                        selectedValveTimes = manualValveTimes;
                        debugLog(`Lookup empty. Using valve times from registers: ${JSON.stringify(manualValveTimes)}`);
                    }
                }
                controlContext.currentValveTimes = selectedValveTimes;
                debugLog(`Interpolation result: ${interpolation.confidence}, valves: ${JSON.stringify(selectedValveTimes)}`);
                // Write valve times to Modbus
                const writeSuccess = await writeValveTimes(selectedValveTimes);
                if (!writeSuccess) {
                    throw new Error('Failed to write valve times');
                }
                // Set EC control mode
                const modeSuccess = await setEcControlMode(ecSetpoint);
                if (!modeSuccess) {
                    throw new Error('Failed to set EC control mode');
                }
                // Start irrigation run tracking
                const run = await runService.startRun({
                    ecSetpoint,
                    valveTimes: selectedValveTimes,
                    scheduleName,
                });
                controlContext.currentRun = run;
                // Start context window
                contextService.startRun(rampUpSeconds);
                // Start polling for sensor readings
                startPolling();
                controlContext.state = 'RAMPING_UP';
                node.status({ fill: 'blue', shape: 'dot', text: `Ramp-up EC=${ecSetpoint}` });
                // Send output (Modbus writes already completed internally)
                sendOutput(1, {
                    topic: 'fertilizer/started',
                    payload: {
                        action: 'started',
                        success: true,
                        data: {
                            runId: run.id,
                            ecSetpoint,
                            valveTimes: interpolation.valveTimes,
                            confidence: interpolation.confidence,
                        },
                    },
                });
            }
            catch (error) {
                controlContext.state = 'ERROR';
                node.error(`Failed to start irrigation: ${error.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Start failed' });
                sendOutput(3, {
                    topic: 'fertilizer/error',
                    payload: {
                        action: 'start',
                        success: false,
                        error: error.message,
                    },
                });
            }
        }
        // Stop irrigation
        async function stopIrrigation(reason = 'user') {
            var _a;
            if (controlContext.state === 'IDLE') {
                return;
            }
            controlContext.state = 'STOPPING';
            node.status({ fill: 'yellow', shape: 'ring', text: 'Stopping...' });
            // Stop polling
            stopPolling();
            // Get final averages from context window
            const stats = contextService.getStats();
            try {
                if ((_a = controlContext.currentRun) === null || _a === void 0 ? void 0 : _a.id) {
                    if (reason === 'complete' || reason === 'user') {
                        // Complete the run
                        await runService.completeRun({
                            runId: controlContext.currentRun.id,
                            ecAchievedAvg: stats.avgEc,
                            flowAverages: stats.flowAverages,
                        });
                        // Update lookup table with run data
                        if (stats.sampleCount > 0) {
                            await lookupService.updateWithRunData(controlContext.targetEc, stats.avgEc, controlContext.currentValveTimes, stats.flowAverages);
                        }
                        // Try to sync to backend
                        try {
                            const updatedRun = await runService.getRunById(controlContext.currentRun.id);
                            if (updatedRun) {
                                const synced = await syncService.reportIrrigationFinished(updatedRun);
                                if (synced) {
                                    await runService.markAsSynced(controlContext.currentRun.id);
                                    // ✅ NEW: Fetch updated lookup table from backend
                                    // Backend has learned from this irrigation + aggregated data from other devices
                                    try {
                                        const updatedLookupTable = await syncService.fetchLookupTable();
                                        if (updatedLookupTable && updatedLookupTable.length > 0) {
                                            // Merge with local lookup table
                                            for (const point of updatedLookupTable) {
                                                await lookupService.updateOrCreateFromServer(point);
                                            }
                                            node.log(`✅ Synced ${updatedLookupTable.length} lookup points from backend`);
                                        }
                                    }
                                    catch (syncTableError) {
                                        node.warn(`⚠️ Failed to sync lookup table (will use local): ${syncTableError.message}`);
                                    }
                                }
                            }
                        }
                        catch (syncError) {
                            debugLog(`Sync failed, will retry later: ${syncError.message}`);
                        }
                    }
                    else if (reason === 'error') {
                        await runService.failRun({
                            runId: controlContext.currentRun.id,
                            errorCode: constants_1.ERROR_CODES.MODBUS_ERROR,
                        });
                    }
                }
                // No need to reset control_mode - let RPC control or user manage PLC state
            }
            catch (error) {
                node.error(`Error during stop: ${error.message}`);
            }
            // Reset state
            controlContext.state = 'IDLE';
            controlContext.currentRun = undefined;
            contextService.reset();
            node.status({ fill: 'green', shape: 'dot', text: 'Ready' });
            sendOutput(2, {
                topic: 'fertilizer/stopped',
                payload: {
                    action: 'stopped',
                    success: true,
                    data: {
                        reason,
                        stats,
                    },
                },
            });
        }
        // Polling for sensor readings during run
        function startPolling() {
            if (pollingInterval || isPolling)
                return;
            isPolling = true;
            pollingInterval = setInterval(async () => {
                // Double-check state and polling flag to prevent race condition
                if (!isPolling || (controlContext.state !== 'RAMPING_UP' && controlContext.state !== 'RUNNING')) {
                    stopPolling();
                    return;
                }
                const readings = await readSensors();
                if (!readings)
                    return;
                // Add to context window
                const added = contextService.addSample(readings);
                // Check if ramp-up is complete
                if (controlContext.state === 'RAMPING_UP' && contextService.isRampUpComplete()) {
                    controlContext.state = 'RUNNING';
                    node.status({ fill: 'green', shape: 'dot', text: `Running EC=${controlContext.targetEc}` });
                }
                // If running, monitor EC deviation for telemetry (no real-time adjustment)
                // PLC handles open-loop control via cycle_EC - no Modbus writes during run
                if (controlContext.state === 'RUNNING' && added) {
                    const deviation = contextService.getEcDeviation(controlContext.targetEc);
                    // Log significant deviations for monitoring
                    if (Math.abs(deviation.deviation) > adjustmentThreshold) {
                        debugLog(`EC deviation: ${deviation.deviation.toFixed(3)} mS/cm (target: ${controlContext.targetEc}, actual: ${deviation.avgEc.toFixed(2)})`);
                    }
                }
                // Send telemetry
                const stats = contextService.getStats();
                sendOutput(2, {
                    topic: 'fertilizer/telemetry',
                    payload: {
                        action: 'telemetry',
                        success: true,
                        data: {
                            readings,
                            stats,
                            state: controlContext.state,
                        },
                    },
                });
            }, getPollingInterval());
        }
        function stopPolling() {
            isPolling = false; // Set flag first
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        }
        // Generate Modbus write commands
        function getModbusWrites(valveTimes, ecSetpoint) {
            return [
                { register: 'control_mode', value: constants_1.CONTROL_MODES.EC, address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CONTROL_MODE) },
                { register: 'set_ec', value: Math.round(ecSetpoint * constants_1.EC_CONTROL_DEFAULTS.EC_SCALE_FACTOR), address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.SET_EC) },
                { register: 'time_on_valve_01', value: valveTimes.time_on_valve_01, address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_01) },
                { register: 'time_on_valve_02', value: valveTimes.time_on_valve_02, address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_02) },
                { register: 'time_on_valve_03', value: valveTimes.time_on_valve_03, address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_03) },
                { register: 'time_on_valve_04', value: valveTimes.time_on_valve_04, address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_04) },
                { register: 'time_on_valve_05', value: valveTimes.time_on_valve_05, address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_05) },
            ];
        }
        // Send output message
        function sendOutput(outputIndex, msg) {
            const outputs = [null, null, null];
            outputs[outputIndex - 1] = msg;
            node.send(outputs);
        }
        // Handle input messages
        node.on('input', async (msg) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            if (!servicesInitialized) {
                debugLog('Services not initialized yet, skipping input');
                return;
            }
            const input = msg;
            const action = input.action || ((_a = msg.payload) === null || _a === void 0 ? void 0 : _a.action);
            // Auto-check mode: Interval inject without action triggers status monitoring
            if (!action || action === 'check') {
                try {
                    // Read power and iri_time from Modbus registers
                    const client = await getModbusClient();
                    const powerAddr = modbusHelper.getCoilAddress(constants_1.MODBUS_COIL_KEYS.POWER);
                    const iriTimeAddr = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.IRI_TIME);
                    if (powerAddr === undefined || iriTimeAddr === undefined) {
                        debugLog('Power or IRI_TIME register not configured');
                        return;
                    }
                    const [powerValue, iriTimeValue] = await Promise.all([
                        client.readCoils(powerAddr, 1),
                        client.readHoldingRegisters(iriTimeAddr, 1)
                    ]);
                    const isPowerOn = Boolean(powerValue.data[0]);
                    const iriTime = Number(iriTimeValue.data[0]);
                    const currentState = controlContext.state;
                    debugLog(`Auto-check: power=${isPowerOn}, iri_time=${iriTime}, state=${currentState}`);
                    // Auto-start if power ON, iri_time > 0, and currently IDLE
                    if (isPowerOn && iriTime > 0 && currentState === 'IDLE') {
                        const ecSetpoint = getEcSetpointFromRegisters();
                        if (ecSetpoint && ecSetpoint > 0) {
                            debugLog(`Auto-starting: power ON, iri_time=${iriTime}, ec=${ecSetpoint}`);
                            await startIrrigation(ecSetpoint, undefined); // No schedule name for auto-start
                        }
                        else {
                            debugLog('Auto-start skipped: invalid EC setpoint');
                        }
                    }
                    // Auto-stop if power OFF or iri_time=0, and currently running
                    else if ((!isPowerOn || iriTime === 0) && currentState !== 'IDLE') {
                        debugLog(`Auto-stopping: power=${isPowerOn}, iri_time=${iriTime}`);
                        await stopIrrigation('complete');
                    }
                    return; // Exit after auto-check
                }
                catch (error) {
                    node.error(`Auto-check failed: ${error.message}`);
                    return;
                }
            }
            switch (action) {
                case 'start':
                    // Priority 1: Read from current Modbus holding registers (live config)
                    let ecSetpoint = getEcSetpointFromRegisters();
                    // Priority 2: Use input message if register read failed
                    if (ecSetpoint === null) {
                        ecSetpoint = (_b = input.ec_setpoint) !== null && _b !== void 0 ? _b : (_c = msg.payload) === null || _c === void 0 ? void 0 : _c.ec_setpoint;
                    }
                    if (typeof ecSetpoint !== 'number' || ecSetpoint <= 0) {
                        node.error(`Invalid ec_setpoint: from registers=${getEcSetpointFromRegisters()}, from input=${(_d = input.ec_setpoint) !== null && _d !== void 0 ? _d : (_e = msg.payload) === null || _e === void 0 ? void 0 : _e.ec_setpoint}`);
                        return;
                    }
                    debugLog(`Starting irrigation with EC setpoint: ${ecSetpoint} (source: ${getEcSetpointFromRegisters() !== null ? 'registers' : 'input'})`);
                    await startIrrigation(ecSetpoint, input.schedule_name);
                    break;
                case 'stop':
                    await stopIrrigation('user');
                    break;
                case 'getValveTimes':
                    const targetEc = (_f = input.ec_setpoint) !== null && _f !== void 0 ? _f : (_g = msg.payload) === null || _g === void 0 ? void 0 : _g.ec_setpoint;
                    if (typeof targetEc !== 'number') {
                        node.error('Invalid ec_setpoint for getValveTimes');
                        return;
                    }
                    const result = await lookupService.getValveTimesForEc(targetEc);
                    sendOutput(1, {
                        topic: 'fertilizer/valveTimes',
                        payload: {
                            action: 'getValveTimes',
                            success: true,
                            data: result,
                        },
                        valve_times: result.valveTimes,
                    });
                    break;
                case 'status':
                    const stats = contextService.getStats();
                    sendOutput(2, {
                        topic: 'fertilizer/status',
                        payload: {
                            action: 'status',
                            success: true,
                            data: {
                                state: controlContext.state,
                                targetEc: controlContext.targetEc,
                                currentValveTimes: controlContext.currentValveTimes,
                                runId: (_h = controlContext.currentRun) === null || _h === void 0 ? void 0 : _h.id,
                                stats,
                            },
                        },
                    });
                    break;
                case 'sync':
                    try {
                        const unsyncedRuns = await runService.getUnsyncedRuns();
                        const syncedIds = await syncService.syncPendingRuns(unsyncedRuns);
                        for (const id of syncedIds) {
                            await runService.markAsSynced(id);
                        }
                        sendOutput(2, {
                            topic: 'fertilizer/synced',
                            payload: {
                                action: 'sync',
                                success: true,
                                data: { syncedCount: syncedIds.length },
                            },
                        });
                    }
                    catch (error) {
                        sendOutput(3, {
                            topic: 'fertilizer/error',
                            payload: {
                                action: 'sync',
                                success: false,
                                error: error.message,
                            },
                        });
                    }
                    break;
                case 'readings':
                    // Manual sensor readings injection (for testing)
                    if (input.payload && controlContext.state !== 'IDLE') {
                        contextService.addSample(input.payload);
                    }
                    break;
                default:
                    node.warn(`Unknown action: ${action}`);
            }
        });
        // Cleanup on close
        node.on('close', async (done) => {
            stopPolling();
            // Stop any running irrigation
            if (controlContext.state !== 'IDLE') {
                await stopIrrigation('user');
            }
            // Release database connections
            if (lookupService)
                await lookupService.destroy();
            if (runService)
                await runService.destroy();
            // Release Modbus client
            if (currentBoardId) {
                client_registry_1.default.releaseClientV2('modbus-board', node, currentBoardId);
            }
            else {
                client_registry_1.default.releaseClient('modbus', node);
            }
            done();
        });
        // Initialize on startup
        (async () => {
            node.status({ fill: 'yellow', shape: 'ring', text: 'Initializing...' });
            await initializeServices();
        })();
    }
    RED.nodes.registerType('viis-fertilizer-ec-control', ViisFertilizerEcControlNode);
};

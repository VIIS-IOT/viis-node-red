"use strict";
/**
 * viis-fertilizer-ec-control
 *
 * Node-RED custom node for intelligent EC-based fertilizer control.
 *
 * Features:
 * - Lookup table interpolation for valve time calculation
 * - Real-time context window (20s) for EC averaging
 * - Adaptive ±50ms adjustment based on EC deviation
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
 *   Output 1: Modbus write commands (valve times)
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
module.exports = function (RED) {
    function ViisFertilizerEcControlNode(config) {
        var _a, _b, _c, _d, _e, _f;
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
        // Configuration from node settings or environment
        const cycleEc = (_a = config.cycleEc) !== null && _a !== void 0 ? _a : globalHelper.getNumericEnvVar('FERTILIZER_CYCLE_EC', constants_1.EC_CONTROL_DEFAULTS.CYCLE_EC);
        const rampUpSeconds = (_b = config.rampUpSeconds) !== null && _b !== void 0 ? _b : globalHelper.getNumericEnvVar('FERTILIZER_RAMP_UP_SECONDS', constants_1.EC_CONTROL_DEFAULTS.RAMP_UP_SECONDS);
        const adjustmentStep = (_c = config.adjustmentStep) !== null && _c !== void 0 ? _c : globalHelper.getNumericEnvVar('FERTILIZER_ADJUSTMENT_STEP', constants_1.EC_CONTROL_DEFAULTS.ADJUSTMENT_STEP);
        const adjustmentThreshold = (_d = config.adjustmentThreshold) !== null && _d !== void 0 ? _d : globalHelper.getNumericEnvVar('FERTILIZER_ADJUSTMENT_THRESHOLD', constants_1.EC_CONTROL_DEFAULTS.ADJUSTMENT_THRESHOLD);
        const maxValveTime = (_e = config.maxValveTime) !== null && _e !== void 0 ? _e : globalHelper.getNumericEnvVar('FERTILIZER_MAX_VALVE_TIME', constants_1.EC_CONTROL_DEFAULTS.MAX_VALVE_TIME);
        const debugEnable = (_f = config.debugEnable) !== null && _f !== void 0 ? _f : false;
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
        // Debug logging helper
        const debugLog = (message) => {
            if (debugEnable) {
                node.warn(`[DEBUG] ${message}`);
            }
        };
        // Initialize services
        async function initializeServices() {
            try {
                // Initialize lookup table service
                lookupService = new services_1.LookupTableService(node, deviceId);
                await lookupService.initialize(nodeContext);
                // Initialize context window service
                contextService = new services_1.ContextWindowService(node, {
                    windowSize: constants_1.EC_CONTROL_DEFAULTS.CONTEXT_WINDOW_SIZE,
                    adjustmentThreshold,
                    adjustmentStep,
                    maxValveTime,
                });
                // Initialize irrigation run service
                runService = new services_1.IrrigationRunService(node, deviceId);
                await runService.initialize(nodeContext);
                // Initialize backend sync service
                syncService = new services_1.BackendSyncService(node, deviceId, globalHelper);
                // Clean up any stale runs from power outage
                await runService.cleanupStaleRuns();
                servicesInitialized = true;
                debugLog('All services initialized successfully');
                node.status({ fill: 'green', shape: 'dot', text: 'Ready' });
                return true;
            }
            catch (error) {
                node.error(`Failed to initialize services: ${error.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Init failed' });
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
        // Write valve times to Modbus
        async function writeValveTimes(valveTimes) {
            try {
                const client = await getModbusClient();
                // Get addresses from global context
                const addr01 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_01);
                const addr02 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_02);
                const addr03 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_03);
                const addr04 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_04);
                const addr05 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.TIME_ON_VALVE_05);
                // Write time_on_valve_01-05
                await client.writeRegister(addr01, valveTimes.time_on_valve_01);
                await client.writeRegister(addr02, valveTimes.time_on_valve_02);
                await client.writeRegister(addr03, valveTimes.time_on_valve_03);
                await client.writeRegister(addr04, valveTimes.time_on_valve_04);
                await client.writeRegister(addr05, valveTimes.time_on_valve_05);
                debugLog(`Wrote valve times: ${JSON.stringify(valveTimes)}`);
                return true;
            }
            catch (error) {
                node.error(`Failed to write valve times: ${error.message}`);
                return false;
            }
        }
        // Read sensor values from Modbus
        async function readSensors() {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
            try {
                const client = await getModbusClient();
                // Get addresses from global context
                const addrEc = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CURRENT_EC);
                const addrFlow1 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CURRENT_FLOW_1);
                const addrFlow2 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CURRENT_FLOW_2);
                const addrFlow3 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CURRENT_FLOW_3);
                const addrFlow4 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CURRENT_FLOW_4);
                const addrFlow5 = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CURRENT_FLOW_5);
                // Read EC and flow registers
                const ecRaw = await client.readHoldingRegisters(addrEc, 1);
                const flow1Raw = await client.readHoldingRegisters(addrFlow1, 1);
                const flow2Raw = await client.readHoldingRegisters(addrFlow2, 1);
                const flow3Raw = await client.readHoldingRegisters(addrFlow3, 1);
                const flow4Raw = await client.readHoldingRegisters(addrFlow4, 1);
                const flow5Raw = await client.readHoldingRegisters(addrFlow5, 1);
                return {
                    current_ec: (Number((_b = (_a = ecRaw === null || ecRaw === void 0 ? void 0 : ecRaw.data) === null || _a === void 0 ? void 0 : _a[0]) !== null && _b !== void 0 ? _b : 0)) / 10, // Convert from x10
                    current_flow_1: Number((_d = (_c = flow1Raw === null || flow1Raw === void 0 ? void 0 : flow1Raw.data) === null || _c === void 0 ? void 0 : _c[0]) !== null && _d !== void 0 ? _d : 0),
                    current_flow_2: Number((_f = (_e = flow2Raw === null || flow2Raw === void 0 ? void 0 : flow2Raw.data) === null || _e === void 0 ? void 0 : _e[0]) !== null && _f !== void 0 ? _f : 0),
                    current_flow_3: Number((_h = (_g = flow3Raw === null || flow3Raw === void 0 ? void 0 : flow3Raw.data) === null || _g === void 0 ? void 0 : _g[0]) !== null && _h !== void 0 ? _h : 0),
                    current_flow_4: Number((_k = (_j = flow4Raw === null || flow4Raw === void 0 ? void 0 : flow4Raw.data) === null || _j === void 0 ? void 0 : _j[0]) !== null && _k !== void 0 ? _k : 0),
                    current_flow_5: Number((_m = (_l = flow5Raw === null || flow5Raw === void 0 ? void 0 : flow5Raw.data) === null || _l === void 0 ? void 0 : _l[0]) !== null && _m !== void 0 ? _m : 0),
                };
            }
            catch (error) {
                node.error(`Failed to read sensors: ${error.message}`);
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
                const addrCycleEc = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CYCLE_EC);
                // Set control_mode = 2 (EC mode)
                await client.writeRegister(addrControlMode, constants_1.CONTROL_MODES.EC);
                // Set EC setpoint (x10)
                await client.writeRegister(addrSetEc, Math.round(ecSetpoint * 10));
                // Set cycle_ec
                await client.writeRegister(addrCycleEc, cycleEc);
                debugLog(`Set EC control mode: setpoint=${ecSetpoint}, cycle=${cycleEc}`);
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
                controlContext.currentValveTimes = interpolation.valveTimes;
                debugLog(`Interpolation result: ${interpolation.confidence}, valves: ${JSON.stringify(interpolation.valveTimes)}`);
                // Write valve times to Modbus
                const writeSuccess = await writeValveTimes(interpolation.valveTimes);
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
                    valveTimes: interpolation.valveTimes,
                    scheduleName,
                });
                controlContext.currentRun = run;
                // Start context window
                contextService.startRun(rampUpSeconds);
                // Start polling for sensor readings
                startPolling();
                controlContext.state = 'RAMPING_UP';
                node.status({ fill: 'blue', shape: 'dot', text: `Ramp-up EC=${ecSetpoint}` });
                // Send output
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
                    valve_times: interpolation.valveTimes,
                    modbus_writes: getModbusWrites(interpolation.valveTimes, ecSetpoint),
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
                // Set control mode back to manual
                const client = await getModbusClient();
                const addrControlMode = modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CONTROL_MODE);
                await client.writeRegister(addrControlMode, constants_1.CONTROL_MODES.MANUAL);
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
            if (pollingInterval)
                return;
            pollingInterval = setInterval(async () => {
                if (controlContext.state !== 'RAMPING_UP' && controlContext.state !== 'RUNNING') {
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
                // If running, check for adjustment
                if (controlContext.state === 'RUNNING' && added) {
                    const adjustment = contextService.calculateAdjustment(controlContext.targetEc, controlContext.currentValveTimes);
                    if (adjustment.adjusted) {
                        controlContext.currentValveTimes = adjustment.valveTimes;
                        await writeValveTimes(adjustment.valveTimes);
                        sendOutput(2, {
                            topic: 'fertilizer/adjusted',
                            payload: {
                                action: 'adjusted',
                                success: true,
                                data: {
                                    deviation: adjustment.deviation,
                                    newValveTimes: adjustment.valveTimes,
                                },
                            },
                        });
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
            }, constants_1.EC_CONTROL_DEFAULTS.POLLING_INTERVAL);
        }
        function stopPolling() {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        }
        // Generate Modbus write commands
        function getModbusWrites(valveTimes, ecSetpoint) {
            return [
                { register: 'control_mode', value: constants_1.CONTROL_MODES.EC, address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CONTROL_MODE) },
                { register: 'set_ec', value: Math.round(ecSetpoint * 10), address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.SET_EC) },
                { register: 'cycle_ec', value: cycleEc, address: modbusHelper.getHoldingAddress(constants_1.MODBUS_REGISTER_KEYS.CYCLE_EC) },
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
            var _a, _b, _c, _d, _e, _f;
            if (!servicesInitialized) {
                node.warn('Services not initialized yet');
                return;
            }
            const input = msg;
            const action = input.action || ((_a = msg.payload) === null || _a === void 0 ? void 0 : _a.action);
            switch (action) {
                case 'start':
                    const ecSetpoint = (_b = input.ec_setpoint) !== null && _b !== void 0 ? _b : (_c = msg.payload) === null || _c === void 0 ? void 0 : _c.ec_setpoint;
                    if (typeof ecSetpoint !== 'number' || ecSetpoint <= 0) {
                        node.error('Invalid ec_setpoint');
                        return;
                    }
                    await startIrrigation(ecSetpoint, input.schedule_name);
                    break;
                case 'stop':
                    await stopIrrigation('user');
                    break;
                case 'getValveTimes':
                    const targetEc = (_d = input.ec_setpoint) !== null && _d !== void 0 ? _d : (_e = msg.payload) === null || _e === void 0 ? void 0 : _e.ec_setpoint;
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
                                runId: (_f = controlContext.currentRun) === null || _f === void 0 ? void 0 : _f.id,
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

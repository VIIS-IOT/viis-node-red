"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("./viis-schedule-executor-service");
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    function ScheduleExecutorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Initialize global activeModbusCommands with type
        const globalContext = node.context().global;
        // STARTUP RECOVERY: Track if this is a fresh startup (power cycle recovery)
        // Use a unique startup ID to detect restarts
        const currentStartupId = `startup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const lastStartupId = globalContext.get("scheduleExecutorStartupId") || null;
        const isStartupRecovery = !lastStartupId || lastStartupId !== currentStartupId;
        if (isStartupRecovery) {
            // Mark this startup
            globalContext.set("scheduleExecutorStartupId", currentStartupId);
            globalContext.set("scheduleExecutorStartupTime", Date.now());
            // CRITICAL: Clear all potentially stale global state on startup
            // This prevents stuck schedules after power outage
            const existingActiveCommands = globalContext.get("activeModbusCommands") || {};
            const existingStatusHistory = globalContext.get("scheduleStatusHistory") || {};
            const existingTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
            const staleCommandCount = Object.keys(existingActiveCommands).length;
            const staleStatusCount = Object.keys(existingStatusHistory).length;
            const staleTimestampCount = Object.keys(existingTimestamps).length;
            if (staleCommandCount > 0 || staleStatusCount > 0 || staleTimestampCount > 0) {
                node.warn(`🔄 STARTUP RECOVERY: Detected potential stale state from power outage`);
                node.warn(`   - activeModbusCommands: ${staleCommandCount} entries (clearing)`);
                node.warn(`   - scheduleStatusHistory: ${staleStatusCount} entries (clearing)`);
                node.warn(`   - scheduleLastCheckTimestamps: ${staleTimestampCount} entries (clearing)`);
                // Clear all stale state - schedules will be re-evaluated fresh
                globalContext.set("activeModbusCommands", {});
                globalContext.set("scheduleStatusHistory", {});
                globalContext.set("scheduleLastCheckTimestamps", {});
                globalContext.set("manualModbusOverrides", {});
                node.warn(`✅ STARTUP RECOVERY: Cleared stale global state - schedules will start fresh`);
            }
            else {
                // Initialize empty objects
                globalContext.set("activeModbusCommands", {});
                globalContext.set("manualModbusOverrides", {});
                globalContext.set("scheduleLastCheckTimestamps", {});
                globalContext.set("scheduleStatusHistory", {});
            }
        }
        else {
            // Not a fresh startup, just ensure variables exist
            if (!globalContext.get("activeModbusCommands")) {
                globalContext.set("activeModbusCommands", {});
            }
            if (!globalContext.get("manualModbusOverrides")) {
                globalContext.set("manualModbusOverrides", {});
            }
            if (!globalContext.get("scheduleLastCheckTimestamps")) {
                globalContext.set("scheduleLastCheckTimestamps", {});
            }
            if (!globalContext.get("scheduleStatusHistory")) {
                globalContext.set("scheduleStatusHistory", {});
            }
        }
        node.name = config.name;
        const debugEnable = config.debugEnable; // Read debugEnable from config
        const verifyAfterWrite = config.verifyAfterWrite !== false; // Default to true if not specified
        const cleanupInterval = config.cleanupInterval || 8; // Read cleanupInterval from config, default 8 minutes
        // Multi-board state variables
        let currentBoardId = config.boardId;
        let isMultiBoardMode = false;
        let currentModbusConfig = null;
        // Helper function for conditional logging
        const debugLog = (message) => {
            if (debugEnable) {
                node.warn(message);
            }
        };
        debugLog(`Cleanup interval set to: ${cleanupInterval} minutes`);
        // Initialize GlobalContextHelper
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        // Helper function to check and track status changes
        const hasStatusChanged = (scheduleName, newStatus) => {
            const statusHistory = globalContext.get("scheduleStatusHistory") || {};
            const previousStatus = statusHistory[scheduleName];
            const changed = previousStatus !== newStatus;
            if (changed && debugEnable) {
                debugLog(`Status changed for ${scheduleName}: ${previousStatus || 'undefined'} -> ${newStatus}`);
            }
            // Update status history
            statusHistory[scheduleName] = newStatus;
            globalContext.set("scheduleStatusHistory", statusHistory);
            return changed;
        };
        // Helper function to clear status history for a schedule (call when schedule successfully finishes)
        const clearStatusHistory = (scheduleName) => {
            const statusHistory = globalContext.get("scheduleStatusHistory") || {};
            if (statusHistory[scheduleName]) {
                debugLog(`Clearing status history for ${scheduleName} (was: ${statusHistory[scheduleName]})`);
                delete statusHistory[scheduleName];
                globalContext.set("scheduleStatusHistory", statusHistory);
            }
        };
        // Helper function to check and clean stale "running" entries in status history
        // This runs periodically to clean up schedules that are stuck as "running"
        const cleanStaleStatusHistory = () => {
            const statusHistory = globalContext.get("scheduleStatusHistory") || {};
            const lastCleanupKey = "scheduleStatusHistoryLastCleanup";
            const lastCleanup = globalContext.get(lastCleanupKey) || 0;
            const now = Date.now();
            const cleanupIntervalMs = cleanupInterval * 60 * 1000; // Convert minutes to milliseconds
            // Run cleanup based on configured interval
            if (now - lastCleanup < cleanupIntervalMs) {
                return;
            }
            let cleanedCount = 0;
            const currentRunningSchedules = Object.keys(globalContext.get("activeModbusCommands") || {});
            for (const scheduleId in statusHistory) {
                // If status is "running" but schedule is NOT in activeModbusCommands, it's stale
                if (statusHistory[scheduleId] === "running" && !currentRunningSchedules.includes(scheduleId)) {
                    debugLog(`Cleaning stale status history: ${scheduleId} (was stuck as 'running')`);
                    delete statusHistory[scheduleId];
                    cleanedCount++;
                }
            }
            if (cleanedCount > 0) {
                globalContext.set("scheduleStatusHistory", statusHistory);
                node.warn(`🧹 CLEANUP: Removed ${cleanedCount} stale 'running' entries from scheduleStatusHistory`);
            }
            globalContext.set(lastCleanupKey, now);
        };
        // Initialize ScheduleService with debugEnable setting
        let scheduleService;
        try {
            scheduleService = new viis_schedule_executor_service_1.ScheduleService(node, verifyAfterWrite, debugEnable);
            debugLog("ScheduleService initialized successfully");
        }
        catch (error) {
            node.error(`Failed to initialize ScheduleService: ${error.message}`);
            return;
        }
        // Helper function to read Modbus config
        const readModbusConfig = () => {
            const boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);
            if (boardsConfig) {
                try {
                    let boards;
                    // Handle both already-parsed array and JSON string
                    if (Array.isArray(boardsConfig)) {
                        boards = boardsConfig;
                    }
                    else if (typeof boardsConfig === 'string') {
                        boards = JSON.parse(boardsConfig);
                    }
                    else {
                        node.error(`Invalid MODBUS_BOARDS type: ${typeof boardsConfig}`);
                        boards = null;
                    }
                    if (Array.isArray(boards) && boards.length > 0) {
                        return {
                            mode: 'multi',
                            boards: boards,
                            defaultBoard: globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id)
                        };
                    }
                }
                catch (e) {
                    node.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                }
            }
            return {
                mode: 'single',
                config: {
                    type: globalHelper.getEnvVar("MODBUS_TYPE", "TCP"),
                    host: globalHelper.getEnvVar("MODBUS_HOST", "localhost"),
                    tcpPort: globalHelper.getNumericEnvVar("MODBUS_TCP_PORT", 502),
                    serialPort: globalHelper.getEnvVar("MODBUS_SERIAL_PORT", "/dev/ttyUSB0"),
                    baudRate: globalHelper.getNumericEnvVar("MODBUS_BAUD_RATE", 9600),
                    parity: globalHelper.getEnvVar("MODBUS_PARITY", "none"),
                    unitId: globalHelper.getNumericEnvVar("MODBUS_UNIT_ID", 1),
                    timeout: globalHelper.getNumericEnvVar("MODBUS_TIMEOUT", 5000),
                    reconnectInterval: globalHelper.getNumericEnvVar("MODBUS_RECONNECT_INTERVAL", 5000),
                }
            };
        };
        // Initialize Modbus configuration
        const configData = readModbusConfig();
        currentModbusConfig = Object.assign({}, configData);
        // Auto-detect mode
        if (configData.mode === 'multi') {
            isMultiBoardMode = true;
            debugLog(`Multi-board mode detected with ${configData.boards.length} boards`);
            const multiConfig = {
                mode: 'multi',
                defaultBoard: configData.defaultBoard,
                boards: configData.boards
            };
            client_registry_1.default.initializeMultiBoardConfig(multiConfig, node);
        }
        else {
            isMultiBoardMode = false;
            debugLog(`Single-board mode: ${configData.config.type} ${configData.config.host}:${configData.config.tcpPort}`);
        }
        // ThingsBoard MQTT configuration
        const thingsboardConfig = {
            broker: `mqtt://${globalHelper.getEnvVar("THINGSBOARD_HOST", "mqtt.viis.tech")}:${globalHelper.getEnvVar("THINGSBOARD_PORT", "1883")}`,
            clientId: `node-red-tb-${Math.random().toString(16).substring(2, 10)}`,
            username: globalHelper.getEnvVar("DEVICE_ACCESS_TOKEN", ""),
            password: globalHelper.getEnvVar("THINGSBOARD_PASSWORD", ""),
            qos: 1,
        };
        // EMQX (local) MQTT configuration
        const emqxConfig = {
            broker: `mqtt://${globalHelper.getEnvVar("EMQX_HOST", "emqx")}:${globalHelper.getEnvVar("EMQX_PORT", "1883")}`,
            clientId: `node-red-emqx-${Math.random().toString(16).substring(2, 10)}`,
            username: globalHelper.getEnvVar("EMQX_USERNAME", ""),
            password: globalHelper.getEnvVar("EMQX_PASSWORD", ""),
            qos: 1,
        };
        // Get Modbus client
        let modbusClient;
        let modbusUnitId;
        // Async initialization - defer Modbus client setup
        const modbusClientPromise = (async () => {
            if (isMultiBoardMode) {
                const boardToUse = currentBoardId || configData.defaultBoard;
                debugLog(`Getting client for board: ${boardToUse}`);
                const client = await client_registry_1.default.getModbusClientV2(boardToUse, node);
                // Get unitId from board config
                const boardConfig = configData.boards.find((b) => b.id === boardToUse);
                return { client, unitId: (boardConfig === null || boardConfig === void 0 ? void 0 : boardConfig.unitId) || 1 };
            }
            else {
                const client = await client_registry_1.default.getModbusClientV2(configData.config, node);
                return { client, unitId: configData.config.unitId };
            }
        })();
        // Initialize synchronously - actual connection happens in background
        modbusClientPromise.then(({ client, unitId }) => {
            modbusClient = client;
            modbusUnitId = unitId;
            debugLog(`Modbus client initialized for unitId: ${modbusUnitId}`);
        }).catch(error => {
            node.error(`Failed to initialize Modbus client: ${error.message}`);
        });
        node.on("input", async function (msg, send, done) {
            var _a;
            try {
                // Ensure Modbus client is ready before processing
                if (!modbusClient) {
                    await modbusClientPromise.then(({ client, unitId }) => {
                        modbusClient = client;
                        modbusUnitId = unitId;
                    });
                }
                // Initialize MQTT clients
                const thingsboardClient = await client_registry_1.default.getThingsboardMqttClient(thingsboardConfig, node);
                const emqxClient = await client_registry_1.default.getLocalMqttClient(emqxConfig, node);
                debugLog(`MQTT TB connected: ${thingsboardClient.isConnected()}, EMQX connected: ${emqxClient.isConnected()}`);
                client_registry_1.default.logConnectionCounts(node);
                // Check and clear overrides if no schedules are running
                const activeModbusCommands = node.context().global.get("activeModbusCommands") || {};
                if (Object.keys(activeModbusCommands).length === 0) {
                    node.context().global.set("manualModbusOverrides", {});
                    debugLog("No schedules running. Cleared manualModbusOverrides.");
                }
                // Handle RPC command
                if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload && msg.payload.method === "schedule-disable-by-backend") {
                    const payload = msg.payload;
                    const params = payload.params || {};
                    const scheduleId = params.scheduleId;
                    if (!scheduleId) {
                        node.error("Missing scheduleId in schedule-disable-by-backend RPC command");
                        node.status({ fill: "red", shape: "ring", text: "Missing scheduleId" });
                        done(new Error("Missing scheduleId"));
                        return;
                    }
                    const schedules = await scheduleService.getDueSchedules();
                    const schedule = schedules.find(s => s.name === scheduleId);
                    if (!schedule) {
                        debugLog(`Schedule with id ${scheduleId} not found`);
                        node.status({ fill: "yellow", shape: "ring", text: "Schedule not found" });
                        send(msg);
                        done();
                        return;
                    }
                    if (schedule.status === "running") {
                        // Clear timestamp when schedule is disabled via RPC
                        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
                        delete lastCheckTimestamps[schedule.name];
                        globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
                        const { holdingCommands, coilCommands, configParameters } = scheduleService.mapScheduleToModbus(schedule);
                        const activeCommands = scheduleService.getActiveCommands(schedule.name);
                        // Publish configuration parameters if any
                        if (configParameters && configParameters.length > 0) {
                            for (const configParam of configParameters) {
                                try {
                                    await scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam);
                                    debugLog(`Published config parameter: ${configParam.key}=${configParam.value} for schedule ${schedule.name}`);
                                }
                                catch (error) {
                                    node.error(`Failed to publish config parameter ${configParam.key}: ${error.message}`);
                                }
                            }
                        }
                        // Reset time_valve_ and set_flow keys
                        const holdingRegisters = scheduleService.getAllModbusHoldingRegisters();
                        debugLog(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        const extraResetKeys = Object.entries(holdingRegisters)
                            .filter(([key, _]) => key.startsWith('time_valve_') || key.startsWith('set_flow'))
                            .map(([key, address]) => ({
                            key,
                            value: 0,
                            fc: 6,
                            unitid: modbusUnitId,
                            address: Number(address),
                            quantity: 1
                        }));
                        const activeCmdKey = (cmd) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set([...activeCommands, ...holdingCommands, ...coilCommands].map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = [...activeCommands, ...holdingCommands, ...coilCommands, ...extraResetCommands];
                        let resetSuccess = true; // Track reset result
                        if (allResetCommands.length > 0) {
                            resetSuccess = await scheduleService.resetModbusCommands(modbusClient, allResetCommands);
                            scheduleService.clearActiveCommands(schedule.name);
                            debugLog(`Cleared active commands for schedule ${schedule.name} via RPC - Success: ${resetSuccess}`);
                        }
                        // CRITICAL FIX: Only set status to "finished" if reset succeeded
                        // If reset failed, keep status as "running" so users know devices are still ON
                        if (resetSuccess) {
                            const statusChanged = hasStatusChanged(schedule.name, "finished");
                            schedule.status = "finished";
                            schedule.enable = 0;
                            await scheduleService.updateScheduleStatus(schedule, "finished");
                            // Clear status history after successful finish so next run will trigger notification
                            clearStatusHistory(schedule.name);
                            if (statusChanged) {
                                // Send HTTP notification - success case
                                await scheduleService.sendNotificationToBackend(schedule, 'end', true);
                                await scheduleService.syncScheduleLog(schedule, true);
                                // Publish audit log for RPC disable (success)
                                try {
                                    const resetCoilCommands = allResetCommands.filter(cmd => cmd.fc === 5).map(cmd => (Object.assign(Object.assign({}, cmd), { value: false })));
                                    const resetHoldingCommands = allResetCommands.filter(cmd => cmd.fc === 6).map(cmd => (Object.assign(Object.assign({}, cmd), { value: 0 })));
                                    await scheduleService.publishAuditLog(thingsboardClient, emqxClient, schedule, 'end', { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }, true);
                                }
                                catch (auditError) {
                                    debugLog(`Failed to publish audit log for RPC disable: ${auditError.message}`);
                                }
                            }
                        }
                        else {
                            // Reset failed via RPC - keep status as "running" and send error notification
                            debugLog(`⚠️ CRITICAL: RPC disable ${schedule.name} FAILED to turn off devices - keeping status as "running"`);
                            // Disable schedule but keep status running to indicate devices are still ON
                            schedule.enable = 0;
                            await scheduleService.updateScheduleStatus(schedule, "running"); // Keep as running!
                            // Send error notification
                            await scheduleService.sendNotificationToBackend(schedule, 'end', false);
                            await scheduleService.syncScheduleLog(schedule, false);
                            // Publish audit log for RPC disable (failure)
                            try {
                                const resetCoilCommands = allResetCommands.filter(cmd => cmd.fc === 5).map(cmd => (Object.assign(Object.assign({}, cmd), { value: false })));
                                const resetHoldingCommands = allResetCommands.filter(cmd => cmd.fc === 6).map(cmd => (Object.assign(Object.assign({}, cmd), { value: 0 })));
                                await scheduleService.publishAuditLog(thingsboardClient, emqxClient, schedule, 'end', { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }, false, 'RPC disable: Không thể tắt thiết bị - Lỗi ghi Modbus');
                            }
                            catch (auditError) {
                                debugLog(`Failed to publish audit log for failed RPC disable: ${auditError.message}`);
                            }
                            // Log critical warning
                            node.warn(`🚨 CRITICAL: RPC disable ${schedule.name} cannot turn off devices - MANUAL INTERVENTION REQUIRED`);
                        }
                    }
                    else {
                        debugLog(`Schedule id: ${schedule.name}, label: ${schedule.label} is not running, only disabling`);
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, schedule.status);
                    }
                    node.status({ fill: "green", shape: "dot", text: "RPC processed" });
                    send(msg);
                    done();
                    return;
                }
                // Handle RPC command: confirm-devices-off
                // User manually confirms that devices have been turned off (for recovery from stuck 'running' status)
                if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload && msg.payload.method === "confirm-devices-off") {
                    const payload = msg.payload;
                    const params = payload.params || {};
                    const scheduleId = params.scheduleId;
                    const verifyDevices = params.verifyDevices !== false; // Default to true
                    if (!scheduleId) {
                        node.error("Missing scheduleId in confirm-devices-off RPC command");
                        node.status({ fill: "red", shape: "ring", text: "Missing scheduleId" });
                        done(new Error("Missing scheduleId"));
                        return;
                    }
                    const schedules = await scheduleService.getDueSchedules();
                    const schedule = schedules.find(s => s.name === scheduleId);
                    if (!schedule) {
                        debugLog(`Schedule with id ${scheduleId} not found`);
                        node.status({ fill: "yellow", shape: "ring", text: "Schedule not found" });
                        send(msg);
                        done();
                        return;
                    }
                    if (schedule.status !== "running") {
                        node.warn(`Schedule ${scheduleId} is not running (status: ${schedule.status})`);
                        node.status({ fill: "yellow", shape: "ring", text: "Not running" });
                        send(msg);
                        done();
                        return;
                    }
                    let confirmSuccess = true;
                    // If verifyDevices is true, read Modbus to confirm devices are actually OFF
                    if (verifyDevices) {
                        const activeCommands = scheduleService.getActiveCommands(schedule.name);
                        if (activeCommands.length > 0) {
                            for (const cmd of activeCommands) {
                                try {
                                    let readResult;
                                    let currentValue;
                                    if (cmd.fc === 5) {
                                        readResult = await modbusClient.readCoils(cmd.address, 1);
                                        currentValue = Boolean(readResult.data[0]);
                                        if (currentValue !== false) {
                                            confirmSuccess = false;
                                            node.warn(`⚠️ Device at coil ${cmd.address} (${cmd.key}) is still ON`);
                                        }
                                    }
                                    else if (cmd.fc === 6) {
                                        readResult = await modbusClient.readHoldingRegisters(cmd.address, 1);
                                        currentValue = Number(readResult.data[0]);
                                        if (currentValue !== 0) {
                                            confirmSuccess = false;
                                            node.warn(`⚠️ Register at ${cmd.address} (${cmd.key}) is still ${currentValue}`);
                                        }
                                    }
                                }
                                catch (error) {
                                    node.error(`Error verifying device status: ${error.message}`);
                                    confirmSuccess = false;
                                }
                            }
                        }
                    }
                    if (confirmSuccess) {
                        // Update status to finished
                        schedule.status = "finished";
                        schedule.enable = 0;
                        scheduleService.clearActiveCommands(schedule.name);
                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        // Clear status history after successful finish so next run will trigger notification
                        clearStatusHistory(schedule.name);
                        // Send success notification
                        await scheduleService.sendNotificationToBackend(schedule, 'end', true);
                        await scheduleService.syncScheduleLog(schedule, true);
                        node.warn(`✅ MANUAL RECOVERY: Schedule ${schedule.name} confirmed OFF and set to finished`);
                        node.status({ fill: "green", shape: "dot", text: "Confirmed OFF" });
                    }
                    else {
                        node.warn(`❌ MANUAL RECOVERY FAILED: Some devices are still ON for ${schedule.name}`);
                        node.status({ fill: "red", shape: "ring", text: "Devices still ON" });
                    }
                    send(msg);
                    done();
                    return;
                }
                // Handle RPC command: control (general Modbus control)
                if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload) {
                    const payload = msg.payload;
                    if (payload.method === "control" && payload.params) {
                        const results = [];
                        for (const [key, value] of Object.entries(payload.params)) {
                            if (key === 'scheduleId')
                                continue;
                            const result = scheduleService.processRpcControlCommand(key, value);
                            results.push(Object.assign({ key }, result));
                            if (result.success && result.action === 'config') {
                                debugLog(`RPC control: ${key}=${value} stored in configKeyValues`);
                            }
                            else if (result.success && result.action === 'modbus') {
                                debugLog(`RPC control: ${key}=${value} should be handled by modbus (address: ${(_a = result.result) === null || _a === void 0 ? void 0 : _a.address})`);
                            }
                            else {
                                node.error(`RPC control failed for ${key}=${value}`);
                            }
                        }
                        const responseMsg = Object.assign(Object.assign({}, msg), { payload: {
                                method: payload.method,
                                results: results,
                                timestamp: Date.now()
                            } });
                        node.status({ fill: "green", shape: "dot", text: "RPC control processed" });
                        send(responseMsg);
                        done();
                        return;
                    }
                    debugLog(`Unknown RPC method: ${payload.method}`);
                    return null;
                }
                const schedules = await scheduleService.getDueSchedules();
                debugLog(`Found ${schedules.length} schedule(s).`);
                // Run hourly cleanup of stale status history entries
                cleanStaleStatusHistory();
                for (const schedule of schedules) {
                    const isDue = scheduleService.isScheduleDue(schedule);
                    // POWER OUTAGE RECOVERY: Check if schedule is marked "running" but has no active commands
                    // This happens after power outage when activeModbusCommands was cleared on startup
                    const existingActiveCommands = scheduleService.getActiveCommands(schedule.name);
                    const isStaleRunningStatus = schedule.status === "running" && existingActiveCommands.length === 0;
                    if (isStaleRunningStatus && isDue) {
                        node.warn(`🔄 POWER RECOVERY: Schedule ${schedule.name} marked as "running" but no active commands - restarting`);
                    }
                    if (isDue && (schedule.status !== "running" || isStaleRunningStatus)) {
                        debugLog("start running schedule");
                        const statusChanged = hasStatusChanged(schedule.name, "running");
                        const holdingRegisters = scheduleService.getAllModbusHoldingRegisters();
                        debugLog(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        let actionObj = {};
                        if (typeof schedule.action === 'string' && schedule.action.trim() !== '') {
                            try {
                                actionObj = JSON.parse(schedule.action);
                            }
                            catch (err) {
                                debugLog('Cannot parse schedule.action, treat as empty object');
                            }
                        }
                        else if (typeof schedule.action === 'object' && schedule.action !== null) {
                            actionObj = schedule.action;
                        }
                        const resetKeys = Object.entries(holdingRegisters)
                            .filter(([key, _]) => (key.startsWith('time_valve_') || key.startsWith('set_flow')) && (!actionObj[key] || actionObj[key] === 0))
                            .map(([key, address]) => ({
                            key,
                            value: 0,
                            fc: 6,
                            unitid: modbusUnitId,
                            address: Number(address),
                            quantity: 1
                        }));
                        if (resetKeys.length > 0) {
                            debugLog(`Resetting keys at schedule start: ${resetKeys.map(k => k.key).join(', ')}`);
                            await scheduleService.resetModbusCommands(modbusClient, resetKeys);
                        }
                        const { holdingCommands, coilCommands, configParameters } = scheduleService.mapScheduleToModbus(schedule);
                        if (configParameters && configParameters.length > 0) {
                            for (const configParam of configParameters) {
                                try {
                                    await scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam);
                                    debugLog(`Published config parameter: ${configParam.key}=${configParam.value} for schedule ${schedule.name}`);
                                }
                                catch (error) {
                                    node.error(`Failed to publish config parameter ${configParam.key}: ${error.message}`);
                                }
                            }
                        }
                        if (await scheduleService.canExecuteCommands(schedule.name, holdingCommands, coilCommands)) {
                            await scheduleService.updateScheduleStatus(schedule, "running");
                            let writeSuccess = false;
                            let attempt = 0;
                            while (!writeSuccess && attempt < 3) {
                                attempt++;
                                try {
                                    await scheduleService.executeModbusCommands(modbusClient, { holdingCommands, coilCommands }, schedule);
                                    writeSuccess = await scheduleService.verifyModbusWrite(modbusClient, [...holdingCommands, ...coilCommands]);
                                    if (writeSuccess) {
                                        scheduleService.storeActiveCommands(schedule.name, [...holdingCommands, ...coilCommands]);
                                    }
                                }
                                catch (error) {
                                    node.error(`Error writing modbus: ${error.message}`);
                                }
                            }
                            if (statusChanged) {
                                // Send HTTP notification directly to backend when schedule starts
                                await scheduleService.sendNotificationToBackend(schedule, 'start', writeSuccess);
                                await scheduleService.syncScheduleLog(schedule, writeSuccess);
                                // Publish audit log for schedule start
                                try {
                                    await scheduleService.publishAuditLog(thingsboardClient, emqxClient, schedule, 'start', { holdingCommands, coilCommands }, writeSuccess, writeSuccess ? undefined : 'Không thể ghi dữ liệu Modbus sau 3 lần thử');
                                }
                                catch (auditError) {
                                    debugLog(`Failed to publish audit log for schedule start: ${auditError.message}`);
                                }
                            }
                        }
                    }
                    else if (schedule.status === "running" && isDue) {
                        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
                        const now = Date.now();
                        const lastCheck = lastCheckTimestamps[schedule.name] || 0;
                        const checkInterval = 60000;
                        if (now - lastCheck >= checkInterval) {
                            debugLog(`Schedule ${schedule.name} is running - automatic coil recovery is DISABLED`);
                            lastCheckTimestamps[schedule.name] = now;
                            globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
                        }
                    }
                    else if (schedule.status === "running" && !isDue) {
                        debugLog(`Schedule ${schedule.name} no longer due - stopping (was: running, isDue: ${isDue})`);
                        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
                        delete lastCheckTimestamps[schedule.name];
                        globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
                        const activeCommands = scheduleService.getActiveCommands(schedule.name);
                        const holdingRegisters = scheduleService.getAllModbusHoldingRegisters();
                        debugLog(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        const extraResetKeys = Object.entries(holdingRegisters)
                            .filter(([key, _]) => key.startsWith('time_valve_') || key.startsWith('set_flow'))
                            .map(([key, address]) => ({
                            key,
                            value: 0,
                            fc: 6,
                            unitid: modbusUnitId,
                            address: Number(address),
                            quantity: 1
                        }));
                        const activeCmdKey = (cmd) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set(activeCommands.map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = [...activeCommands, ...extraResetCommands];
                        let resetSuccess = true; // Track reset result
                        if (allResetCommands.length > 0) {
                            resetSuccess = await scheduleService.resetModbusCommands(modbusClient, allResetCommands, schedule);
                            scheduleService.clearActiveCommands(schedule.name);
                        }
                        // CRITICAL FIX: Only set status to "finished" if reset succeeded
                        // If reset failed, keep status as "running" so users know devices are still ON
                        if (resetSuccess) {
                            const statusChanged = hasStatusChanged(schedule.name, "finished");
                            await scheduleService.updateScheduleStatus(schedule, "finished");
                            // Clear status history after successful finish so next day's run will trigger notification
                            clearStatusHistory(schedule.name);
                            if (statusChanged) {
                                // Send HTTP notification - success case
                                await scheduleService.sendNotificationToBackend(schedule, 'end', true);
                                await scheduleService.syncScheduleLog(schedule, true);
                                // Publish audit log for schedule end (success)
                                try {
                                    const resetCoilCommands = allResetCommands.filter(cmd => cmd.fc === 5).map(cmd => (Object.assign(Object.assign({}, cmd), { value: false })));
                                    const resetHoldingCommands = allResetCommands.filter(cmd => cmd.fc === 6).map(cmd => (Object.assign(Object.assign({}, cmd), { value: 0 })));
                                    await scheduleService.publishAuditLog(thingsboardClient, emqxClient, schedule, 'end', { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }, true);
                                }
                                catch (auditError) {
                                    debugLog(`Failed to publish audit log for schedule end: ${auditError.message}`);
                                }
                            }
                        }
                        else {
                            // Reset failed - keep status as "running" and send error notification
                            debugLog(`⚠️ CRITICAL: Schedule ${schedule.name} time ended but FAILED to turn off devices - keeping status as "running"`);
                            // Send error notification immediately
                            await scheduleService.sendNotificationToBackend(schedule, 'end', false);
                            await scheduleService.syncScheduleLog(schedule, false);
                            // Publish audit log for schedule end (failure)
                            try {
                                const resetCoilCommands = allResetCommands.filter(cmd => cmd.fc === 5).map(cmd => (Object.assign(Object.assign({}, cmd), { value: false })));
                                const resetHoldingCommands = allResetCommands.filter(cmd => cmd.fc === 6).map(cmd => (Object.assign(Object.assign({}, cmd), { value: 0 })));
                                await scheduleService.publishAuditLog(thingsboardClient, emqxClient, schedule, 'end', { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }, false, 'Không thể tắt thiết bị sau khi kết thúc lịch trình - Lỗi ghi Modbus');
                            }
                            catch (auditError) {
                                debugLog(`Failed to publish audit log for failed schedule end: ${auditError.message}`);
                            }
                            // Log critical warning
                            if (node) {
                                node.warn(`🚨 CRITICAL: Schedule ${schedule.name} cannot turn off devices - MANUAL INTERVENTION REQUIRED`);
                            }
                        }
                    }
                    else {
                        debugLog(`Schedule ${schedule.name} skipped (status: ${schedule.status}, due: ${isDue})`);
                    }
                }
                // AUTO-RECOVERY: Check for stuck 'running' schedules and try to recover
                // This runs on every input trigger and handles cases where reset failed but devices were manually turned off
                try {
                    await scheduleService.checkAndRecoverStuckSchedules(modbusClient, schedules);
                }
                catch (error) {
                    debugLog(`Error in recovery check: ${error.message}`);
                }
                const enabledScheduleIds = schedules.map(s => s.name);
                for (const scheduleId in activeModbusCommands) {
                    if (!enabledScheduleIds.includes(scheduleId)) {
                        const commands = activeModbusCommands[scheduleId];
                        const resetSuccess = await scheduleService.resetModbusCommands(modbusClient, commands);
                        if (resetSuccess) {
                            scheduleService.clearActiveCommands(scheduleId);
                            debugLog(`Cleaned up stale commands for schedule ${scheduleId} (not in enabled schedules)`);
                        }
                        else {
                            debugLog(`Failed to reset commands for ${scheduleId}, retaining in activeModbusCommands`);
                        }
                    }
                }
                const statusHistory = globalContext.get("scheduleStatusHistory") || {};
                for (const scheduleId in statusHistory) {
                    if (!enabledScheduleIds.includes(scheduleId)) {
                        delete statusHistory[scheduleId];
                        debugLog(`Cleaned up status history for disabled schedule ${scheduleId}`);
                    }
                }
                globalContext.set("scheduleStatusHistory", statusHistory);
                node.status({ fill: "green", shape: "dot", text: "Schedules processed" });
                send(msg);
                done();
            }
            catch (err) {
                node.error("Error processing schedules: " + err.message);
                node.status({ fill: "red", shape: "ring", text: "Processing error" });
                done(err);
            }
        });
        node.on("close", function (done) {
            // Release Modbus client (multi-board aware)
            if (isMultiBoardMode && currentBoardId) {
                client_registry_1.default.releaseClientV2("modbus-board", node, currentBoardId);
            }
            else {
                client_registry_1.default.releaseClientV2("modbus", node);
            }
            client_registry_1.default.releaseClient("thingsboard", node);
            client_registry_1.default.releaseClient("local", node);
            done();
        });
    }
    RED.nodes.registerType("viis-schedule-executor", ScheduleExecutorNode);
};

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("./viis-schedule-executor-service");
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const protection_gate_service_1 = require("../viis-device-protection/services/protection-gate-service");
const schedule_execution_types_1 = require("./schedule-execution-types");
const schedule_side_effects_1 = require("./schedule-side-effects");
const schedule_tick_guard_1 = require("./schedule-tick-guard");
const resilience_utils_1 = require("./resilience-utils");
const uuid_1 = require("uuid");
const schedule_run_identity_1 = require("./schedule-run-identity");
const schedule_stop_cleanup_1 = require("./schedule-stop-cleanup");
const schedule_finish_1 = require("./schedule-finish");
const demeter_mqtt_topics_1 = require("../../core/demeter-mqtt-topics");
const farm_time_1 = require("../../core/farm-time");
const schedule_arbiter_1 = require("./schedule-arbiter");
/** Longest a reporting side effect (notification, schedule log, telemetry, audit) may hold a tick. */
const SIDE_EFFECT_TIMEOUT_MS = 15000;
/** Watchdog for one executor tick; START with water-hammer delay and verify retries stays well under it. */
const TICK_TIMEOUT_MS = 180000;
const SCHEDULE_EXECUTOR_HEARTBEAT_KEY = "scheduleExecutorHeartbeat";
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
                // NOTE: Do NOT clear configKeyValues and scheduleConfigKeys - these preserve config structure
                // and should only be updated by schedule execution, not cleared on startup
                globalContext.set("activeModbusCommands", {});
                globalContext.set("scheduleStatusHistory", {});
                globalContext.set("scheduleLastCheckTimestamps", {});
                globalContext.set("manualModbusOverrides", {});
                node.warn(`✅ STARTUP RECOVERY: Cleared stale active state - schedules will start fresh`);
                node.warn(`ℹ️ Preserved configKeyValues and scheduleConfigKeys (config structure maintained)`);
            }
            else {
                // Initialize empty objects for fresh startup
                globalContext.set("activeModbusCommands", {});
                globalContext.set("manualModbusOverrides", {});
                globalContext.set("scheduleLastCheckTimestamps", {});
                globalContext.set("scheduleStatusHistory", {});
                // Initialize config tracking but don't clear if exists (preserve structure)
                if (!globalContext.get("scheduleConfigKeys")) {
                    globalContext.set("scheduleConfigKeys", {});
                }
                if (!globalContext.get("configKeyValues")) {
                    globalContext.set("configKeyValues", {});
                }
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
            if (!globalContext.get("scheduleConfigKeys")) {
                globalContext.set("scheduleConfigKeys", {});
            }
            if (!globalContext.get("configKeyValues")) {
                globalContext.set("configKeyValues", {});
            }
        }
        if (isStartupRecovery) {
            (0, schedule_tick_guard_1.clearAllScheduleTransitions)(globalContext);
        }
        else if (!globalContext.get(schedule_tick_guard_1.SCHEDULE_IN_FLIGHT_KEY)) {
            globalContext.set(schedule_tick_guard_1.SCHEDULE_IN_FLIGHT_KEY, {});
        }
        node.name = config.name;
        const debugEnable = config.debugEnable; // Read debugEnable from config
        const verifyAfterWrite = config.verifyAfterWrite !== false; // Default to true if not specified
        const skipCoilVerify = config.skipCoilVerify !== false; // Default to true (skip) if not specified
        const cleanupInterval = config.cleanupInterval || 8; // Read cleanupInterval from config, default 8 minutes
        const waterHammerDelayMs = (0, viis_schedule_executor_service_1.resolveWaterHammerDelayMs)(config.waterHammerDelay);
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
        debugLog(`Water-hammer delay set to: ${waterHammerDelayMs} ms`);
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
            scheduleService = new viis_schedule_executor_service_1.ScheduleService(node, verifyAfterWrite, debugEnable, skipCoilVerify, waterHammerDelayMs);
            debugLog("ScheduleService initialized successfully");
        }
        catch (error) {
            node.error(`Failed to initialize ScheduleService: ${error.message}`);
            return;
        }
        // Connect to ProtectionGateService if available
        const liveGate = (0, protection_gate_service_1.resolveProtectionGate)(globalContext.get('protectionGateService'));
        if (liveGate) {
            scheduleService.setProtectionGate(liveGate);
            debugLog("ProtectionGateService connected to ScheduleService");
        }
        else {
            debugLog("ProtectionGateService not live in global context — protection disabled");
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
            broker: (0, demeter_mqtt_topics_1.resolveThingsboardMqttBroker)(globalHelper),
            deviceId: globalHelper.getEnvVar("DEVICE_ID", ""),
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
        const enqueueInput = (0, schedule_tick_guard_1.createSerializedQueue)({
            jobTimeoutMs: TICK_TIMEOUT_MS,
            onJobTimeout: (timeoutMs) => {
                node.error(`🚨 SCHEDULE EXECUTOR WATCHDOG: tick still running after ${timeoutMs}ms, abandoned so schedules keep running. In flight: ${JSON.stringify(globalContext.get(schedule_tick_guard_1.SCHEDULE_IN_FLIGHT_KEY) || {})}`);
                node.status({ fill: "red", shape: "ring", text: "Tick watchdog fired" });
            },
        });
        const sideEffect = (label, work) => (0, schedule_tick_guard_1.runBoundedSideEffect)(label, work, SIDE_EFFECT_TIMEOUT_MS, (message) => node.warn(`⚠️ SIDE EFFECT ${message}`));
        node.on("input", function (msg, send, done) {
            enqueueInput(async () => {
                var _a, _b, _c;
                globalContext.set(SCHEDULE_EXECUTOR_HEARTBEAT_KEY, { lastTickAt: Date.now() });
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
                                        await (0, resilience_utils_1.executeWithTimeout)(() => scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam), SIDE_EFFECT_TIMEOUT_MS, `Config publish ${configParam.key} timed out after ${SIDE_EFFECT_TIMEOUT_MS}ms`);
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
                            // ARBITER_MODE=enforce: managed coils are the arbiter's; the run's claims are released
                            // around the direct OFF in water-hammer order.
                            const arbiterFinish = await scheduleService.beginScheduleFinish(schedule.name, scheduleService.mergeValveProgramOffCommand([...activeCommands, ...holdingCommands, ...coilCommands, ...extraResetCommands]));
                            const allResetCommands = arbiterFinish.commands;
                            const rpcRunId = (0, uuid_1.v4)();
                            let rpcReport = {
                                runId: rpcRunId,
                                action: 'end',
                                scheduleId: schedule.name,
                                steps: [],
                            };
                            if (allResetCommands.length > 0) {
                                const resetResult = await scheduleService.resetModbusCommands(modbusClient, allResetCommands, schedule, true, { runId: rpcRunId });
                                rpcReport = resetResult.report;
                                scheduleService.clearActiveCommands(schedule.name);
                                debugLog(`Cleared active commands for schedule ${schedule.name} via RPC`);
                            }
                            await arbiterFinish.complete(rpcReport);
                            const statusChanged = hasStatusChanged(schedule.name, "finished");
                            schedule.status = "finished";
                            schedule.enable = 0;
                            const resetConfigValues = scheduleService.clearScheduleConfigValues(schedule.name);
                            await scheduleService.updateScheduleStatus(schedule, "finished");
                            clearStatusHistory(schedule.name);
                            const resetCoilCommands = allResetCommands.filter(cmd => cmd.fc === 5).map(cmd => (Object.assign(Object.assign({}, cmd), { value: false })));
                            const resetHoldingCommands = allResetCommands.filter(cmd => cmd.fc === 6).map(cmd => (Object.assign(Object.assign({}, cmd), { value: 0 })));
                            if (statusChanged) {
                                // ADR-033: a run turned off before its window ends is stopped, not completed.
                                await sideEffect(`stopped notification ${schedule.name}`, () => scheduleService.sendStoppedNotification(schedule, 'schedule_disabled', (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name)));
                                await sideEffect(`schedule log ${schedule.name}`, () => scheduleService.syncScheduleLog(schedule, true));
                                try {
                                    await sideEffect(`schedule telemetry ${schedule.name}`, () => scheduleService.publishScheduleTelemetry(thingsboardClient, emqxClient, schedule, 'end', { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }, resetConfigValues));
                                }
                                catch (telemetryError) {
                                    debugLog(`Failed to publish RPC disable telemetry: ${telemetryError.message}`);
                                }
                                try {
                                    await sideEffect(`end audit ${schedule.name}`, () => (0, schedule_side_effects_1.emitEndSideEffects)(scheduleService, schedule, rpcReport, { tb: thingsboardClient, emqx: emqxClient }, { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }, (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name)));
                                }
                                catch (auditError) {
                                    debugLog(`Failed to publish audit log for RPC disable: ${auditError.message}`);
                                }
                            }
                            else {
                                for (const outcome of (0, schedule_execution_types_1.failedOutcomes)(rpcReport)) {
                                    await sideEffect(`verify-fail notification ${schedule.name}`, () => scheduleService.sendKeyVerifyFailNotification(schedule, 'end', outcome, (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name)));
                                }
                            }
                            (0, schedule_run_identity_1.forgetRunId)(globalContext, schedule.name);
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
                            // Reset config key values to falsy defaults and get the reset values for telemetry
                            const resetConfigValues = scheduleService.clearScheduleConfigValues(schedule.name);
                            scheduleService.clearActiveCommands(schedule.name);
                            await scheduleService.updateScheduleStatus(schedule, "finished");
                            // Clear status history after successful finish so next run will trigger notification
                            clearStatusHistory(schedule.name);
                            // Send success notification
                            await sideEffect(`end notification ${schedule.name}`, () => scheduleService.sendNotificationToBackend(schedule, 'end', true, { runId: (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name) }));
                            (0, schedule_run_identity_1.forgetRunId)(globalContext, schedule.name);
                            await sideEffect(`schedule log ${schedule.name}`, () => scheduleService.syncScheduleLog(schedule, true));
                            // Publish telemetry for manual recovery (all config values cleared)
                            try {
                                const activeCommands = scheduleService.getActiveCommands(schedule.name);
                                const resetCoilCommands = activeCommands.filter(cmd => cmd.fc === 5).map(cmd => (Object.assign(Object.assign({}, cmd), { value: false })));
                                const resetHoldingCommands = activeCommands.filter(cmd => cmd.fc === 6).map(cmd => (Object.assign(Object.assign({}, cmd), { value: 0 })));
                                await sideEffect(`schedule telemetry ${schedule.name}`, () => scheduleService.publishScheduleTelemetry(thingsboardClient, emqxClient, schedule, 'end', { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }, resetConfigValues));
                            }
                            catch (telemetryError) {
                                debugLog(`Failed to publish manual recovery telemetry: ${telemetryError.message}`);
                            }
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
                    const dueSchedules = await scheduleService.getDueSchedulesOrNull();
                    const schedules = dueSchedules !== null && dueSchedules !== void 0 ? dueSchedules : [];
                    // The schedule read opened the MySQL DataSource the process's event outbox lives on.
                    if (dueSchedules)
                        await scheduleService.ensureEventOutbox();
                    // Run hourly cleanup of stale status history entries
                    cleanStaleStatusHistory();
                    const allModbusCoils = scheduleService.getAllModbusCoils();
                    const allModbusHolding = scheduleService.getAllModbusHoldingRegisters();
                    const hasMappedModbusCommands = (schedule) => {
                        let actionObj = {};
                        if (typeof schedule.action === 'string' && schedule.action.trim() !== '') {
                            try {
                                actionObj = JSON.parse(schedule.action);
                            }
                            catch (_a) {
                                return false;
                            }
                        }
                        else if (typeof schedule.action === 'object' && schedule.action !== null) {
                            actionObj = schedule.action;
                        }
                        else {
                            return false;
                        }
                        return Object.entries(actionObj).some(([key, value]) => Object.prototype.hasOwnProperty.call(allModbusCoils, key) || Object.prototype.hasOwnProperty.call(allModbusHolding, key));
                    };
                    for (const schedule of schedules) {
                        if ((0, schedule_tick_guard_1.isScheduleTransitionInFlight)(globalContext, schedule.name)) {
                            debugLog(`Skip ${schedule.name}: start/finish already in flight`);
                            continue;
                        }
                        const isDue = scheduleService.isScheduleDue(schedule);
                        // SCHEDULE_OFF_RETRY (default off): a failed OFF is retried and a restart rewrites the OFF.
                        const offRetryOn = scheduleService.offRetryEnabled();
                        // POWER OUTAGE RECOVERY: Check if schedule is marked "running" but has no active commands
                        // This happens after power outage when activeModbusCommands was cleared on startup
                        const existingActiveCommands = scheduleService.getActiveCommands(schedule.name);
                        const isStaleRunningStatus = schedule.status === "running" &&
                            existingActiveCommands.length === 0 &&
                            hasMappedModbusCommands(schedule);
                        if (isStaleRunningStatus && isDue) {
                            node.warn(`🔄 POWER RECOVERY: Schedule ${schedule.name} marked as "running" but no active commands - restarting`);
                        }
                        // The next window came while the last OFF still fails: drop the retry, start the window.
                        const supersedesRetry = (0, schedule_finish_1.supersedesOffRetry)(offRetryOn, schedule.status, isDue, (0, schedule_finish_1.pendingOffRetry)(globalContext, schedule.name, (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name)));
                        if (isDue && (schedule.status !== "running" || isStaleRunningStatus || supersedesRetry)) {
                            if (!(0, schedule_tick_guard_1.tryBeginScheduleTransition)(globalContext, schedule.name, "start")) {
                                debugLog(`Skip start for ${schedule.name}: transition already in flight`);
                                continue;
                            }
                            try {
                                const supersededCommands = supersedesRetry ? scheduleService.getActiveCommands(schedule.name) : [];
                                const supersededRunId = supersedesRetry ? (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name) : null;
                                if (supersedesRetry) {
                                    node.warn(`⚠️ OFF retry of ${schedule.name} superseded: its next window is due`);
                                    // The new window reports "started" like any other.
                                    clearStatusHistory(schedule.name);
                                }
                                const statusChanged = hasStatusChanged(schedule.name, "running");
                                const holdingRegisters = scheduleService.getAllModbusHoldingRegisters();
                                let actionObj = {};
                                if (typeof schedule.action === 'string' && schedule.action.trim() !== '') {
                                    try {
                                        actionObj = JSON.parse(schedule.action);
                                    }
                                    catch (err) { /* ignore parse error */ }
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
                                // A restart inside the window continues the run it interrupted (same runId, ADR-033).
                                const startRunId = (isStaleRunningStatus && (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name)) || (0, uuid_1.v4)();
                                let unusedResetSteps = [];
                                if (resetKeys.length > 0) {
                                    const unusedReset = await scheduleService.resetModbusCommands(modbusClient, resetKeys, schedule, false, { runId: startRunId, unusedHoldingReset: true });
                                    unusedResetSteps = unusedReset.report.steps;
                                }
                                const { holdingCommands, coilCommands, configParameters } = scheduleService.mapScheduleToModbus(schedule);
                                const publishedConfigParams = [];
                                if (configParameters && configParameters.length > 0) {
                                    // Clear dedup cache for config keys to ensure publish goes through
                                    scheduleService.clearPublishedValueCacheForKeys(configParameters.map(cp => cp.key));
                                    for (const configParam of configParameters) {
                                        try {
                                            await (0, resilience_utils_1.executeWithTimeout)(() => scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam), SIDE_EFFECT_TIMEOUT_MS, `Config publish ${configParam.key} timed out after ${SIDE_EFFECT_TIMEOUT_MS}ms`);
                                            publishedConfigParams.push(configParam);
                                            debugLog(`Published config parameter: ${configParam.key}=${configParam.value} for schedule ${schedule.name}`);
                                        }
                                        catch (error) {
                                            node.error(`Failed to publish config parameter ${configParam.key}: ${error.message}`);
                                        }
                                    }
                                }
                                if (await scheduleService.canExecuteCommands(schedule.name, holdingCommands, coilCommands)) {
                                    await scheduleService.updateScheduleStatus(schedule, "running");
                                    // ARBITER_MODE=enforce: managed coils are claimed (schedule:<name>), not written.
                                    const startArbiter = (0, schedule_arbiter_1.enforcingArbiter)();
                                    const startReport = await (0, schedule_arbiter_1.startScheduleCommands)({
                                        arbiter: startArbiter,
                                        execute: (commands) => scheduleService.executeModbusCommands(modbusClient, commands, schedule, { runId: startRunId }),
                                        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
                                        waterHammerMs: waterHammerDelayMs,
                                        now: farm_time_1.unixMsNow,
                                    }, schedule.name, startRunId, startArbiter ? (0, schedule_arbiter_1.scheduleWindowEndMs)(schedule, (_b = schedule.schedulePlan) !== null && _b !== void 0 ? _b : null, (0, farm_time_1.unixMsNow)()) : null, { holdingCommands, coilCommands });
                                    if (publishedConfigParams.length > 0) {
                                        startReport.steps = [(0, schedule_side_effects_1.configParamsToStep)(publishedConfigParams), ...startReport.steps];
                                    }
                                    if (unusedResetSteps.length > 0) {
                                        startReport.steps = [...unusedResetSteps, ...startReport.steps];
                                    }
                                    scheduleService.applyStartCommandStore(schedule.name, [...holdingCommands, ...coilCommands]);
                                    (0, schedule_run_identity_1.rememberRunId)(globalContext, schedule.name, startRunId);
                                    // A new run: an OFF retry an earlier run left behind is over.
                                    if ((0, schedule_finish_1.clearOffFailure)(globalContext, schedule.name) && supersedesRetry) {
                                        await sideEffect(`off retry superseded audit ${schedule.name}`, () => scheduleService.publishAuditLog(thingsboardClient, emqxClient, schedule, 'end', {
                                            holdingCommands: supersededCommands.filter(cmd => cmd.fc === 6),
                                            coilCommands: supersededCommands.filter(cmd => cmd.fc === 5),
                                        }, false, 'off_retry_superseded', { runId: supersededRunId !== null && supersededRunId !== void 0 ? supersededRunId : undefined, steps: [] }));
                                    }
                                    if (statusChanged) {
                                        // ADR-033: "started" only after the start verify passed; a miss is reported by
                                        // the verify-fail notifications that emitStartSideEffects sends below.
                                        if ((0, schedule_side_effects_1.startNotificationDue)(startReport)) {
                                            await sideEffect(`start notification ${schedule.name}`, () => scheduleService.sendNotificationToBackend(schedule, 'start', true, { runId: startRunId }));
                                        }
                                        await sideEffect(`schedule log ${schedule.name}`, () => scheduleService.syncScheduleLog(schedule, true));
                                        try {
                                            const configValuesForTelemetry = {};
                                            for (const cp of configParameters) {
                                                configValuesForTelemetry[cp.key] = cp.value;
                                            }
                                            await sideEffect(`schedule telemetry ${schedule.name}`, () => scheduleService.publishScheduleTelemetry(thingsboardClient, emqxClient, schedule, 'start', { holdingCommands, coilCommands }, configValuesForTelemetry));
                                        }
                                        catch (telemetryError) {
                                            debugLog(`Failed to publish schedule start telemetry: ${telemetryError.message}`);
                                        }
                                        try {
                                            await sideEffect(`start audit ${schedule.name}`, () => (0, schedule_side_effects_1.emitStartSideEffects)(scheduleService, schedule, startReport, { tb: thingsboardClient, emqx: emqxClient }, { holdingCommands, coilCommands }, startRunId));
                                        }
                                        catch (auditError) {
                                            debugLog(`Failed to publish audit log for schedule start: ${auditError.message}`);
                                        }
                                    }
                                    else {
                                        for (const outcome of (0, schedule_execution_types_1.failedOutcomes)(startReport)) {
                                            await sideEffect(`verify-fail notification ${schedule.name}`, () => scheduleService.sendKeyVerifyFailNotification(schedule, 'start', outcome, startRunId));
                                        }
                                    }
                                }
                            }
                            finally {
                                (0, schedule_tick_guard_1.endScheduleTransition)(globalContext, schedule.name);
                            }
                        }
                        else if (schedule.status === "running" && isDue) {
                            // Schedule still running and still due — no action needed
                        }
                        else if (schedule.status === "running" && !isDue) {
                            if (!(0, schedule_tick_guard_1.tryBeginScheduleTransition)(globalContext, schedule.name, "finish")) {
                                debugLog(`Skip finish for ${schedule.name}: transition already in flight`);
                                continue;
                            }
                            try {
                                const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
                                delete lastCheckTimestamps[schedule.name];
                                globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
                                const storedCommands = scheduleService.getActiveCommands(schedule.name);
                                // SCHEDULE_OFF_RETRY on: a restart cleared the active commands of a run that is still
                                // running, so its OFF is rebuilt from the schedule or the outputs it turned ON would
                                // stay ON. Off: only the stored commands are written.
                                // ARBITER_MODE=enforce: the run's claims are released (water-hammer order) and the
                                // arbiter turns its managed coils off; only the other commands are written here.
                                const arbiterFinish = await scheduleService.beginScheduleFinish(schedule.name, storedCommands.length > 0 || !offRetryOn
                                    ? storedCommands
                                    : (0, schedule_finish_1.rebuildOffCommands)(scheduleService.mapScheduleToModbus(schedule)));
                                const activeCommands = arbiterFinish.commands;
                                const holdingRegisters = scheduleService.getAllModbusHoldingRegisters();
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
                                // An earlier OFF of this run failed: write only the commands still active, but
                                // report the first attempt's full list once the OFF passed.
                                const eventRunId = (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name);
                                const offRetry = offRetryOn && storedCommands.length > 0
                                    ? (0, schedule_finish_1.pendingOffRetry)(globalContext, schedule.name, eventRunId)
                                    : null;
                                const allResetCommands = (_c = offRetry === null || offRetry === void 0 ? void 0 : offRetry.commands) !== null && _c !== void 0 ? _c : scheduleService.mergeValveProgramOffCommand([...activeCommands, ...extraResetCommands]);
                                const writeCommands = offRetry ? activeCommands : allResetCommands;
                                const finishRunId = (0, uuid_1.v4)();
                                let finishReport = {
                                    runId: finishRunId,
                                    action: 'end',
                                    scheduleId: schedule.name,
                                    steps: [],
                                };
                                let resetSuccessful = true;
                                if (writeCommands.length > 0) {
                                    const resetResult = await scheduleService.resetModbusCommands(modbusClient, writeCommands, schedule, true, { runId: finishRunId, impliedPumps: !offRetry || (0, schedule_finish_1.retryNeedsImpliedPumps)(writeCommands) });
                                    finishReport = resetResult.report;
                                    resetSuccessful = resetResult.allSuccessful;
                                }
                                await arbiterFinish.complete(finishReport);
                                const finish = (0, schedule_finish_1.decideFinish)({ allSuccessful: resetSuccessful, report: finishReport }, writeCommands);
                                if (!finish.done && !offRetryOn) {
                                    // Flag off: the run finishes below and the verify-fail notifications report the miss.
                                    node.warn(`❌ OFF failed for ${schedule.name} (${finish.failedKeys.join(', ')}), SCHEDULE_OFF_RETRY is off: run finished`);
                                }
                                if (!finish.done && offRetryOn) {
                                    // Not completed: the run stays running and the next tick retries only these.
                                    scheduleService.storeActiveCommands(schedule.name, finish.retainCommands);
                                    node.warn(`❌ OFF failed for ${schedule.name} (${finish.failedKeys.join(', ')}), retrying next tick`);
                                    if ((0, schedule_finish_1.noteOffFailure)(globalContext, schedule.name, eventRunId, allResetCommands, finishReport)) {
                                        for (const outcome of (0, schedule_finish_1.offFailures)(finishReport)) {
                                            await sideEffect(`verify-fail notification ${schedule.name}`, () => scheduleService.sendKeyVerifyFailNotification(schedule, 'end', outcome, eventRunId));
                                        }
                                    }
                                    // Outbox only; raised once per failure, so a retry each tick stores nothing new.
                                    await sideEffect(`off-failed alarm ${schedule.name}`, () => scheduleService.raiseOffFailedAlarm(schedule, (0, schedule_finish_1.offFailures)(finishReport), eventRunId));
                                    continue;
                                }
                                (0, schedule_finish_1.clearOffFailure)(globalContext, schedule.name);
                                // Outbox only; a no-op unless this schedule's OFF-failed alarm is raised (also after a restart).
                                if (finish.done) {
                                    await sideEffect(`off-failed alarm clear ${schedule.name}`, () => scheduleService.clearOffFailedAlarm(schedule, eventRunId));
                                }
                                // After retries the end audit also lists the keys that passed on the failed attempts.
                                finishReport = (0, schedule_finish_1.offReportForAudit)(offRetry, finishReport);
                                scheduleService.clearActiveCommands(schedule.name);
                                const statusChanged = hasStatusChanged(schedule.name, "finished");
                                const resetConfigValues = scheduleService.clearScheduleConfigValues(schedule.name);
                                await scheduleService.updateScheduleStatus(schedule, "finished");
                                clearStatusHistory(schedule.name);
                                const resetCoilCommands = allResetCommands.filter(cmd => cmd.fc === 5).map(cmd => (Object.assign(Object.assign({}, cmd), { value: false })));
                                const resetHoldingCommands = allResetCommands.filter(cmd => cmd.fc === 6).map(cmd => (Object.assign(Object.assign({}, cmd), { value: 0 })));
                                if (statusChanged) {
                                    await sideEffect(`end notification ${schedule.name}`, () => scheduleService.sendNotificationToBackend(schedule, 'end', true, { runId: (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name) }));
                                    await sideEffect(`schedule log ${schedule.name}`, () => scheduleService.syncScheduleLog(schedule, true));
                                    try {
                                        await sideEffect(`schedule telemetry ${schedule.name}`, () => scheduleService.publishScheduleTelemetry(thingsboardClient, emqxClient, schedule, 'end', { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }, resetConfigValues));
                                    }
                                    catch (telemetryError) {
                                        debugLog(`Failed to publish schedule end telemetry: ${telemetryError.message}`);
                                    }
                                    try {
                                        await sideEffect(`end audit ${schedule.name}`, () => (0, schedule_side_effects_1.emitEndSideEffects)(scheduleService, schedule, finishReport, { tb: thingsboardClient, emqx: emqxClient }, { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }, (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name)));
                                    }
                                    catch (auditError) {
                                        debugLog(`Failed to publish audit log for schedule end: ${auditError.message}`);
                                    }
                                }
                                else {
                                    for (const outcome of (0, schedule_execution_types_1.failedOutcomes)(finishReport)) {
                                        await sideEffect(`verify-fail notification ${schedule.name}`, () => scheduleService.sendKeyVerifyFailNotification(schedule, 'end', outcome, (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name)));
                                    }
                                }
                                (0, schedule_run_identity_1.forgetRunId)(globalContext, schedule.name);
                            }
                            finally {
                                (0, schedule_tick_guard_1.endScheduleTransition)(globalContext, schedule.name);
                            }
                        }
                        else {
                            debugLog(`Schedule ${schedule.name} skipped (status: ${schedule.status}, due: ${isDue})`);
                        }
                    }
                    // AUTO-RECOVERY: Check for stuck 'running' schedules and try to recover
                    // This runs on every input trigger and handles cases where reset failed but devices were manually turned off
                    try {
                        // A run whose OFF failed is retried by its finish branch, not finished here on a read.
                        const offRetryOn = scheduleService.offRetryEnabled();
                        const recoverableSchedules = schedules.filter((schedule) => !(0, schedule_tick_guard_1.isScheduleTransitionInFlight)(globalContext, schedule.name)
                            && !(offRetryOn && (0, schedule_finish_1.pendingOffRetry)(globalContext, schedule.name, (0, schedule_run_identity_1.activeRunId)(globalContext, schedule.name))));
                        await scheduleService.checkAndRecoverStuckSchedules(modbusClient, recoverableSchedules);
                    }
                    catch (error) {
                        debugLog(`Error in recovery check: ${error.message}`);
                    }
                    // A status change whose POST to the backend failed (backend down at a window end, e.g. right
                    // after a reboot) is kept as is_synced = 0 and re-posted here, so the server never keeps a
                    // stale "running" row (friction log 2026-10-24).
                    try {
                        await scheduleService.retryUnsyncedStatuses();
                    }
                    catch (error) {
                        debugLog(`Error retrying unsynced statuses: ${error.message}`);
                    }
                    const enabledScheduleIds = schedules.map(s => s.name);
                    // A run whose schedule left the enabled list (plan off, schedule off by sync, deleted)
                    // is turned off, finished and reported as stopped (ADR-033).
                    await (0, schedule_stop_cleanup_1.stopRunsNoLongerEnabled)({
                        activeCommands: () => activeModbusCommands,
                        resetCommands: async (scheduleId, commands) => {
                            // ARBITER_MODE=enforce: release the stopped run's claims; managed coils are the arbiter's.
                            const arbiterFinish = await scheduleService.beginScheduleFinish(scheduleId, commands);
                            const { report, allSuccessful } = await scheduleService.resetModbusCommands(modbusClient, arbiterFinish.commands);
                            await arbiterFinish.complete(report);
                            if (!allSuccessful)
                                debugLog(`Failed to reset commands for ${scheduleId}, retaining in activeModbusCommands`);
                            return allSuccessful;
                        },
                        clearActiveCommands: (scheduleId) => scheduleService.clearActiveCommands(scheduleId),
                        loadStopped: (scheduleId) => scheduleService.loadStoppedSchedule(scheduleId),
                        finishSchedule: (stopped) => sideEffect(`finish stopped ${stopped.name}`, () => scheduleService.updateScheduleStatus(stopped, "finished")),
                        sendStopped: (stopped, reason, runId) => sideEffect(`stopped notification ${stopped.name}`, () => scheduleService.sendStoppedNotification(stopped, reason, runId)),
                        runIds: globalContext,
                    }, dueSchedules === null ? null : enabledScheduleIds);
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
            }).catch(() => {
                // Only the tick watchdog rejects here (the tick catches its own errors); onJobTimeout reported it.
            });
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

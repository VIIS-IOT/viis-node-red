import { NodeAPI, Node } from "node-red";

import { ModbusClientCore } from "../../core/modbus-client";
import { MqttClientCore, MqttConfig } from "../../core/mqtt-client";
import { ScheduleService } from "./viis-schedule-executor-service";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
import { TabiotSchedule } from "../../orm/entities/schedule/TabiotSchedule";
import moment from "moment";
import { ActiveModbusCommands, ManualModbusOverrides, RpcPayload, RpcControlResult, ScheduleExecutorNodeDef } from "./type";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { ProtectionGateService, resolveProtectionGate } from "../viis-device-protection/services/protection-gate-service";
import { ExecutionReport, failedOutcomes } from "./schedule-execution-types";
import { configParamsToStep, emitEndSideEffects, emitStartSideEffects } from "./schedule-side-effects";
import {
    SCHEDULE_IN_FLIGHT_KEY,
    clearAllScheduleTransitions,
    createSerializedQueue,
    endScheduleTransition,
    isScheduleTransitionInFlight,
    tryBeginScheduleTransition,
} from "./schedule-tick-guard";
import { v4 as uuidv4 } from "uuid";
import { resolveThingsboardMqttBroker } from "../../core/demeter-mqtt-topics";

module.exports = function (RED: NodeAPI) {
    function ScheduleExecutorNode(this: Node, config: ScheduleExecutorNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize global activeModbusCommands with type
        const globalContext = node.context().global;

        // STARTUP RECOVERY: Track if this is a fresh startup (power cycle recovery)
        // Use a unique startup ID to detect restarts
        const currentStartupId = `startup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const lastStartupId = globalContext.get("scheduleExecutorStartupId") as string || null;
        const isStartupRecovery = !lastStartupId || lastStartupId !== currentStartupId;

        if (isStartupRecovery) {
            // Mark this startup
            globalContext.set("scheduleExecutorStartupId", currentStartupId);
            globalContext.set("scheduleExecutorStartupTime", Date.now());

            // CRITICAL: Clear all potentially stale global state on startup
            // This prevents stuck schedules after power outage
            const existingActiveCommands = globalContext.get("activeModbusCommands") as ActiveModbusCommands || {};
            const existingStatusHistory = globalContext.get("scheduleStatusHistory") as Record<string, string> || {};
            const existingTimestamps = globalContext.get("scheduleLastCheckTimestamps") as Record<string, number> || {};

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
                globalContext.set("activeModbusCommands", {} as ActiveModbusCommands);
                globalContext.set("scheduleStatusHistory", {} as Record<string, string>);
                globalContext.set("scheduleLastCheckTimestamps", {} as Record<string, number>);
                globalContext.set("manualModbusOverrides", {} as ManualModbusOverrides);

                node.warn(`✅ STARTUP RECOVERY: Cleared stale active state - schedules will start fresh`);
                node.warn(`ℹ️ Preserved configKeyValues and scheduleConfigKeys (config structure maintained)`);
            } else {
                // Initialize empty objects for fresh startup
                globalContext.set("activeModbusCommands", {} as ActiveModbusCommands);
                globalContext.set("manualModbusOverrides", {} as ManualModbusOverrides);
                globalContext.set("scheduleLastCheckTimestamps", {} as Record<string, number>);
                globalContext.set("scheduleStatusHistory", {} as Record<string, string>);
                // Initialize config tracking but don't clear if exists (preserve structure)
                if (!globalContext.get("scheduleConfigKeys")) {
                    globalContext.set("scheduleConfigKeys", {} as Record<string, string[]>);
                }
                if (!globalContext.get("configKeyValues")) {
                    globalContext.set("configKeyValues", {} as Record<string, any>);
                }
            }
        } else {
            // Not a fresh startup, just ensure variables exist
            if (!globalContext.get("activeModbusCommands")) {
                globalContext.set("activeModbusCommands", {} as ActiveModbusCommands);
            }
            if (!globalContext.get("manualModbusOverrides")) {
                globalContext.set("manualModbusOverrides", {} as ManualModbusOverrides);
            }
            if (!globalContext.get("scheduleLastCheckTimestamps")) {
                globalContext.set("scheduleLastCheckTimestamps", {} as Record<string, number>);
            }
            if (!globalContext.get("scheduleStatusHistory")) {
                globalContext.set("scheduleStatusHistory", {} as Record<string, string>);
            }
            if (!globalContext.get("scheduleConfigKeys")) {
                globalContext.set("scheduleConfigKeys", {} as Record<string, string[]>);
            }
            if (!globalContext.get("configKeyValues")) {
                globalContext.set("configKeyValues", {} as Record<string, any>);
            }
        }

        if (isStartupRecovery) {
            clearAllScheduleTransitions(globalContext);
        } else if (!globalContext.get(SCHEDULE_IN_FLIGHT_KEY)) {
            globalContext.set(SCHEDULE_IN_FLIGHT_KEY, {});
        }

        node.name = config.name;
        const debugEnable = config.debugEnable; // Read debugEnable from config
        const verifyAfterWrite = config.verifyAfterWrite !== false; // Default to true if not specified
        const skipCoilVerify = config.skipCoilVerify !== false; // Default to true (skip) if not specified
        const cleanupInterval = config.cleanupInterval || 8; // Read cleanupInterval from config, default 8 minutes

        // Multi-board state variables
        let currentBoardId: string | undefined = config.boardId;
        let isMultiBoardMode: boolean = false;
        let currentModbusConfig: any = null;

        // Helper function for conditional logging
        const debugLog = (message: string) => {
            if (debugEnable) {
                node.warn(message);
            }
        };

        debugLog(`Cleanup interval set to: ${cleanupInterval} minutes`);

        // Initialize GlobalContextHelper
        const globalHelper = new GlobalContextHelper(node.context());

        // Helper function to check and track status changes
        const hasStatusChanged = (scheduleName: string, newStatus: string): boolean => {
            const statusHistory: Record<string, string> = (globalContext.get("scheduleStatusHistory") as Record<string, string>) || {};
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
        const clearStatusHistory = (scheduleName: string): void => {
            const statusHistory: Record<string, string> = (globalContext.get("scheduleStatusHistory") as Record<string, string>) || {};
            if (statusHistory[scheduleName]) {
                debugLog(`Clearing status history for ${scheduleName} (was: ${statusHistory[scheduleName]})`);
                delete statusHistory[scheduleName];
                globalContext.set("scheduleStatusHistory", statusHistory);
            }
        };

        // Helper function to check and clean stale "running" entries in status history
        // This runs periodically to clean up schedules that are stuck as "running"
        const cleanStaleStatusHistory = (): void => {
            const statusHistory: Record<string, string> = (globalContext.get("scheduleStatusHistory") as Record<string, string>) || {};
            const lastCleanupKey = "scheduleStatusHistoryLastCleanup";
            const lastCleanup = globalContext.get(lastCleanupKey) as number || 0;
            const now = Date.now();
            const cleanupIntervalMs = cleanupInterval * 60 * 1000; // Convert minutes to milliseconds

            // Run cleanup based on configured interval
            if (now - lastCleanup < cleanupIntervalMs) {
                return;
            }

            let cleanedCount = 0;
            const currentRunningSchedules = Object.keys(
                (globalContext.get("activeModbusCommands") as Record<string, any>) || {}
            );

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
        let scheduleService: ScheduleService;
        try {
            scheduleService = new ScheduleService(node, verifyAfterWrite, debugEnable, skipCoilVerify);
            debugLog("ScheduleService initialized successfully");
        } catch (error) {
            node.error(`Failed to initialize ScheduleService: ${(error as Error).message}`);
            return;
        }

        // Connect to ProtectionGateService if available
        const liveGate = resolveProtectionGate(globalContext.get('protectionGateService'));
        if (liveGate) {
            scheduleService.setProtectionGate(liveGate);
            debugLog("ProtectionGateService connected to ScheduleService");
        } else {
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
                    } else if (typeof boardsConfig === 'string') {
                        boards = JSON.parse(boardsConfig);
                    } else {
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
                } catch (e) {
                    node.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                }
            }

            return {
                mode: 'single',
                config: {
                    type: (globalHelper.getEnvVar("MODBUS_TYPE", "TCP") as "TCP" | "RTU"),
                    host: globalHelper.getEnvVar("MODBUS_HOST", "localhost"),
                    tcpPort: globalHelper.getNumericEnvVar("MODBUS_TCP_PORT", 502),
                    serialPort: globalHelper.getEnvVar("MODBUS_SERIAL_PORT", "/dev/ttyUSB0"),
                    baudRate: globalHelper.getNumericEnvVar("MODBUS_BAUD_RATE", 9600),
                    parity: (globalHelper.getEnvVar("MODBUS_PARITY", "none") as "none" | "even" | "odd"),
                    unitId: globalHelper.getNumericEnvVar("MODBUS_UNIT_ID", 1),
                    timeout: globalHelper.getNumericEnvVar("MODBUS_TIMEOUT", 5000),
                    reconnectInterval: globalHelper.getNumericEnvVar("MODBUS_RECONNECT_INTERVAL", 5000),
                }
            };
        };

        // Initialize Modbus configuration
        const configData = readModbusConfig();
        currentModbusConfig = { ...configData };

        // Auto-detect mode
        if (configData.mode === 'multi') {
            isMultiBoardMode = true;
            debugLog(`Multi-board mode detected with ${configData.boards.length} boards`);

            const multiConfig: MultiModbusConfig = {
                mode: 'multi',
                defaultBoard: configData.defaultBoard,
                boards: configData.boards
            };
            ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
        } else {
            isMultiBoardMode = false;
            debugLog(`Single-board mode: ${configData.config.type} ${configData.config.host}:${configData.config.tcpPort}`);
        }

        // ThingsBoard MQTT configuration
        const thingsboardConfig: MqttConfig = {
            broker: resolveThingsboardMqttBroker(globalHelper),
            deviceId: globalHelper.getEnvVar("DEVICE_ID", ""),
            clientId: `node-red-tb-${Math.random().toString(16).substring(2, 10)}`,
            username: globalHelper.getEnvVar("DEVICE_ACCESS_TOKEN", ""),
            password: globalHelper.getEnvVar("THINGSBOARD_PASSWORD", ""),
            qos: 1 as 0 | 1 | 2,
        };

        // EMQX (local) MQTT configuration
        const emqxConfig: MqttConfig = {
            broker: `mqtt://${globalHelper.getEnvVar("EMQX_HOST", "emqx")}:${globalHelper.getEnvVar("EMQX_PORT", "1883")}`,
            clientId: `node-red-emqx-${Math.random().toString(16).substring(2, 10)}`,
            username: globalHelper.getEnvVar("EMQX_USERNAME", ""),
            password: globalHelper.getEnvVar("EMQX_PASSWORD", ""),
            qos: 1 as 0 | 1 | 2,
        };

        // Get Modbus client
        let modbusClient: ModbusClientCore;
        let modbusUnitId: number;

        // Async initialization - defer Modbus client setup
        const modbusClientPromise = (async () => {
            if (isMultiBoardMode) {
                const boardToUse = currentBoardId || configData.defaultBoard;
                debugLog(`Getting client for board: ${boardToUse}`);
                const client = await ClientRegistry.getModbusClientV2(boardToUse, node);
                // Get unitId from board config
                const boardConfig = configData.boards.find((b: any) => b.id === boardToUse);
                return { client, unitId: boardConfig?.unitId || 1 };
            } else {
                const client = await ClientRegistry.getModbusClientV2(configData.config, node);
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

        const enqueueInput = createSerializedQueue();

        node.on("input", function (msg, send, done) {
            enqueueInput(async () => {
            try {
                // Ensure Modbus client is ready before processing
                if (!modbusClient) {
                    await modbusClientPromise.then(({ client, unitId }) => {
                        modbusClient = client;
                        modbusUnitId = unitId;
                    });
                }

                // Initialize MQTT clients
                const thingsboardClient: MqttClientCore = await ClientRegistry.getThingsboardMqttClient(thingsboardConfig, node);
                const emqxClient: MqttClientCore = await ClientRegistry.getLocalMqttClient(emqxConfig, node);
                debugLog(`MQTT TB connected: ${thingsboardClient.isConnected()}, EMQX connected: ${emqxClient.isConnected()}`);

                ClientRegistry.logConnectionCounts(node);

                // Check and clear overrides if no schedules are running
                const activeModbusCommands: ActiveModbusCommands = node.context().global.get("activeModbusCommands") as ActiveModbusCommands || {};
                if (Object.keys(activeModbusCommands).length === 0) {
                    node.context().global.set("manualModbusOverrides", {});
                    debugLog("No schedules running. Cleared manualModbusOverrides.");
                }

                // Handle RPC command
                if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload && (msg.payload as RpcPayload).method === "schedule-disable-by-backend") {
                    const payload = msg.payload as RpcPayload;
                    const params = payload.params || {};
                    const scheduleId = params.scheduleId;

                    if (!scheduleId) {
                        node.error("Missing scheduleId in schedule-disable-by-backend RPC command");
                        node.status({ fill: "red", shape: "ring", text: "Missing scheduleId" });
                        done(new Error("Missing scheduleId"));
                        return;
                    }

                    const schedules: TabiotSchedule[] = await scheduleService.getDueSchedules();
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
                        const lastCheckTimestamps: Record<string, number> = (globalContext.get("scheduleLastCheckTimestamps") as Record<string, number>) || {};
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
                                } catch (error) {
                                    node.error(`Failed to publish config parameter ${configParam.key}: ${(error as Error).message}`);
                                }
                            }
                        }

                        // Reset time_valve_ and set_flow keys
                        const holdingRegisters: Record<string, number> = scheduleService.getAllModbusHoldingRegisters();
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
                        const activeCmdKey = (cmd: any) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set([...activeCommands, ...holdingCommands, ...coilCommands].map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = scheduleService.mergeValveProgramOffCommand(
                            [...activeCommands, ...holdingCommands, ...coilCommands, ...extraResetCommands]
                        );

                        const rpcRunId = uuidv4();
                        let rpcReport: ExecutionReport = {
                            runId: rpcRunId,
                            action: 'end',
                            scheduleId: schedule.name,
                            steps: [],
                        };
                        if (allResetCommands.length > 0) {
                            const resetResult = await scheduleService.resetModbusCommands(
                                modbusClient, allResetCommands, schedule, true, { runId: rpcRunId }
                            );
                            rpcReport = resetResult.report;
                            scheduleService.clearActiveCommands(schedule.name);
                            debugLog(`Cleared active commands for schedule ${schedule.name} via RPC`);
                        }

                        const statusChanged = hasStatusChanged(schedule.name, "finished");
                        schedule.status = "finished";
                        schedule.enable = 0;

                        const resetConfigValues = scheduleService.clearScheduleConfigValues(schedule.name);

                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        clearStatusHistory(schedule.name);

                        const resetCoilCommands = allResetCommands.filter(cmd => cmd.fc === 5).map(cmd => ({ ...cmd, value: false }));
                        const resetHoldingCommands = allResetCommands.filter(cmd => cmd.fc === 6).map(cmd => ({ ...cmd, value: 0 }));

                        if (statusChanged) {
                            await scheduleService.sendNotificationToBackend(schedule, 'end', true);
                            await scheduleService.syncScheduleLog(schedule, true);

                            try {
                                await scheduleService.publishScheduleTelemetry(
                                    thingsboardClient,
                                    emqxClient,
                                    schedule,
                                    'end',
                                    { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands },
                                    resetConfigValues
                                );
                            } catch (telemetryError) {
                                debugLog(`Failed to publish RPC disable telemetry: ${(telemetryError as Error).message}`);
                            }

                            try {
                                await emitEndSideEffects(
                                    scheduleService,
                                    schedule,
                                    rpcReport,
                                    { tb: thingsboardClient, emqx: emqxClient },
                                    { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }
                                );
                            } catch (auditError) {
                                debugLog(`Failed to publish audit log for RPC disable: ${(auditError as Error).message}`);
                            }
                        } else {
                            for (const outcome of failedOutcomes(rpcReport)) {
                                await scheduleService.sendKeyVerifyFailNotification(schedule, 'end', outcome);
                            }
                        }
                    } else {
                        debugLog(`Schedule id: ${schedule.name}, label: ${schedule.label} is not running, only disabling`);
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, schedule.status as "running" | "finished");
                    }

                    node.status({ fill: "green", shape: "dot", text: "RPC processed" });
                    send(msg);
                    done();
                    return;
                }

                // Handle RPC command: confirm-devices-off
                // User manually confirms that devices have been turned off (for recovery from stuck 'running' status)
                if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload && (msg.payload as RpcPayload).method === "confirm-devices-off") {
                    const payload = msg.payload as RpcPayload;
                    const params = payload.params || {};
                    const scheduleId = params.scheduleId;
                    const verifyDevices = params.verifyDevices !== false; // Default to true

                    if (!scheduleId) {
                        node.error("Missing scheduleId in confirm-devices-off RPC command");
                        node.status({ fill: "red", shape: "ring", text: "Missing scheduleId" });
                        done(new Error("Missing scheduleId"));
                        return;
                    }

                    const schedules: TabiotSchedule[] = await scheduleService.getDueSchedules();
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
                                    let readResult: { data: any[] };
                                    let currentValue: number | boolean;

                                    if (cmd.fc === 5) {
                                        readResult = await modbusClient.readCoils(cmd.address, 1);
                                        currentValue = Boolean(readResult.data[0]);
                                        if (currentValue !== false) {
                                            confirmSuccess = false;
                                            node.warn(`⚠️ Device at coil ${cmd.address} (${cmd.key}) is still ON`);
                                        }
                                    } else if (cmd.fc === 6) {
                                        readResult = await modbusClient.readHoldingRegisters(cmd.address, 1);
                                        currentValue = Number(readResult.data[0]);
                                        if (currentValue !== 0) {
                                            confirmSuccess = false;
                                            node.warn(`⚠️ Register at ${cmd.address} (${cmd.key}) is still ${currentValue}`);
                                        }
                                    }
                                } catch (error) {
                                    node.error(`Error verifying device status: ${(error as Error).message}`);
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
                        await scheduleService.sendNotificationToBackend(schedule, 'end', true);
                        await scheduleService.syncScheduleLog(schedule, true);

                        // Publish telemetry for manual recovery (all config values cleared)
                        try {
                            const activeCommands = scheduleService.getActiveCommands(schedule.name);
                            const resetCoilCommands = activeCommands.filter(cmd => cmd.fc === 5).map(cmd => ({ ...cmd, value: false }));
                            const resetHoldingCommands = activeCommands.filter(cmd => cmd.fc === 6).map(cmd => ({ ...cmd, value: 0 }));
                            await scheduleService.publishScheduleTelemetry(
                                thingsboardClient,
                                emqxClient,
                                schedule,
                                'end',
                                { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands },
                                resetConfigValues
                            );
                        } catch (telemetryError) {
                            debugLog(`Failed to publish manual recovery telemetry: ${(telemetryError as Error).message}`);
                        }

                        node.warn(`✅ MANUAL RECOVERY: Schedule ${schedule.name} confirmed OFF and set to finished`);
                        node.status({ fill: "green", shape: "dot", text: "Confirmed OFF" });
                    } else {
                        node.warn(`❌ MANUAL RECOVERY FAILED: Some devices are still ON for ${schedule.name}`);
                        node.status({ fill: "red", shape: "ring", text: "Devices still ON" });
                    }

                    send(msg);
                    done();
                    return;
                }

                // Handle RPC command: control (general Modbus control)
                if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload) {
                    const payload = msg.payload as RpcPayload;

                    if (payload.method === "control" && payload.params) {
                        const results: any[] = [];

                        for (const [key, value] of Object.entries(payload.params)) {
                            if (key === 'scheduleId') continue;

                            const result = scheduleService.processRpcControlCommand(key, value);
                            results.push({ key, ...result });

                            if (result.success && result.action === 'config') {
                                debugLog(`RPC control: ${key}=${value} stored in configKeyValues`);
                            } else if (result.success && result.action === 'modbus') {
                                debugLog(`RPC control: ${key}=${value} should be handled by modbus (address: ${result.result?.address})`);
                            } else {
                                node.error(`RPC control failed for ${key}=${value}`);
                            }
                        }

                        const responseMsg = {
                            ...msg,
                            payload: {
                                method: payload.method,
                                results: results,
                                timestamp: Date.now()
                            }
                        };

                        node.status({ fill: "green", shape: "dot", text: "RPC control processed" });
                        send(responseMsg);
                        done();
                        return;
                    }

                    debugLog(`Unknown RPC method: ${payload.method}`);
                    return null;
                }

                const schedules: TabiotSchedule[] = await scheduleService.getDueSchedules();

                // Run hourly cleanup of stale status history entries
                cleanStaleStatusHistory();

                const allModbusCoils = scheduleService.getAllModbusCoils();
                const allModbusHolding = scheduleService.getAllModbusHoldingRegisters();
                const hasMappedModbusCommands = (schedule: TabiotSchedule): boolean => {
                    let actionObj: Record<string, any> = {};
                    if (typeof schedule.action === 'string' && schedule.action.trim() !== '') {
                        try {
                            actionObj = JSON.parse(schedule.action);
                        } catch {
                            return false;
                        }
                    } else if (typeof schedule.action === 'object' && schedule.action !== null) {
                        actionObj = schedule.action as Record<string, any>;
                    } else {
                        return false;
                    }

                    return Object.entries(actionObj).some(([key, value]) =>
                        Object.prototype.hasOwnProperty.call(allModbusCoils, key) || Object.prototype.hasOwnProperty.call(allModbusHolding, key)
                    );
                };

                for (const schedule of schedules) {
                    if (isScheduleTransitionInFlight(globalContext, schedule.name)) {
                        debugLog(`Skip ${schedule.name}: start/finish already in flight`);
                        continue;
                    }

                    const isDue = scheduleService.isScheduleDue(schedule);

                    // POWER OUTAGE RECOVERY: Check if schedule is marked "running" but has no active commands
                    // This happens after power outage when activeModbusCommands was cleared on startup
                    const existingActiveCommands = scheduleService.getActiveCommands(schedule.name);
                    const isStaleRunningStatus = schedule.status === "running" &&
                        existingActiveCommands.length === 0 &&
                        hasMappedModbusCommands(schedule);

                    if (isStaleRunningStatus && isDue) {
                        node.warn(`🔄 POWER RECOVERY: Schedule ${schedule.name} marked as "running" but no active commands - restarting`);
                    }

                    if (isDue && (schedule.status !== "running" || isStaleRunningStatus)) {
                        if (!tryBeginScheduleTransition(globalContext, schedule.name, "start")) {
                            debugLog(`Skip start for ${schedule.name}: transition already in flight`);
                            continue;
                        }
                        try {
                        const statusChanged = hasStatusChanged(schedule.name, "running");

                        const holdingRegisters: Record<string, number> = scheduleService.getAllModbusHoldingRegisters();
                        let actionObj: Record<string, any> = {};
                        if (typeof schedule.action === 'string' && schedule.action.trim() !== '') {
                            try {
                                actionObj = JSON.parse(schedule.action);
                            } catch (err) { /* ignore parse error */ }
                        } else if (typeof schedule.action === 'object' && schedule.action !== null) {
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
                        const startRunId = uuidv4();
                        let unusedResetSteps: ExecutionReport['steps'] = [];
                        if (resetKeys.length > 0) {
                            const unusedReset = await scheduleService.resetModbusCommands(
                                modbusClient, resetKeys, schedule, false, { runId: startRunId, unusedHoldingReset: true }
                            );
                            unusedResetSteps = unusedReset.report.steps;
                        }
                        const { holdingCommands, coilCommands, configParameters } = scheduleService.mapScheduleToModbus(schedule);

                        const publishedConfigParams = [];
                        if (configParameters && configParameters.length > 0) {
                            // Clear dedup cache for config keys to ensure publish goes through
                            scheduleService.clearPublishedValueCacheForKeys(configParameters.map(cp => cp.key));

                            for (const configParam of configParameters) {
                                try {
                                    await scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam);
                                    publishedConfigParams.push(configParam);
                                    debugLog(`Published config parameter: ${configParam.key}=${configParam.value} for schedule ${schedule.name}`);
                                } catch (error) {
                                    node.error(`Failed to publish config parameter ${configParam.key}: ${(error as Error).message}`);
                                }
                            }
                        }

                        if (await scheduleService.canExecuteCommands(schedule.name, holdingCommands, coilCommands)) {
                            await scheduleService.updateScheduleStatus(schedule, "running");
                            const startReport = await scheduleService.executeModbusCommands(
                                modbusClient,
                                { holdingCommands, coilCommands },
                                schedule,
                                { runId: startRunId }
                            );
                            if (publishedConfigParams.length > 0) {
                                startReport.steps = [configParamsToStep(publishedConfigParams), ...startReport.steps];
                            }
                            if (unusedResetSteps.length > 0) {
                                startReport.steps = [...unusedResetSteps, ...startReport.steps];
                            }
                            scheduleService.applyStartCommandStore(schedule.name, [...holdingCommands, ...coilCommands]);

                            if (statusChanged) {
                                await scheduleService.sendNotificationToBackend(schedule, 'start', true);
                                await scheduleService.syncScheduleLog(schedule, true);

                                try {
                                    const configValuesForTelemetry: Record<string, any> = {};
                                    for (const cp of configParameters) {
                                        configValuesForTelemetry[cp.key] = cp.value;
                                    }
                                    await scheduleService.publishScheduleTelemetry(
                                        thingsboardClient,
                                        emqxClient,
                                        schedule,
                                        'start',
                                        { holdingCommands, coilCommands },
                                        configValuesForTelemetry
                                    );
                                } catch (telemetryError) {
                                    debugLog(`Failed to publish schedule start telemetry: ${(telemetryError as Error).message}`);
                                }

                                try {
                                    await emitStartSideEffects(
                                        scheduleService,
                                        schedule,
                                        startReport,
                                        { tb: thingsboardClient, emqx: emqxClient },
                                        { holdingCommands, coilCommands }
                                    );
                                } catch (auditError) {
                                    debugLog(`Failed to publish audit log for schedule start: ${(auditError as Error).message}`);
                                }
                            } else {
                                for (const outcome of failedOutcomes(startReport)) {
                                    await scheduleService.sendKeyVerifyFailNotification(schedule, 'start', outcome);
                                }
                            }
                        }
                        } finally {
                            endScheduleTransition(globalContext, schedule.name);
                        }
                    } else if (schedule.status === "running" && isDue) {
                        // Schedule still running and still due — no action needed
                    } else if (schedule.status === "running" && !isDue) {
                        if (!tryBeginScheduleTransition(globalContext, schedule.name, "finish")) {
                            debugLog(`Skip finish for ${schedule.name}: transition already in flight`);
                            continue;
                        }
                        try {
                        const lastCheckTimestamps: Record<string, number> = (globalContext.get("scheduleLastCheckTimestamps") as Record<string, number>) || {};
                        delete lastCheckTimestamps[schedule.name];
                        globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);

                        const activeCommands = scheduleService.getActiveCommands(schedule.name);
                        const holdingRegisters: Record<string, number> = scheduleService.getAllModbusHoldingRegisters();
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
                        const activeCmdKey = (cmd: any) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set(activeCommands.map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = scheduleService.mergeValveProgramOffCommand(
                            [...activeCommands, ...extraResetCommands]
                        );

                        const finishRunId = uuidv4();
                        let finishReport: ExecutionReport = {
                            runId: finishRunId,
                            action: 'end',
                            scheduleId: schedule.name,
                            steps: [],
                        };
                        if (allResetCommands.length > 0) {
                            const resetResult = await scheduleService.resetModbusCommands(
                                modbusClient, allResetCommands, schedule, true, { runId: finishRunId }
                            );
                            finishReport = resetResult.report;
                        }

                        scheduleService.clearActiveCommands(schedule.name);

                        const statusChanged = hasStatusChanged(schedule.name, "finished");
                        const resetConfigValues = scheduleService.clearScheduleConfigValues(schedule.name);
                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        clearStatusHistory(schedule.name);

                        const resetCoilCommands = allResetCommands.filter(cmd => cmd.fc === 5).map(cmd => ({ ...cmd, value: false }));
                        const resetHoldingCommands = allResetCommands.filter(cmd => cmd.fc === 6).map(cmd => ({ ...cmd, value: 0 }));

                        if (statusChanged) {
                            await scheduleService.sendNotificationToBackend(schedule, 'end', true);
                            await scheduleService.syncScheduleLog(schedule, true);

                            try {
                                await scheduleService.publishScheduleTelemetry(
                                    thingsboardClient,
                                    emqxClient,
                                    schedule,
                                    'end',
                                    { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands },
                                    resetConfigValues
                                );
                            } catch (telemetryError) {
                                debugLog(`Failed to publish schedule end telemetry: ${(telemetryError as Error).message}`);
                            }

                            try {
                                await emitEndSideEffects(
                                    scheduleService,
                                    schedule,
                                    finishReport,
                                    { tb: thingsboardClient, emqx: emqxClient },
                                    { holdingCommands: resetHoldingCommands, coilCommands: resetCoilCommands }
                                );
                            } catch (auditError) {
                                debugLog(`Failed to publish audit log for schedule end: ${(auditError as Error).message}`);
                            }
                        } else {
                            for (const outcome of failedOutcomes(finishReport)) {
                                await scheduleService.sendKeyVerifyFailNotification(schedule, 'end', outcome);
                            }
                        }
                        } finally {
                            endScheduleTransition(globalContext, schedule.name);
                        }
                    } else {
                        debugLog(`Schedule ${schedule.name} skipped (status: ${schedule.status}, due: ${isDue})`);
                    }
                }

                // AUTO-RECOVERY: Check for stuck 'running' schedules and try to recover
                // This runs on every input trigger and handles cases where reset failed but devices were manually turned off
                try {
                    const recoverableSchedules = schedules.filter(
                        (schedule) => !isScheduleTransitionInFlight(globalContext, schedule.name)
                    );
                    await scheduleService.checkAndRecoverStuckSchedules(modbusClient, recoverableSchedules);
                } catch (error) {
                    debugLog(`Error in recovery check: ${(error as Error).message}`);
                }

                const enabledScheduleIds = schedules.map(s => s.name);

                for (const scheduleId in activeModbusCommands) {
                    if (!enabledScheduleIds.includes(scheduleId)) {
                        const commands = activeModbusCommands[scheduleId];
                        const { allSuccessful: resetSuccess } = await scheduleService.resetModbusCommands(modbusClient, commands);
                        if (resetSuccess) {
                            scheduleService.clearActiveCommands(scheduleId);
                            debugLog(`Cleaned up stale commands for schedule ${scheduleId} (not in enabled schedules)`);
                        } else {
                            debugLog(`Failed to reset commands for ${scheduleId}, retaining in activeModbusCommands`);
                        }
                    }
                }

                const statusHistory: Record<string, string> = (globalContext.get("scheduleStatusHistory") as Record<string, string>) || {};
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
            } catch (err) {
                node.error("Error processing schedules: " + (err as Error).message);
                node.status({ fill: "red", shape: "ring", text: "Processing error" });
                done(err);
            }
            });
        });

        node.on("close", function (done: () => void) {
            // Release Modbus client (multi-board aware)
            if (isMultiBoardMode && currentBoardId) {
                ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
            } else {
                ClientRegistry.releaseClientV2("modbus", node);
            }

            ClientRegistry.releaseClient("thingsboard", node);
            ClientRegistry.releaseClient("local", node);
            done();
        });
    }

    RED.nodes.registerType("viis-schedule-executor", ScheduleExecutorNode);
};

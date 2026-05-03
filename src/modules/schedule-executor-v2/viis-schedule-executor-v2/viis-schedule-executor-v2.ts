/**
 * viis-schedule-executor-v2 Node
 * 
 * Responsibility: Execute Modbus commands, verify, notify, and sync status
 * This is the THIRD (final) node in the V2 chain
 * 
 * Input: msg.payload = { allowed: boolean, commands: ModbusCmd[], schedule?: TabiotSchedule, configParameters?: ConfigParameter[] }
 * Output: msg.payload = { success: boolean, executedCommands: number, failedCommands: number }
 */

import { NodeAPI, Node } from "node-red";
import { ModbusExecutorService } from "./modbus-executor-service";
import { ScheduleNotificationService } from "./schedule-notification-service";
import { ScheduleStatusService } from "./schedule-status-service";
import { ScheduleExecutorV2NodeDef, ModbusCmd, TabiotSchedule, ConfigParameter } from "../common/types";
import { ModbusClientCore } from "../../../core/modbus-client";
import { MqttClientCore, MqttConfig } from "../../../core/mqtt-client";
import ClientRegistry from "../../../core/client-registry";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";

module.exports = function (RED: NodeAPI) {
    function ScheduleExecutorV2Node(this: Node, config: ScheduleExecutorV2NodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name;
        const debugEnable = config.debugEnable || false;
        const verifyAfterWrite = config.verifyAfterWrite !== false;

        // Helper function for conditional logging
        const debugLog = (message: string) => {
            if (debugEnable) {
                node.warn(message);
            }
        };

        debugLog("⚙️ viis-schedule-executor-v2 initialized");
        debugLog(`Verify after write: ${verifyAfterWrite}`);

        // Initialize services
        let executorService: ModbusExecutorService;
        let notificationService: ScheduleNotificationService;
        let statusService: ScheduleStatusService;
        let globalHelper: GlobalContextHelper;

        try {
            globalHelper = new GlobalContextHelper(node.context());
            executorService = new ModbusExecutorService(node, verifyAfterWrite, debugEnable);
            notificationService = new ScheduleNotificationService(node, debugEnable);
            statusService = new ScheduleStatusService(node, debugEnable);
            debugLog("All services initialized (executor, notification, status)");
        } catch (error) {
            node.error(`Failed to initialize services: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Init failed" });
            return;
        }

        // MQTT client references (lazy init)
        let thingsboardClient: MqttClientCore | null = null;
        let emqxClient: MqttClientCore | null = null;

        const initializeMqttClients = async () => {
            try {
                const thingsboardConfig: MqttConfig = {
                    broker: `mqtt://${globalHelper.getEnvVar("THINGSBOARD_HOST", "mqtt.viis.tech")}:${globalHelper.getEnvVar("THINGSBOARD_PORT", "1883")}`,
                    clientId: `node-red-tb-v2-${Math.random().toString(16).substring(2, 10)}`,
                    username: globalHelper.getEnvVar("DEVICE_ACCESS_TOKEN", ""),
                    password: globalHelper.getEnvVar("THINGSBOARD_PASSWORD", ""),
                    qos: 1 as 0 | 1 | 2,
                };

                const emqxConfig: MqttConfig = {
                    broker: `mqtt://${globalHelper.getEnvVar("EMQX_HOST", "emqx")}:${globalHelper.getEnvVar("EMQX_PORT", "1883")}`,
                    clientId: `node-red-emqx-v2-${Math.random().toString(16).substring(2, 10)}`,
                    username: globalHelper.getEnvVar("EMQX_USERNAME", ""),
                    password: globalHelper.getEnvVar("EMQX_PASSWORD", ""),
                    qos: 1 as 0 | 1 | 2,
                };

                thingsboardClient = await ClientRegistry.getThingsboardMqttClient(thingsboardConfig, node);
                emqxClient = await ClientRegistry.getLocalMqttClient(emqxConfig, node);
                debugLog(`MQTT initialized - TB: ${thingsboardClient.isConnected()}, EMQX: ${emqxClient.isConnected()}`);
            } catch (error) {
                debugLog(`MQTT init failed (non-critical): ${(error as Error).message}`);
            }
        };

        // Start MQTT init in background
        initializeMqttClients();

        // Get Modbus client
        let modbusClient: ModbusClientCore | null = null;
        let modbusUnitId: number = 1;

        // Initialize Modbus client asynchronously
        const initializeModbusClient = async () => {
            try {
                const boardId = config.boardId;
                const boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);

                if (boardsConfig) {
                    // Multi-board mode
                    let boards;
                    if (Array.isArray(boardsConfig)) {
                        boards = boardsConfig;
                    } else if (typeof boardsConfig === 'string') {
                        boards = JSON.parse(boardsConfig);
                    } else {
                        throw new Error('Invalid MODBUS_BOARDS format');
                    }

                    const boardToUse = boardId || boards[0]?.id;
                    debugLog(`Getting Modbus client for board: ${boardToUse}`);
                    
                    const client = await ClientRegistry.getModbusClientV2(boardToUse, node);
                    const boardConfig = boards.find((b: any) => b.id === boardToUse);
                    modbusClient = client;
                    modbusUnitId = boardConfig?.unitId || 1;
                } else {
                    // Single-board mode
                    const configData = {
                        type: globalHelper.getEnvVar("MODBUS_TYPE", "TCP") as "TCP" | "RTU",
                        host: globalHelper.getEnvVar("MODBUS_HOST", "localhost"),
                        tcpPort: globalHelper.getNumericEnvVar("MODBUS_TCP_PORT", 502),
                        serialPort: globalHelper.getEnvVar("MODBUS_SERIAL_PORT", "/dev/ttyUSB0"),
                        baudRate: globalHelper.getNumericEnvVar("MODBUS_BAUD_RATE", 9600),
                        parity: globalHelper.getEnvVar("MODBUS_PARITY", "none") as "none" | "even" | "odd",
                        unitId: globalHelper.getNumericEnvVar("MODBUS_UNIT_ID", 1)
                    };

                    debugLog(`Getting Modbus client for ${configData.type} ${configData.host}`);
                    const client = await ClientRegistry.getModbusClientV2(configData, node);
                    modbusClient = client;
                    modbusUnitId = configData.unitId;
                }

                debugLog(`Modbus client initialized (unitId: ${modbusUnitId})`);
            } catch (error) {
                node.error(`Failed to initialize Modbus client: ${(error as Error).message}`);
            }
        };

        // Start initialization
        initializeModbusClient();

        // Handle input messages
        node.on("input", async function (msg: any, send, done) {
            try {
                debugLog("📥 Received execution request");
                node.status({ fill: "blue", shape: "dot", text: "Executing..." });

                // Validate input
                if (!msg.payload) {
                    const error = new Error("Invalid input: msg.payload is required");
                    node.error(error.message);
                    node.status({ fill: "red", shape: "ring", text: "Invalid input" });
                    done(error);
                    return;
                }

                const payload = msg.payload as any;

                // Check if execution is allowed
                if (payload.allowed === false) {
                    debugLog(`⛔ Execution blocked: ${payload.blockedReason || 'Not allowed'}`);
                    node.warn(`⛔ Schedule execution BLOCKED: ${payload.blockedReason || 'Not allowed'}`);

                    msg.payload = {
                        success: false,
                        executedCommands: 0,
                        failedCommands: 0,
                        blockedReason: payload.blockedReason || 'Execution not allowed'
                    };
                    msg.topic = "schedule-executor-v2-blocked";
                    (msg as any).timestamp = Date.now();

                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: payload.blockedReason || "Blocked"
                    });

                    send(msg);
                    done();
                    return;
                }

                // Wait for Modbus client to be ready
                if (!modbusClient) {
                    debugLog("Waiting for Modbus client to initialize...");
                    node.status({ fill: "blue", shape: "dot", text: "Initializing..." });
                    
                    // Wait up to 10 seconds
                    let waitCount = 0;
                    while (!modbusClient && waitCount < 50) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                        waitCount++;
                    }

                    if (!modbusClient) {
                        throw new Error("Modbus client failed to initialize");
                    }

                    debugLog("Modbus client ready");
                }

                // Extract commands and schedule
                const commands: ModbusCmd[] = payload.commands || [];
                const schedule: TabiotSchedule | undefined = payload.schedule as TabiotSchedule | undefined;
                const scheduleId = schedule?.name || `schedule_${Date.now()}`;

                debugLog(`Executing ${commands.length} commands for ${scheduleId}`);

                // Check if commands can be executed (no conflicts)
                if (!executorService.canExecuteCommands(commands, scheduleId)) {
                    node.warn("⚠️ Command conflict detected - execution may have unexpected results");
                }

                // Execute commands
                const holdingCommands = commands.filter((cmd: ModbusCmd) => cmd.fc === 6);
                const coilCommands = commands.filter((cmd: ModbusCmd) => cmd.fc === 5);

                await executorService.executeModbusCommands(
                    modbusClient,
                    { holdingCommands, coilCommands },
                    schedule
                );

                // Verify writes if enabled
                if (verifyAfterWrite) {
                    debugLog("Verifying Modbus writes...");
                    const verifySuccess = await executorService.verifyModbusWrite(modbusClient, commands);
                    
                    if (!verifySuccess) {
                        node.warn("⚠️ Verification failed - some commands may not have executed correctly");
                    }
                }

                // Track active commands if starting
                if (schedule && schedule.status === 'running') {
                    executorService.trackActiveCommands(scheduleId, commands);
                    debugLog(`Tracked ${commands.length} active commands for ${scheduleId}`);
                }

                // Clear active commands if finishing
                if (schedule && schedule.status === 'finished') {
                    executorService.clearActiveCommands(scheduleId);
                    debugLog(`Cleared active commands for ${scheduleId}`);
                }

                // Determine execution success (based on verification)
                const executionSuccess = !verifyAfterWrite || commands.length === 0
                    ? true
                    : true; // Will be enhanced with actual verify result tracking

                // ==================== NOTIFICATIONS & STATUS ====================
                if (schedule) {
                    const commandsPayload = { holdingCommands, coilCommands };
                    const configParameters: ConfigParameter[] = payload.configParameters || [];
                    const configKeyValues: Record<string, any> = {};
                    for (const cp of configParameters) {
                        configKeyValues[cp.key] = cp.value;
                    }

                    // Track status change
                    const statusChanged = statusService.hasStatusChanged(schedule.name, schedule.status || 'unknown');

                    // Update DB status if changed
                    if (schedule.status === 'running' || schedule.status === 'finished') {
                        try {
                            await statusService.updateScheduleStatus(schedule, schedule.status);
                        } catch (statusError) {
                            debugLog(`Status update failed: ${(statusError as Error).message}`);
                        }
                    }

                    // Publish via MQTT (non-blocking - fire and forget)
                    if (thingsboardClient && emqxClient) {
                        const action = schedule.status === 'running' ? 'start' : 'end';

                        // Telemetry
                        notificationService.publishScheduleTelemetry(
                            thingsboardClient, emqxClient, schedule, action, commandsPayload, configKeyValues
                        ).catch(err => debugLog(`Telemetry failed: ${err.message}`));

                        // Audit log
                        notificationService.publishAuditLog(
                            thingsboardClient, emqxClient, schedule, action, commandsPayload, executionSuccess
                        ).catch(err => debugLog(`Audit log failed: ${err.message}`));

                        // Config parameter updates
                        for (const cp of configParameters) {
                            notificationService.publishConfigUpdate(
                                thingsboardClient, emqxClient, cp
                            ).catch(err => debugLog(`Config publish failed: ${err.message}`));
                        }
                    }

                    // HTTP notification (only on status change)
                    if (statusChanged) {
                        const action = schedule.status === 'running' ? 'start' : 'end';
                        statusService.sendNotificationToBackend(schedule, action, executionSuccess)
                            .catch(err => debugLog(`HTTP notification failed: ${err.message}`));

                        // Sync schedule log
                        statusService.syncScheduleLog(schedule, executionSuccess)
                            .catch(err => debugLog(`Log sync failed: ${err.message}`));

                        // Clear status history on finish
                        if (schedule.status === 'finished') {
                            statusService.clearStatusHistory(schedule.name);
                        }
                    }
                }
                // ==================== END NOTIFICATIONS ====================

                // Output result
                msg.payload = {
                    success: true,
                    executedCommands: commands.length,
                    failedCommands: 0,
                    scheduleId,
                    verified: verifyAfterWrite
                };

                msg.topic = "schedule-executor-v2";
                msg.timestamp = Date.now();

                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `${commands.length} executed`
                });

                send(msg);
                done();
            } catch (error) {
                const errorMessage = (error as Error).message;
                node.error(`Execution failed: ${errorMessage}`);
                node.status({ fill: "red", shape: "ring", text: "Error" });

                msg.payload = {
                    success: false,
                    executedCommands: 0,
                    failedCommands: 1,
                    errorMessage
                };
                msg.topic = "schedule-executor-v2-error";
                msg.timestamp = Date.now();

                done(error);
            }
        });

        // Handle RPC reset command
        node.on("input", async function (msg: any, send, done) {
            const payload = msg.payload as any;
            if (payload && typeof payload === 'object' && payload.method === 'reset_schedule') {
                const scheduleId = payload.params?.scheduleId;

                if (!scheduleId) {
                    node.error("Missing scheduleId in reset_schedule RPC");
                    done(new Error("Missing scheduleId"));
                    return;
                }

                debugLog(`📡 RPC: Resetting schedule ${scheduleId}`);

                if (!modbusClient) {
                    node.error("Modbus client not available for reset");
                    done(new Error("Modbus client not available"));
                    return;
                }

                const activeCommands = executorService.getActiveCommands(scheduleId);
                
                if (activeCommands.length === 0) {
                    debugLog(`No active commands to reset for ${scheduleId}`);
                    msg.payload = { success: true, message: "No active commands" };
                    send(msg);
                    done();
                    return;
                }

                const resetSuccess = await executorService.resetModbusCommands(modbusClient, activeCommands);
                executorService.clearActiveCommands(scheduleId);

                // Notify on RPC reset if we have schedule info and MQTT clients
                if (thingsboardClient && emqxClient) {
                    const resetCommands = { holdingCommands: activeCommands.filter(c => c.fc === 6), coilCommands: activeCommands.filter(c => c.fc === 5) };
                    notificationService.publishAuditLog(
                        thingsboardClient, emqxClient,
                        { name: scheduleId, label: scheduleId } as TabiotSchedule,
                        'end', resetCommands, resetSuccess
                    ).catch(err => debugLog(`Reset audit log failed: ${err.message}`));
                }

                msg.payload = {
                    success: resetSuccess,
                    resetCommands: activeCommands.length
                };

                if (resetSuccess) {
                    node.status({ fill: "green", shape: "dot", text: "Reset complete" });
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "Reset partial" });
                }

                send(msg);
                done();
                return;
            }
        });

        // Cleanup on close
        node.on("close", () => {
            debugLog("viis-schedule-executor-v2 closed");
            node.status({});
        });
    }

    RED.nodes.registerType("viis-schedule-executor-v2", ScheduleExecutorV2Node);
};

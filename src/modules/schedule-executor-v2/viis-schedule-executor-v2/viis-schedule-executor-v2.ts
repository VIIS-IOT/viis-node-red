/**
 * viis-schedule-executor-v2 Node
 * 
 * Responsibility: Execute Modbus commands and verify
 * This is the THIRD (final) node in the V2 chain
 * 
 * Input: msg.payload = { allowed: boolean, commands: ModbusCmd[], schedule?: TabiotSchedule }
 * Output: msg.payload = { success: boolean, executedCommands: number, failedCommands: number }
 */

import { NodeAPI, Node } from "node-red";
import { ModbusExecutorService } from "./modbus-executor-service";
import { ScheduleExecutorV2NodeDef, ModbusCmd, TabiotSchedule, ActiveModbusCommands } from "../common/types";
import { ModbusClientCore } from "../../../core/modbus-client";
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

        // Initialize service
        let executorService: ModbusExecutorService;
        let globalHelper: GlobalContextHelper;

        try {
            globalHelper = new GlobalContextHelper(node.context());
            executorService = new ModbusExecutorService(node, verifyAfterWrite, debugEnable);
            debugLog("ModbusExecutorService initialized");
        } catch (error) {
            node.error(`Failed to initialize ModbusExecutorService: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Init failed" });
            return;
        }

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

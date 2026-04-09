"use strict";
/**
 * viis-schedule-executor-v2 Node
 *
 * Responsibility: Execute Modbus commands and verify
 * This is the THIRD (final) node in the V2 chain
 *
 * Input: msg.payload = { allowed: boolean, commands: ModbusCmd[], schedule?: TabiotSchedule }
 * Output: msg.payload = { success: boolean, executedCommands: number, failedCommands: number }
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_executor_service_1 = require("./modbus-executor-service");
const client_registry_1 = __importDefault(require("../../../core/client-registry"));
const global_context_helper_1 = require("../../../ultils/global-context-helper");
module.exports = function (RED) {
    function ScheduleExecutorV2Node(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        const debugEnable = config.debugEnable || false;
        const verifyAfterWrite = config.verifyAfterWrite !== false;
        // Helper function for conditional logging
        const debugLog = (message) => {
            if (debugEnable) {
                node.warn(message);
            }
        };
        debugLog("⚙️ viis-schedule-executor-v2 initialized");
        debugLog(`Verify after write: ${verifyAfterWrite}`);
        // Initialize service
        let executorService;
        let globalHelper;
        try {
            globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
            executorService = new modbus_executor_service_1.ModbusExecutorService(node, verifyAfterWrite, debugEnable);
            debugLog("ModbusExecutorService initialized");
        }
        catch (error) {
            node.error(`Failed to initialize ModbusExecutorService: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Init failed" });
            return;
        }
        // Get Modbus client
        let modbusClient = null;
        let modbusUnitId = 1;
        // Initialize Modbus client asynchronously
        const initializeModbusClient = async () => {
            var _a;
            try {
                const boardId = config.boardId;
                const boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);
                if (boardsConfig) {
                    // Multi-board mode
                    let boards;
                    if (Array.isArray(boardsConfig)) {
                        boards = boardsConfig;
                    }
                    else if (typeof boardsConfig === 'string') {
                        boards = JSON.parse(boardsConfig);
                    }
                    else {
                        throw new Error('Invalid MODBUS_BOARDS format');
                    }
                    const boardToUse = boardId || ((_a = boards[0]) === null || _a === void 0 ? void 0 : _a.id);
                    debugLog(`Getting Modbus client for board: ${boardToUse}`);
                    const client = await client_registry_1.default.getModbusClientV2(boardToUse, node);
                    const boardConfig = boards.find((b) => b.id === boardToUse);
                    modbusClient = client;
                    modbusUnitId = (boardConfig === null || boardConfig === void 0 ? void 0 : boardConfig.unitId) || 1;
                }
                else {
                    // Single-board mode
                    const configData = {
                        type: globalHelper.getEnvVar("MODBUS_TYPE", "TCP"),
                        host: globalHelper.getEnvVar("MODBUS_HOST", "localhost"),
                        tcpPort: globalHelper.getNumericEnvVar("MODBUS_TCP_PORT", 502),
                        serialPort: globalHelper.getEnvVar("MODBUS_SERIAL_PORT", "/dev/ttyUSB0"),
                        baudRate: globalHelper.getNumericEnvVar("MODBUS_BAUD_RATE", 9600),
                        parity: globalHelper.getEnvVar("MODBUS_PARITY", "none"),
                        unitId: globalHelper.getNumericEnvVar("MODBUS_UNIT_ID", 1)
                    };
                    debugLog(`Getting Modbus client for ${configData.type} ${configData.host}`);
                    const client = await client_registry_1.default.getModbusClientV2(configData, node);
                    modbusClient = client;
                    modbusUnitId = configData.unitId;
                }
                debugLog(`Modbus client initialized (unitId: ${modbusUnitId})`);
            }
            catch (error) {
                node.error(`Failed to initialize Modbus client: ${error.message}`);
            }
        };
        // Start initialization
        initializeModbusClient();
        // Handle input messages
        node.on("input", async function (msg, send, done) {
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
                const payload = msg.payload;
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
                    msg.timestamp = Date.now();
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
                const commands = payload.commands || [];
                const schedule = payload.schedule;
                const scheduleId = (schedule === null || schedule === void 0 ? void 0 : schedule.name) || `schedule_${Date.now()}`;
                debugLog(`Executing ${commands.length} commands for ${scheduleId}`);
                // Check if commands can be executed (no conflicts)
                if (!executorService.canExecuteCommands(commands, scheduleId)) {
                    node.warn("⚠️ Command conflict detected - execution may have unexpected results");
                }
                // Execute commands
                const holdingCommands = commands.filter((cmd) => cmd.fc === 6);
                const coilCommands = commands.filter((cmd) => cmd.fc === 5);
                await executorService.executeModbusCommands(modbusClient, { holdingCommands, coilCommands }, schedule);
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
            }
            catch (error) {
                const errorMessage = error.message;
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
        node.on("input", async function (msg, send, done) {
            var _a;
            const payload = msg.payload;
            if (payload && typeof payload === 'object' && payload.method === 'reset_schedule') {
                const scheduleId = (_a = payload.params) === null || _a === void 0 ? void 0 : _a.scheduleId;
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
                }
                else {
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

"use strict";
/**
 * viis-schedule-logic-v2 Node
 *
 * Responsibility: Check control modes and safety conditions
 * This is the SECOND node in the V2 chain
 *
 * Input: msg.payload = { schedules: TabiotSchedule[] }
 * Output: msg.payload = { allowed: boolean, commands: ModbusCmd[], mode: ControlMode, conditions: SafetyConditions }
 */
Object.defineProperty(exports, "__esModule", { value: true });
const logic_control_service_1 = require("./logic-control-service");
const schedule_mapper_service_1 = require("./schedule-mapper-service");
module.exports = function (RED) {
    function ScheduleLogicV2Node(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        const debugEnable = config.debugEnable || false;
        // Helper function for conditional logging
        const debugLog = (message) => {
            if (debugEnable) {
                node.warn(message);
            }
        };
        debugLog("🧠 viis-schedule-logic-v2 initialized");
        // Initialize services
        let logicService;
        let mapperService;
        try {
            logicService = new logic_control_service_1.LogicControlService(node, debugEnable);
            mapperService = new schedule_mapper_service_1.ScheduleMapperService(node, debugEnable);
            debugLog("LogicControlService and ScheduleMapperService initialized");
        }
        catch (error) {
            node.error(`Failed to initialize services: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Init failed" });
            return;
        }
        // Handle input messages
        node.on("input", async function (msg, send, done) {
            try {
                debugLog("📥 Received logic check request");
                node.status({ fill: "blue", shape: "dot", text: "Checking..." });
                // Validate input
                const payload = msg.payload;
                if (!payload || !payload.schedules || !Array.isArray(payload.schedules)) {
                    const error = new Error("Invalid input: expected msg.payload.schedules array");
                    node.error(error.message);
                    node.status({ fill: "red", shape: "ring", text: "Invalid input" });
                    done(error);
                    return;
                }
                const schedules = payload.schedules;
                debugLog(`Processing ${schedules.length} schedules for logic check`);
                // Map all schedules to commands
                const allCommands = [];
                const configParameters = [];
                for (const schedule of schedules) {
                    const mappingResult = mapperService.mapScheduleToModbus(schedule);
                    allCommands.push(...mappingResult.holdingCommands, ...mappingResult.coilCommands);
                    configParameters.push(...mappingResult.configParameters);
                }
                debugLog(`Mapped to ${allCommands.length} Modbus commands`);
                // Check before execute
                const result = await logicService.checkBeforeExecute({
                    schedules,
                    commands: allCommands
                });
                debugLog(`Logic check result: allowed=${result.allowed}, mode=${result.mode}`);
                if (!result.allowed) {
                    debugLog(`❌ Execution BLOCKED: ${result.blockedReason}`);
                    node.warn(`⛔ Schedule execution BLOCKED: ${result.blockedReason}`);
                }
                // Output result
                msg.payload = {
                    allowed: result.allowed,
                    commands: result.commands,
                    mode: result.mode,
                    conditions: result.conditions,
                    blockedReason: result.blockedReason,
                    scheduleCount: schedules.length,
                    commandCount: result.commands.length,
                    configParameters
                };
                msg.topic = "schedule-logic-v2";
                msg.timestamp = Date.now();
                // Set status
                if (result.allowed) {
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `${result.commands.length} commands allowed`
                    });
                }
                else {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: result.blockedReason || "Blocked"
                    });
                }
                send(msg);
                done();
            }
            catch (error) {
                const errorMessage = error.message;
                node.error(`Logic check failed: ${errorMessage}`);
                node.status({ fill: "red", shape: "ring", text: "Error" });
                done(error);
            }
        });
        // Handle RPC commands
        node.on("input", async function (msg, send, done) {
            var _a;
            // Handle RPC set mode command
            const payload = msg.payload;
            if (payload && typeof payload === 'object' && payload.method === 'set_control_mode') {
                const mode = (_a = payload.params) === null || _a === void 0 ? void 0 : _a.mode;
                if (!mode || !['AUTO', 'MANUAL', 'OFF'].includes(mode)) {
                    node.error("Invalid mode in set_control_mode RPC");
                    done(new Error("Invalid mode"));
                    return;
                }
                const success = await logicService.handleRpcSetMode(mode);
                msg.payload = {
                    success,
                    mode,
                    timestamp: Date.now()
                };
                if (success) {
                    node.status({ fill: "green", shape: "dot", text: `Mode: ${mode}` });
                }
                else {
                    node.status({ fill: "red", shape: "ring", text: "RPC failed" });
                }
                send(msg);
                done();
                return;
            }
            // Pass through to main handler
        });
        // Cleanup on close
        node.on("close", () => {
            debugLog("viis-schedule-logic-v2 closed");
            node.status({});
        });
    }
    RED.nodes.registerType("viis-schedule-logic-v2", ScheduleLogicV2Node);
};

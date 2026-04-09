/**
 * viis-schedule-logic-v2 Node
 * 
 * Responsibility: Check control modes and safety conditions
 * This is the SECOND node in the V2 chain
 * 
 * Input: msg.payload = { schedules: TabiotSchedule[] }
 * Output: msg.payload = { allowed: boolean, commands: ModbusCmd[], mode: ControlMode, conditions: SafetyConditions }
 */

import { NodeAPI, Node } from "node-red";
import { LogicControlService } from "./logic-control-service";
import { ScheduleMapperService } from "./schedule-mapper-service";
import { ScheduleExecutorV2NodeDef, TabiotSchedule, ModbusCmd, LogicControlOutput } from "../common/types";

module.exports = function (RED: NodeAPI) {
    function ScheduleLogicV2Node(this: Node, config: ScheduleExecutorV2NodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name;
        const debugEnable = config.debugEnable || false;

        // Helper function for conditional logging
        const debugLog = (message: string) => {
            if (debugEnable) {
                node.warn(message);
            }
        };

        debugLog("🧠 viis-schedule-logic-v2 initialized");

        // Initialize services
        let logicService: LogicControlService;
        let mapperService: ScheduleMapperService;

        try {
            logicService = new LogicControlService(node, debugEnable);
            mapperService = new ScheduleMapperService(node, debugEnable);
            debugLog("LogicControlService and ScheduleMapperService initialized");
        } catch (error) {
            node.error(`Failed to initialize services: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Init failed" });
            return;
        }

        // Handle input messages
        node.on("input", async function (msg: any, send, done) {
            try {
                debugLog("📥 Received logic check request");
                node.status({ fill: "blue", shape: "dot", text: "Checking..." });

                // Validate input
                const payload = msg.payload as any;
                if (!payload || !payload.schedules || !Array.isArray(payload.schedules)) {
                    const error = new Error("Invalid input: expected msg.payload.schedules array");
                    node.error(error.message);
                    node.status({ fill: "red", shape: "ring", text: "Invalid input" });
                    done(error);
                    return;
                }

                const schedules: TabiotSchedule[] = payload.schedules;
                debugLog(`Processing ${schedules.length} schedules for logic check`);

                // Map all schedules to commands
                const allCommands: ModbusCmd[] = [];
                const configParameters: any[] = [];

                for (const schedule of schedules) {
                    const mappingResult = mapperService.mapScheduleToModbus(schedule);
                    allCommands.push(...mappingResult.holdingCommands, ...mappingResult.coilCommands);
                    configParameters.push(...mappingResult.configParameters);
                }

                debugLog(`Mapped to ${allCommands.length} Modbus commands`);

                // Check before execute
                const result: LogicControlOutput = await logicService.checkBeforeExecute({
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
                } else {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: result.blockedReason || "Blocked"
                    });
                }

                send(msg);
                done();
            } catch (error) {
                const errorMessage = (error as Error).message;
                node.error(`Logic check failed: ${errorMessage}`);
                node.status({ fill: "red", shape: "ring", text: "Error" });
                done(error);
            }
        });

        // Handle RPC commands
        node.on("input", async function (msg: any, send, done) {
            // Handle RPC set mode command
            const payload = msg.payload as any;
            if (payload && typeof payload === 'object' && payload.method === 'set_control_mode') {
                const mode = payload.params?.mode;
                
                if (!mode || !['AUTO', 'MANUAL', 'OFF'].includes(mode)) {
                    node.error("Invalid mode in set_control_mode RPC");
                    done(new Error("Invalid mode"));
                    return;
                }

                const success = await logicService.handleRpcSetMode(mode as 'AUTO' | 'MANUAL' | 'OFF');
                
                msg.payload = {
                    success,
                    mode,
                    timestamp: Date.now()
                };

                if (success) {
                    node.status({ fill: "green", shape: "dot", text: `Mode: ${mode}` });
                } else {
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

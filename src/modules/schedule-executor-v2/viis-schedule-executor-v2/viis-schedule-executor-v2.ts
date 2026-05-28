/**
 * viis-schedule-executor-v2 Node (Slim State Manager)
 * 
 * Responsibility: State management only — track active commands, update DB status, recovery logic
 * This is the state management node in the V2 composable flow.
 * 
 * Modbus execution → viis-modbus-flex
 * MQTT publishing → viis-mqtt-client
 * HTTP notifications → http out node
 * 
 * Input: msg.payload = { success: boolean, scheduleId: string, schedule?: TabiotSchedule, action?: 'start'|'end', commands?: ModbusCmd[] }
 * Output: msg.payload = { success: boolean, scheduleId: string, statusChanged: boolean, action: string }
 */

import { NodeAPI, Node } from "node-red";
import { ScheduleStatusService } from "./schedule-status-service";
import { ScheduleExecutorV2NodeDef, ModbusCmd, TabiotSchedule, ActiveModbusCommands } from "../common/types";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";

module.exports = function (RED: NodeAPI) {
    function ScheduleExecutorV2Node(this: Node, config: ScheduleExecutorV2NodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name;
        const debugEnable = config.debugEnable || false;
        const globalContext = node.context().global;

        const debugLog = (message: string) => {
            if (debugEnable) {
                node.warn(message);
            }
        };

        // ==================== STARTUP RECOVERY ====================
        const currentStartupId = `startup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const lastStartupId = globalContext.get("scheduleExecutorStartupId") as string || null;
        const isStartupRecovery = !lastStartupId || lastStartupId !== currentStartupId;

        if (isStartupRecovery) {
            globalContext.set("scheduleExecutorStartupId", currentStartupId);
            globalContext.set("scheduleExecutorStartupTime", Date.now());

            const staleCommands = globalContext.get("activeModbusCommands") as ActiveModbusCommands || {};
            const staleStatus = globalContext.get("scheduleStatusHistoryV2") as Record<string, string> || {};
            const staleTimestamps = globalContext.get("scheduleLastCheckTimestamps") as Record<string, number> || {};

            if (Object.keys(staleCommands).length > 0 || Object.keys(staleStatus).length > 0 || Object.keys(staleTimestamps).length > 0) {
                node.warn(`🔄 STARTUP RECOVERY: Clearing stale state`);
                globalContext.set("activeModbusCommands", {} as ActiveModbusCommands);
                globalContext.set("scheduleStatusHistoryV2", {} as Record<string, string>);
                globalContext.set("scheduleLastCheckTimestamps", {} as Record<string, number>);
                node.warn(`✅ STARTUP RECOVERY: Cleared stale state - schedules will start fresh`);
            } else {
                globalContext.set("activeModbusCommands", {} as ActiveModbusCommands);
                globalContext.set("scheduleStatusHistoryV2", {} as Record<string, string>);
                globalContext.set("scheduleLastCheckTimestamps", {} as Record<string, number>);
                if (!globalContext.get("scheduleConfigKeys")) {
                    globalContext.set("scheduleConfigKeys", {} as Record<string, string[]>);
                }
                if (!globalContext.get("configKeyValues")) {
                    globalContext.set("configKeyValues", {} as Record<string, any>);
                }
            }
        } else {
            if (!globalContext.get("activeModbusCommands")) {
                globalContext.set("activeModbusCommands", {} as ActiveModbusCommands);
            }
            if (!globalContext.get("scheduleConfigKeys")) {
                globalContext.set("scheduleConfigKeys", {} as Record<string, string[]>);
            }
            if (!globalContext.get("configKeyValues")) {
                globalContext.set("configKeyValues", {} as Record<string, any>);
            }
        }

        // Initialize status service
        let statusService: ScheduleStatusService;
        try {
            statusService = new ScheduleStatusService(node, debugEnable);
        } catch (error) {
            node.error(`Failed to initialize StatusService: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Init failed" });
            return;
        }

        debugLog("⚙️ viis-schedule-executor-v2 (state manager) initialized");

        // ==================== ACTIVE COMMAND TRACKING ====================

        function getActiveCommands(scheduleId: string): ModbusCmd[] {
            const activeCommands = (globalContext.get("activeModbusCommands") as ActiveModbusCommands) || {};
            return activeCommands[scheduleId] || [];
        }

        function trackActiveCommands(scheduleId: string, commands: ModbusCmd[]): void {
            const activeCommands = (globalContext.get("activeModbusCommands") as ActiveModbusCommands) || {};
            activeCommands[scheduleId] = commands;
            globalContext.set("activeModbusCommands", activeCommands);
            debugLog(`Tracked ${commands.length} active commands for ${scheduleId}`);
        }

        function clearActiveCommands(scheduleId: string): void {
            const activeCommands = (globalContext.get("activeModbusCommands") as ActiveModbusCommands) || {};
            if (activeCommands[scheduleId]) {
                delete activeCommands[scheduleId];
                globalContext.set("activeModbusCommands", activeCommands);
                debugLog(`Cleared active commands for ${scheduleId}`);
            }
        }

        // ==================== INPUT HANDLER ====================

        node.on("input", async function (msg: any, send, done) {
            try {
                const payload = msg.payload as any;

                if (!payload) {
                    done(new Error("Invalid input: msg.payload is required"));
                    return;
                }

                const scheduleId = payload.scheduleId || payload.schedule?.name || `schedule_${Date.now()}`;
                const schedule = payload.schedule as TabiotSchedule | undefined;
                const action = payload.action || (schedule?.status === 'running' ? 'start' : 'end');
                const commands: ModbusCmd[] = payload.commands || [];
                const executionSuccess = payload.success !== false;

                debugLog(`📥 Processing state update for ${scheduleId} (${action})`);

                // Track active commands
                if (action === 'start' && commands.length > 0) {
                    trackActiveCommands(scheduleId, commands);
                } else if (action === 'end') {
                    clearActiveCommands(scheduleId);
                }

                // Update DB status if schedule provided
                let statusChanged = false;
                if (schedule && (schedule.status === 'running' || schedule.status === 'finished')) {
                    statusChanged = statusService.hasStatusChanged(schedule.name, schedule.status);
                    try {
                        await statusService.updateScheduleStatus(schedule, schedule.status);
                    } catch (statusError) {
                        debugLog(`Status update failed: ${(statusError as Error).message}`);
                    }

                    // Clear status history on finish
                    if (schedule.status === 'finished' && statusChanged) {
                        statusService.clearStatusHistory(schedule.name);
                    }
                }

                // Output result for downstream nodes (MQTT, HTTP)
                msg.payload = {
                    success: executionSuccess,
                    scheduleId,
                    action,
                    statusChanged,
                    schedule: schedule || null,
                    commands
                };
                msg.topic = "schedule-executor-v2";
                msg.timestamp = Date.now();

                node.status({
                    fill: statusChanged ? "green" : "grey",
                    shape: "dot",
                    text: `${action} ${scheduleId}`
                });

                send(msg);
                done();
            } catch (error) {
                const errorMessage = (error as Error).message;
                node.error(`State update failed: ${errorMessage}`);
                node.status({ fill: "red", shape: "ring", text: "Error" });
                done(error);
            }
        });

        // ==================== CLEANUP ====================

        node.on("close", () => {
            debugLog("viis-schedule-executor-v2 closed");
            node.status({});
        });
    }

    RED.nodes.registerType("viis-schedule-executor-v2", ScheduleExecutorV2Node);
};

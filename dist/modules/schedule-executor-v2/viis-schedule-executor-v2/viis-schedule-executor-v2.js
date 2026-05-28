"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const schedule_status_service_1 = require("./schedule-status-service");
module.exports = function (RED) {
    function ScheduleExecutorV2Node(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        const debugEnable = config.debugEnable || false;
        const globalContext = node.context().global;
        const debugLog = (message) => {
            if (debugEnable) {
                node.warn(message);
            }
        };
        // ==================== STARTUP RECOVERY ====================
        const currentStartupId = `startup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const lastStartupId = globalContext.get("scheduleExecutorStartupId") || null;
        const isStartupRecovery = !lastStartupId || lastStartupId !== currentStartupId;
        if (isStartupRecovery) {
            globalContext.set("scheduleExecutorStartupId", currentStartupId);
            globalContext.set("scheduleExecutorStartupTime", Date.now());
            const staleCommands = globalContext.get("activeModbusCommands") || {};
            const staleStatus = globalContext.get("scheduleStatusHistoryV2") || {};
            const staleTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
            if (Object.keys(staleCommands).length > 0 || Object.keys(staleStatus).length > 0 || Object.keys(staleTimestamps).length > 0) {
                node.warn(`🔄 STARTUP RECOVERY: Clearing stale state`);
                globalContext.set("activeModbusCommands", {});
                globalContext.set("scheduleStatusHistoryV2", {});
                globalContext.set("scheduleLastCheckTimestamps", {});
                node.warn(`✅ STARTUP RECOVERY: Cleared stale state - schedules will start fresh`);
            }
            else {
                globalContext.set("activeModbusCommands", {});
                globalContext.set("scheduleStatusHistoryV2", {});
                globalContext.set("scheduleLastCheckTimestamps", {});
                if (!globalContext.get("scheduleConfigKeys")) {
                    globalContext.set("scheduleConfigKeys", {});
                }
                if (!globalContext.get("configKeyValues")) {
                    globalContext.set("configKeyValues", {});
                }
            }
        }
        else {
            if (!globalContext.get("activeModbusCommands")) {
                globalContext.set("activeModbusCommands", {});
            }
            if (!globalContext.get("scheduleConfigKeys")) {
                globalContext.set("scheduleConfigKeys", {});
            }
            if (!globalContext.get("configKeyValues")) {
                globalContext.set("configKeyValues", {});
            }
        }
        // Initialize status service
        let statusService;
        try {
            statusService = new schedule_status_service_1.ScheduleStatusService(node, debugEnable);
        }
        catch (error) {
            node.error(`Failed to initialize StatusService: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Init failed" });
            return;
        }
        debugLog("⚙️ viis-schedule-executor-v2 (state manager) initialized");
        // ==================== ACTIVE COMMAND TRACKING ====================
        function getActiveCommands(scheduleId) {
            const activeCommands = globalContext.get("activeModbusCommands") || {};
            return activeCommands[scheduleId] || [];
        }
        function trackActiveCommands(scheduleId, commands) {
            const activeCommands = globalContext.get("activeModbusCommands") || {};
            activeCommands[scheduleId] = commands;
            globalContext.set("activeModbusCommands", activeCommands);
            debugLog(`Tracked ${commands.length} active commands for ${scheduleId}`);
        }
        function clearActiveCommands(scheduleId) {
            const activeCommands = globalContext.get("activeModbusCommands") || {};
            if (activeCommands[scheduleId]) {
                delete activeCommands[scheduleId];
                globalContext.set("activeModbusCommands", activeCommands);
                debugLog(`Cleared active commands for ${scheduleId}`);
            }
        }
        // ==================== INPUT HANDLER ====================
        node.on("input", async function (msg, send, done) {
            var _a;
            try {
                const payload = msg.payload;
                if (!payload) {
                    done(new Error("Invalid input: msg.payload is required"));
                    return;
                }
                const scheduleId = payload.scheduleId || ((_a = payload.schedule) === null || _a === void 0 ? void 0 : _a.name) || `schedule_${Date.now()}`;
                const schedule = payload.schedule;
                const action = payload.action || ((schedule === null || schedule === void 0 ? void 0 : schedule.status) === 'running' ? 'start' : 'end');
                const commands = payload.commands || [];
                const executionSuccess = payload.success !== false;
                debugLog(`📥 Processing state update for ${scheduleId} (${action})`);
                // Track active commands
                if (action === 'start' && commands.length > 0) {
                    trackActiveCommands(scheduleId, commands);
                }
                else if (action === 'end') {
                    clearActiveCommands(scheduleId);
                }
                // Update DB status if schedule provided
                let statusChanged = false;
                if (schedule && (schedule.status === 'running' || schedule.status === 'finished')) {
                    statusChanged = statusService.hasStatusChanged(schedule.name, schedule.status);
                    try {
                        await statusService.updateScheduleStatus(schedule, schedule.status);
                    }
                    catch (statusError) {
                        debugLog(`Status update failed: ${statusError.message}`);
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
            }
            catch (error) {
                const errorMessage = error.message;
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

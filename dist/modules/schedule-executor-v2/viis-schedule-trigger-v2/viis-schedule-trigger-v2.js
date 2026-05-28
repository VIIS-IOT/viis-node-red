"use strict";
/**
 * viis-schedule-trigger-v2 Node
 *
 * Responsibility: Check timing and emit due schedules, detect stuck schedules for recovery
 * This is the FIRST node in the V2 chain
 *
 * Input: msg (trigger)
 * Output 1: msg.payload = { schedules: TabiotSchedule[], timestamp: number, checkInterval: number }
 * Output 2: msg.payload = { recoveredSchedules: TabiotSchedule[] } (stuck schedule recovery)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const schedule_trigger_service_1 = require("./schedule-trigger-service");
module.exports = function (RED) {
    function ScheduleTriggerV2Node(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        const debugEnable = config.debugEnable || false;
        const checkInterval = config.cleanupInterval || 1;
        const debugLog = (message) => {
            if (debugEnable) {
                node.warn(message);
            }
        };
        debugLog("🚀 viis-schedule-trigger-v2 initialized");
        let triggerService;
        try {
            triggerService = new schedule_trigger_service_1.ScheduleTriggerService(node, debugEnable);
            debugLog("ScheduleTriggerService initialized successfully");
        }
        catch (error) {
            node.error(`Failed to initialize ScheduleTriggerService: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Init failed" });
            return;
        }
        // Handle input messages
        node.on("input", async function (msg, send, done) {
            try {
                debugLog("📥 Received trigger check request");
                node.status({ fill: "blue", shape: "dot", text: "Checking..." });
                // Execute trigger check
                const result = await triggerService.checkTriggers(checkInterval);
                debugLog(`✅ Trigger check: ${result.schedules.length} schedules due`);
                // Check for stuck schedules (recovery)
                const recoveredSchedules = await triggerService.checkAndRecoverStuckSchedules();
                if (recoveredSchedules.length > 0) {
                    debugLog(`🔄 Recovery: ${recoveredSchedules.length} stuck schedule(s) found`);
                }
                // Output 1: due schedules
                msg.payload = result;
                msg.topic = "schedule-trigger-v2";
                msg.timestamp = result.timestamp;
                msg.scheduleCount = result.schedules.length;
                // Output 2: recovered schedules (or null if none)
                const recoveryMsg = recoveredSchedules.length > 0
                    ? { payload: { recoveredSchedules }, topic: "schedule-trigger-v2-recovery" }
                    : null;
                // Set status
                const totalOutput = result.schedules.length + recoveredSchedules.length;
                if (totalOutput > 0) {
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `${result.schedules.length} due, ${recoveredSchedules.length} recovery`
                    });
                }
                else {
                    node.status({ fill: "grey", shape: "dot", text: "No action" });
                }
                send([msg, recoveryMsg]);
                done();
            }
            catch (error) {
                const errorMessage = error.message;
                node.error(`Trigger check failed: ${errorMessage}`);
                node.status({ fill: "red", shape: "ring", text: "Error" });
                done(error);
            }
        });
        node.on("close", () => {
            debugLog("viis-schedule-trigger-v2 closed");
            node.status({});
        });
    }
    RED.nodes.registerType("viis-schedule-trigger-v2", ScheduleTriggerV2Node);
};

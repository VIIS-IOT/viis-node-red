"use strict";
/**
 * viis-schedule-trigger-v2 Node
 *
 * Responsibility: Check timing and emit due schedules
 * This is the FIRST node in the V2 chain
 *
 * Input: msg (trigger)
 * Output: msg.payload = { schedules: TabiotSchedule[], timestamp: number, checkInterval: number }
 */
Object.defineProperty(exports, "__esModule", { value: true });
const schedule_trigger_service_1 = require("./schedule-trigger-service");
module.exports = function (RED) {
    function ScheduleTriggerV2Node(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        const debugEnable = config.debugEnable || false;
        const checkInterval = config.cleanupInterval || 1; // Default 1 minute
        // Helper function for conditional logging
        const debugLog = (message) => {
            if (debugEnable) {
                node.warn(message);
            }
        };
        debugLog("🚀 viis-schedule-trigger-v2 initialized");
        // Initialize service
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
                debugLog(`✅ Trigger check complete: ${result.schedules.length} schedules due`);
                // Output result
                msg.payload = result;
                msg.topic = "schedule-trigger-v2";
                msg.timestamp = result.timestamp;
                msg.scheduleCount = result.schedules.length;
                // Set status
                if (result.schedules.length > 0) {
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `${result.schedules.length} due`
                    });
                }
                else {
                    node.status({
                        fill: "grey",
                        shape: "dot",
                        text: "No schedules due"
                    });
                }
                send(msg);
                done();
            }
            catch (error) {
                const errorMessage = error.message;
                node.error(`Trigger check failed: ${errorMessage}`);
                node.status({ fill: "red", shape: "ring", text: "Error" });
                done(error);
            }
        });
        // Handle RPC commands (optional - for future extensibility)
        node.on("input", async function (msg, send, done) {
            // Already handled above
        });
        // Cleanup on close
        node.on("close", () => {
            debugLog("viis-schedule-trigger-v2 closed");
            node.status({});
        });
    }
    RED.nodes.registerType("viis-schedule-trigger-v2", ScheduleTriggerV2Node);
};

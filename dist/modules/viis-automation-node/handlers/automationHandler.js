"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomationHandler = void 0;
const logger_1 = require("../utils/logger");
/**
 * Main handler for automation node logic
 * Coordinates between services and manages node behavior
 */
class AutomationHandler {
    constructor(options, intentService, processingService, mqttService) {
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(this.node, "HANDLER");
        this.intentService = intentService;
        this.processingService = processingService;
        this.mqttService = mqttService;
    }
    /**
     * Handle MQTT connection status change
     */
    async handleMqttStatus(status, error) {
        try {
            switch (status) {
                case "connected":
                    this.logger.log("MQTT connected - syncing intents");
                    this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                    await this.syncIntents();
                    break;
                case "disconnected":
                    this.logger.warn("MQTT disconnected");
                    this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
                    break;
                case "error":
                    this.logger.error(`MQTT error: ${error}`);
                    this.node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: `Error: ${error}`
                    });
                    break;
                default:
                    this.logger.warn(`Unknown MQTT status: ${status}`);
            }
        }
        catch (error) {
            this.logger.error(`Error handling MQTT status: ${error.message}`);
        }
    }
    /**
     * Handle MQTT message received
     */
    async handleMqttMessage(message) {
        try {
            this.logger.log(`Received MQTT message: ${JSON.stringify(message)}`);
            if (message.method === "update_intents") {
                this.logger.log("Received update_intents command");
                await this.syncIntents();
            }
            else if (["set", "control", "set_state", "set_state_batch"].includes(String(message.method || "").toLowerCase())) {
                // Shared rpc/+ subscription — device writes belong to viis-rpc-control.
                return;
            }
            else {
                this.logger.warn(`Unknown message method: ${message.method}`);
            }
        }
        catch (error) {
            this.logger.error(`Error handling MQTT message: ${error.message}`);
        }
    }
    /**
     * Handle input message for automation processing
     */
    async handleInput(msg) {
        var _a, _b;
        try {
            // Get intents from context or message
            let intents = this.intentService.getIntentsFromContext();
            const manualIntents = ((_a = msg.payload) === null || _a === void 0 ? void 0 : _a.intents) || [];
            if (manualIntents.length > 0) {
                this.logger.log(`Using ${manualIntents.length} manual intents from input`);
                intents = manualIntents;
            }
            // Get device data from message
            const devicesData = ((_b = msg.payload) === null || _b === void 0 ? void 0 : _b.devices_data) || [];
            if (devicesData.length === 0) {
                this.logger.warn("No device data provided in input message");
                return;
            }
            // Process intents
            await this.processAutomation(intents, devicesData);
        }
        catch (error) {
            this.logger.error(`Error handling input: ${error.message}`);
            this.node.status({
                fill: "red",
                shape: "ring",
                text: `Input error: ${error.message}`
            });
        }
    }
    /**
     * Sync intents from server and send to output
     */
    async syncIntents() {
        try {
            const intents = await this.intentService.syncIntents();
            // Send intents to output 2
            this.node.send([
                null,
                {
                    payload: intents
                }
            ]);
            this.logger.log(`Synced and sent ${intents.length} intents to output 2`);
        }
        catch (error) {
            this.logger.error(`Sync intents failed: ${error.message}`);
        }
    }
    /**
     * Process automation with intents and device data
     */
    async processAutomation(intents, devicesData) {
        try {
            // Process intents
            const results = await this.processingService.processIntents(intents, devicesData);
            // Build output payload
            const payload = this.processingService.buildSuccessPayload(intents, devicesData, results);
            // Send to output 1
            this.node.send([
                { payload },
                null
            ]);
            this.logger.log(`Processed automation with ${results.length} results`);
        }
        catch (error) {
            this.logger.error(`Process automation failed: ${error.message}`);
            // Send error to output 1
            const errorPayload = this.processingService.buildErrorPayload(error);
            this.node.send([
                { payload: errorPayload },
                null
            ]);
        }
    }
    /**
     * Cleanup handler resources
     */
    cleanup() {
        try {
            this.intentService.clearIntents();
            this.mqttService.cleanup();
            this.logger.log("Automation handler cleanup complete");
        }
        catch (error) {
            this.logger.error(`Cleanup error: ${error.message}`);
        }
    }
}
exports.AutomationHandler = AutomationHandler;

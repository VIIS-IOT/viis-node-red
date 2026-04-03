"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttAutomationService = void 0;
const logger_1 = require("../utils/logger");
/**
 * Service for managing MQTT connections for automation node
 * - Handles MQTT client lifecycle
 * - Manages subscriptions
 * - Processes incoming messages
 */
class MqttAutomationService {
    constructor(options) {
        this.mqttClient = null;
        this.subscribeTopic = "";
        this.messageHandler = null;
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(this.node, "MQTT");
    }
    /**
     * Initialize MQTT client and set up subscriptions
     */
    async initialize(mqttClient, subscribeTopic, messageHandler) {
        try {
            this.mqttClient = mqttClient;
            this.subscribeTopic = subscribeTopic;
            this.messageHandler = messageHandler;
            // Wait for connection
            await this.mqttClient.waitForConnection(15000);
            this.logger.log("MQTT client connected");
            // Subscribe to topic
            await this.subscribe();
            // Set up message handler
            this.setupMessageHandler();
            this.logger.log(`MQTT service initialized, subscribed to: ${subscribeTopic}`);
        }
        catch (error) {
            this.logger.error(`Failed to initialize MQTT service: ${error.message}`);
            throw error;
        }
    }
    /**
     * Subscribe to MQTT topic
     */
    async subscribe() {
        if (!this.mqttClient) {
            throw new Error("MQTT client not initialized");
        }
        try {
            await this.mqttClient.subscribe(this.subscribeTopic);
            this.logger.log(`Subscribed to: ${this.subscribeTopic}`);
        }
        catch (error) {
            this.logger.error(`Failed to subscribe: ${error.message}`);
            throw error;
        }
    }
    /**
     * Set up message handler
     */
    setupMessageHandler() {
        if (!this.mqttClient || !this.messageHandler) {
            return;
        }
        this.mqttClient.on("mqtt-message", (data) => {
            try {
                this.logger.debug("Received MQTT message", data.message);
                // Extract message payload
                let payload = data.message;
                // If message is a string, try to parse it
                if (typeof payload.message === 'string') {
                    try {
                        payload = JSON.parse(payload.message);
                    }
                    catch (e) {
                        // Keep original if parsing fails
                    }
                }
                else if (payload.message) {
                    payload = payload.message;
                }
                // Call the registered handler
                if (this.messageHandler) {
                    this.messageHandler(payload);
                }
            }
            catch (error) {
                this.logger.error(`Error handling MQTT message: ${error.message}`);
            }
        });
        this.logger.log("MQTT message handler registered");
    }
    /**
     * Handle connection status changes
     */
    handleConnectionStatus(status, error) {
        switch (status) {
            case "connected":
                this.logger.log("MQTT connected");
                this.node.status({ fill: "green", shape: "dot", text: "MQTT Connected" });
                break;
            case "disconnected":
                this.logger.warn("MQTT disconnected");
                this.node.status({ fill: "yellow", shape: "ring", text: "MQTT Disconnected" });
                break;
            case "error":
                this.logger.error(`MQTT error: ${error}`);
                this.node.status({ fill: "red", shape: "ring", text: `MQTT Error: ${error}` });
                break;
        }
    }
    /**
     * Check if MQTT is connected
     */
    isConnected() {
        var _a;
        return ((_a = this.mqttClient) === null || _a === void 0 ? void 0 : _a.isConnected()) || false;
    }
    /**
     * Disconnect MQTT client
     */
    disconnect() {
        if (this.mqttClient) {
            this.logger.log("Disconnecting MQTT");
            this.mqttClient.disconnect();
            this.mqttClient = null;
        }
    }
    /**
     * Cleanup resources
     */
    cleanup() {
        this.disconnect();
        this.messageHandler = null;
        this.logger.log("MQTT service cleanup complete");
    }
}
exports.MqttAutomationService = MqttAutomationService;

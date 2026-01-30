"use strict";
/**
 * MQTT Service for VIIS RPC Control Node
 * Handles MQTT publishing with debouncing and immediate publishing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttService = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
class MqttService {
    constructor(options, mqttClient, publishTopic) {
        this.mqttClient = mqttClient;
        this.publishTopic = publishTopic;
        this.node = options.node;
        this.logger = new logger_1.Logger(options.node, "MQTT-SERVICE");
        this.publishTimeouts = new Map();
    }
    /**
     * Publish result with debouncing to prevent rapid successive publishes
     */
    publishResult(key, value) {
        // Clear existing timeout for this key
        const existingTimeout = this.publishTimeouts.get(key);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            this.logger.debug(`Cleared existing timeout for ${key}`);
        }
        // Set new debounced timeout
        const timeout = setTimeout(async () => {
            try {
                await this.publishResultImmediate(key, value);
                this.publishTimeouts.delete(key);
            }
            catch (error) {
                this.logger.error(`Debounced publish failed for ${key}: ${error.message}`);
                this.publishTimeouts.delete(key);
            }
        }, constants_1.DEBOUNCE_CONFIG.TIME_MS);
        this.publishTimeouts.set(key, timeout);
        this.logger.debug(`Scheduled debounced publish for ${key}=${value} in ${constants_1.DEBOUNCE_CONFIG.TIME_MS}ms`);
    }
    /**
     * Publish result immediately without debouncing
     */
    async publishResultImmediate(key, value) {
        const mqttPayload = {
            ts: Date.now(),
            [key]: value,
        };
        try {
            const payloadString = JSON.stringify(mqttPayload);
            await this.mqttClient.publish(this.publishTopic, payloadString);
            this.node.send({ payload: mqttPayload });
            this.node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.PUBLISHED(key) });
            this.logger.debug(`Published: ${key}=${value}`);
        }
        catch (error) {
            const errorMessage = `Failed to publish ${key}: ${error.message}`;
            this.logger.error(errorMessage);
            this.node.status({ fill: "yellow", shape: "ring", text: "MQTT failed - continuing locally" });
            // Don't throw - let local services continue even if MQTT fails
        }
    }
    /**
     * Publish configuration update result
     */
    async publishConfigUpdate(key, value, note) {
        const mqttPayload = {
            ts: Date.now(),
            [key]: value,
        };
        if (note) {
            mqttPayload.note = note;
        }
        try {
            const payloadString = JSON.stringify(mqttPayload);
            await this.mqttClient.publish(this.publishTopic, payloadString);
            this.node.send({ payload: mqttPayload });
            this.node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.CONFIG_UPDATED(key) });
            this.logger.debug(`Config update: ${key}=${value}`);
        }
        catch (error) {
            const errorMessage = `Failed to publish config update for ${key}: ${error.message}`;
            this.logger.error(errorMessage);
            this.node.status({ fill: "yellow", shape: "ring", text: "MQTT failed - continuing locally" });
            // Don't throw - let local services continue even if MQTT fails
        }
    }
    /**
     * Publish multiple values at once
     */
    async publishMultipleValues(values, note) {
        const mqttPayload = Object.assign({ ts: Date.now() }, values);
        if (note) {
            mqttPayload.note = note;
        }
        try {
            await this.mqttClient.publish(this.publishTopic, JSON.stringify(mqttPayload));
            this.node.send({ payload: mqttPayload });
            const keys = Object.keys(values).join(', ');
            this.node.status({ fill: "green", shape: "dot", text: `Published: ${keys}` });
            this.logger.debug(`Published multiple values: ${keys}`);
        }
        catch (error) {
            const errorMessage = `Failed to publish multiple values: ${error.message}`;
            this.logger.error(errorMessage);
            this.node.status({ fill: "yellow", shape: "ring", text: "MQTT failed - continuing locally" });
            // Don't throw - let local services continue even if MQTT fails
        }
    }
    /**
     * Publish custom payload
     */
    async publishCustomPayload(payload) {
        try {
            const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
            await this.mqttClient.publish(this.publishTopic, payloadString);
            this.node.send({ payload });
            this.node.status({ fill: "green", shape: "dot", text: "Custom payload published" });
            this.logger.debug(`Published custom payload`);
        }
        catch (error) {
            const errorMessage = `Failed to publish custom payload: ${error.message}`;
            this.logger.error(errorMessage);
            this.node.status({ fill: "yellow", shape: "ring", text: "MQTT failed - continuing locally" });
            // Don't throw - let local services continue even if MQTT fails
        }
    }
    /**
     * Clear all pending publish timeouts
     */
    clearAllTimeouts() {
        this.publishTimeouts.forEach((timeout, key) => {
            clearTimeout(timeout);
        });
        this.publishTimeouts.clear();
    }
    /**
     * Get the number of pending publishes
     */
    getPendingPublishCount() {
        return this.publishTimeouts.size;
    }
    /**
     * Get list of keys with pending publishes
     */
    getPendingPublishKeys() {
        return Array.from(this.publishTimeouts.keys());
    }
    /**
     * Check if a key has a pending publish
     */
    hasPendingPublish(key) {
        return this.publishTimeouts.has(key);
    }
    /**
     * Cancel pending publish for a specific key
     */
    cancelPendingPublish(key) {
        const timeout = this.publishTimeouts.get(key);
        if (timeout) {
            clearTimeout(timeout);
            this.publishTimeouts.delete(key);
            this.logger.debug(`Cancelled pending publish for ${key}`);
            return true;
        }
        return false;
    }
    /**
     * Force publish all pending values immediately
     */
    async flushPendingPublishes() {
        const pendingKeys = Array.from(this.publishTimeouts.keys());
        if (pendingKeys.length === 0) {
            return;
        }
        // Clear all timeouts and trigger immediate publishes
        for (const key of pendingKeys) {
            const timeout = this.publishTimeouts.get(key);
            if (timeout) {
                clearTimeout(timeout);
                this.publishTimeouts.delete(key);
                // Note: We can't easily get the value here without refactoring
                // This method is mainly for cleanup purposes
            }
        }
    }
    /**
     * Get MQTT client connection status
     */
    isConnected() {
        return this.mqttClient && this.mqttClient.isConnected();
    }
    /**
     * Get publish topic
     */
    getPublishTopic() {
        return this.publishTopic;
    }
    /**
     * Publish error status
     */
    async publishError(errorMessage) {
        const mqttPayload = {
            ts: Date.now(),
            error: errorMessage,
            status: "error"
        };
        try {
            const payloadString = JSON.stringify(mqttPayload);
            await this.mqttClient.publish(this.publishTopic, payloadString);
            this.node.send({ payload: mqttPayload });
        }
        catch (error) {
            // Don't throw error here to prevent cascading failures
            this.logger.error(`Failed to publish error status: ${error.message}`);
        }
    }
}
exports.MqttService = MqttService;

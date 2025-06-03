"use strict";
/**
 * Connection manager for viis-telemetry node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViisTelemetryConnectionManager = void 0;
/**
 * Manages connections and their status for viis-telemetry node
 */
class ViisTelemetryConnectionManager {
    constructor(node, modbusClient, localMqttClient, thingsboardMqttClient, mysqlClient) {
        this.eventHandlers = new Map();
        this.node = node;
        this.modbusClient = modbusClient;
        this.localMqttClient = localMqttClient;
        this.thingsboardMqttClient = thingsboardMqttClient;
        this.mysqlClient = mysqlClient;
        this.currentStatus = this.getCurrentStatus();
        this.setupEventListeners();
    }
    /**
     * Get current connection status
     */
    getCurrentStatus() {
        return {
            modbus: this.modbusClient.isConnectedCheck(),
            localMqtt: this.localMqttClient.isConnected(),
            thingsboardMqtt: this.thingsboardMqttClient.isConnected(),
            mysql: true, // MySQL uses connection pool, assume always available
        };
    }
    /**
     * Check if all clients are connected
     */
    areAllClientsConnected() {
        const status = this.getCurrentStatus();
        return status.modbus && status.localMqtt && status.thingsboardMqtt && status.mysql;
    }
    /**
     * Register event handler
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }
    /**
     * Remove event handler
     */
    off(event, handler) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }
    /**
     * Emit connection event
     */
    emit(event, status) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => handler(status));
        }
    }
    /**
     * Setup event listeners for all clients
     */
    setupEventListeners() {
        // Modbus client events
        this.modbusClient.on("modbus-status", (status) => {
            this.handleConnectionChange('modbus', status.status === 'connected');
        });
        // Local MQTT client events
        this.localMqttClient.on("mqtt-status", (status) => {
            this.handleConnectionChange('localMqtt', status.status === 'connected');
        });
        // ThingsBoard MQTT client events
        this.thingsboardMqttClient.on("mqtt-status", (status) => {
            this.handleConnectionChange('thingsboardMqtt', status.status === 'connected');
        });
        // MySQL client events (if needed)
        this.mysqlClient.on("mysql-status", (status) => {
            this.handleConnectionChange('mysql', status.status === 'connected');
        });
    }
    /**
     * Handle connection status change
     */
    handleConnectionChange(clientType, isConnected) {
        const previousStatus = Object.assign({}, this.currentStatus);
        this.currentStatus[clientType] = isConnected;
        // Update node status
        this.updateNodeStatus();
        // Emit specific events
        if (isConnected) {
            this.emit('connected', this.currentStatus);
        }
        else {
            this.emit('disconnected', this.currentStatus);
        }
        // Check for all connected/any disconnected
        const wasAllConnected = this.areAllConnectedStatus(previousStatus);
        const isAllConnected = this.areAllClientsConnected();
        if (!wasAllConnected && isAllConnected) {
            this.emit('all-connected', this.currentStatus);
        }
        else if (wasAllConnected && !isAllConnected) {
            this.emit('any-disconnected', this.currentStatus);
        }
    }
    /**
     * Check if all clients are connected in given status
     */
    areAllConnectedStatus(status) {
        return status.modbus && status.localMqtt && status.thingsboardMqtt && status.mysql;
    }
    /**
     * Update node visual status
     */
    updateNodeStatus() {
        if (this.areAllClientsConnected()) {
            this.node.status({ fill: "green", shape: "dot", text: "All clients connected" });
        }
        else {
            const disconnected = Object.entries(this.currentStatus)
                .filter(([_, connected]) => !connected)
                .map(([client, _]) => client);
            this.node.status({
                fill: "red",
                shape: "ring",
                text: `Disconnected: ${disconnected.join(', ')}`
            });
        }
    }
    /**
     * Get clients for external use
     */
    getClients() {
        return {
            modbus: this.modbusClient,
            localMqtt: this.localMqttClient,
            thingsboardMqtt: this.thingsboardMqttClient,
            mysql: this.mysqlClient,
        };
    }
    /**
     * Cleanup connections
     */
    cleanup() {
        this.eventHandlers.clear();
    }
}
exports.ViisTelemetryConnectionManager = ViisTelemetryConnectionManager;

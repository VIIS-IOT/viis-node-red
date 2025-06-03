"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_client_1 = require("./modbus-client");
const mqtt_client_1 = require("./mqtt-client");
const mysql_client_1 = require("./mysql-client");
class ClientRegistry {
    static async getThingsboardMqttClient(config, node) {
        // Wait if another node is already initializing
        while (this.initializingFlags.thingsboard) {
            node.warn("[THINGSBOARD-INIT] Another node is initializing ThingsBoard client, waiting...");
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!this.thingsboardMqttInstance) {
            this.initializingFlags.thingsboard = true;
            node.warn(`[THINGSBOARD-INIT] Node ${node.id} starting ThingsBoard MQTT client initialization`);
            try {
                this.thingsboardMqttInstance = new mqtt_client_1.MqttClientCore(config, node);
                node.warn("Created new Thingsboard MqttClientCore instance");
                await this.thingsboardMqttInstance.waitForConnection();
                this.activeConnections.thingsboardMqtt++;
                node.warn("Thingsboard MQTT client connected successfully");
                this.logActiveConnections(node);
            }
            catch (error) {
                this.thingsboardMqttInstance = null; // Reset on failure
                node.error(`Failed to connect Thingsboard MQTT client: ${error.message}`);
                throw error;
            }
            finally {
                this.initializingFlags.thingsboard = false;
            }
        }
        this.referenceCount.thingsboard++;
        this.clientUsers.thingsboard.add(node.id);
        node.warn(`[THINGSBOARD-INIT] Node ${node.id} got ThingsBoard client, ref count: ${this.referenceCount.thingsboard}`);
        node.warn(`[THINGSBOARD-INIT] Active users: ${Array.from(this.clientUsers.thingsboard).join(', ')}`);
        return this.thingsboardMqttInstance;
    }
    static async getLocalMqttClient(config, node) {
        // Wait if another node is already initializing
        while (this.initializingFlags.local) {
            node.warn("[LOCAL-INIT] Another node is initializing Local MQTT client, waiting...");
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!this.localMqttInstance) {
            this.initializingFlags.local = true;
            node.warn(`[LOCAL-INIT] Node ${node.id} starting Local MQTT client initialization`);
            try {
                this.localMqttInstance = new mqtt_client_1.MqttClientCore(config, node);
                node.warn("Created new Local MqttClientCore instance");
                await this.localMqttInstance.waitForConnection();
                this.activeConnections.localMqtt++;
                node.warn("Local MQTT client connected successfully");
                this.logActiveConnections(node);
            }
            catch (error) {
                this.localMqttInstance = null; // Reset on failure
                node.error(`Failed to connect Local MQTT client: ${error.message}`);
                throw error;
            }
            finally {
                this.initializingFlags.local = false;
            }
        }
        this.referenceCount.local++;
        this.clientUsers.local.add(node.id);
        node.warn(`[LOCAL-INIT] Node ${node.id} got Local MQTT client, ref count: ${this.referenceCount.local}`);
        node.warn(`[LOCAL-INIT] Active users: ${Array.from(this.clientUsers.local).join(', ')}`);
        return this.localMqttInstance;
    }
    /**
     * Validate if the provided config matches the existing shared config
     * This ensures only ONE modbus connection is used across all nodes
     */
    static validateModbusConfig(config, node) {
        if (!this.modbusConfig) {
            return true; // No existing config, any config is valid
        }
        const configMatches = (this.modbusConfig.type === config.type &&
            this.modbusConfig.host === config.host &&
            this.modbusConfig.tcpPort === config.tcpPort &&
            this.modbusConfig.serialPort === config.serialPort &&
            this.modbusConfig.baudRate === config.baudRate &&
            this.modbusConfig.parity === config.parity &&
            this.modbusConfig.unitId === config.unitId);
        if (!configMatches) {
            node.warn(`[MODBUS-SINGLE-CONNECTION-ENFORCED] Node ${node.id} config differs from shared config:`);
            node.warn(`  Existing shared config: ${this.modbusConfig.type} ${this.modbusConfig.host}:${this.modbusConfig.tcpPort} unit=${this.modbusConfig.unitId}`);
            node.warn(`  Requested config: ${config.type} ${config.host}:${config.tcpPort} unit=${config.unitId}`);
            node.warn(`  ENFORCING SINGLE CONNECTION: Using existing shared connection to prevent multiple modbus connections.`);
            node.warn(`  All VIIS nodes MUST use the same modbus connection for proper resource management.`);
        }
        return configMatches;
    }
    static getModbusClient(config, node) {
        var _a, _b, _c;
        // Wait if another node is already initializing
        while (this.initializingFlags.modbus) {
            node.warn("[MODBUS-SINGLE-CONNECTION] Another node is initializing Modbus client, waiting...");
            // Use synchronous wait to avoid async issues in this method
            const start = Date.now();
            while (Date.now() - start < 100) { /* busy wait */ }
        }
        // Validate config compatibility - ENFORCES SINGLE CONNECTION
        this.validateModbusConfig(config, node);
        if (!this.modbusInstance || !this.modbusInstance.isConnectedCheck()) {
            this.initializingFlags.modbus = true;
            node.warn(`[MODBUS-SINGLE-CONNECTION] Node ${node.id} creating THE ONLY modbus connection for all VIIS nodes`);
            try {
                if (this.modbusInstance) {
                    this.modbusInstance.disconnect();
                    this.activeConnections.modbus--;
                    node.log("Previous Modbus instance disconnected due to invalid state");
                }
                // Store the config from the first node that creates the connection
                if (!this.modbusConfig) {
                    this.modbusConfig = Object.assign({}, config);
                    node.warn(`[MODBUS-SINGLE-CONNECTION] Storing shared config for ALL nodes: ${config.type} ${config.host}:${config.tcpPort} unit=${config.unitId}`);
                }
                // Always use the stored config to ensure consistency - SINGLE CONNECTION ENFORCED
                this.modbusInstance = new modbus_client_1.ModbusClientCore(this.modbusConfig, node);
                this.activeConnections.modbus++;
                node.warn(`[MODBUS-SINGLE-CONNECTION] Created THE ONLY ModbusClientCore instance - all nodes will share this connection`);
                this.logActiveConnections(node);
            }
            finally {
                this.initializingFlags.modbus = false;
            }
        }
        this.referenceCount.modbus++;
        this.clientUsers.modbus.add(node.id);
        node.warn(`[MODBUS-SINGLE-CONNECTION] Node ${node.id} got shared Modbus client, ref count: ${this.referenceCount.modbus}`);
        node.warn(`[MODBUS-SINGLE-CONNECTION] Active users sharing THE SAME connection: ${Array.from(this.clientUsers.modbus).join(', ')}`);
        node.warn(`[MODBUS-SINGLE-CONNECTION] Shared connection config: ${(_a = this.modbusConfig) === null || _a === void 0 ? void 0 : _a.type} ${(_b = this.modbusConfig) === null || _b === void 0 ? void 0 : _b.host}:${(_c = this.modbusConfig) === null || _c === void 0 ? void 0 : _c.tcpPort}`);
        return this.modbusInstance;
    }
    static getMySqlClient(config, node) {
        if (!this.mysqlInstance) {
            this.mysqlInstance = new mysql_client_1.MySqlClientCore(config, node);
            this.activeConnections.mysql++;
            node.log("Created new MySQL client instance");
            this.logActiveConnections(node);
        }
        return this.mysqlInstance;
    }
    static releaseClient(type, node) {
        if (type === "modbus" && this.modbusInstance) {
            this.referenceCount.modbus--;
            this.clientUsers.modbus.delete(node.id);
            node.warn(`[MODBUS-SINGLE-CONNECTION] Node ${node.id} released shared Modbus client, ref count: ${this.referenceCount.modbus}`);
            node.warn(`[MODBUS-SINGLE-CONNECTION] Remaining users: ${Array.from(this.clientUsers.modbus).join(', ')}`);
            if (this.referenceCount.modbus <= 0) {
                this.modbusInstance.disconnect();
                this.activeConnections.modbus--;
                this.modbusInstance = null;
                this.modbusConfig = null; // Reset config when no nodes are using the client
                this.clientUsers.modbus.clear();
                node.warn("[MODBUS-SINGLE-CONNECTION] THE ONLY modbus connection has been disconnected - no more users");
                this.logActiveConnections(node);
            }
        }
        else if (type === "thingsboard" && this.thingsboardMqttInstance) {
            this.referenceCount.thingsboard--;
            this.clientUsers.thingsboard.delete(node.id);
            node.warn(`[THINGSBOARD-RELEASE] Node ${node.id} released ThingsBoard client, ref count: ${this.referenceCount.thingsboard}`);
            if (this.referenceCount.thingsboard <= 0) {
                this.thingsboardMqttInstance.disconnect();
                this.activeConnections.thingsboardMqtt--;
                this.thingsboardMqttInstance = null;
                this.clientUsers.thingsboard.clear();
                node.log("Disconnected and cleared Thingsboard MqttClientCore instance");
                this.logActiveConnections(node);
            }
        }
        else if (type === "local" && this.localMqttInstance) {
            this.referenceCount.local--;
            this.clientUsers.local.delete(node.id);
            node.warn(`[LOCAL-RELEASE] Node ${node.id} released Local MQTT client, ref count: ${this.referenceCount.local}`);
            if (this.referenceCount.local <= 0) {
                this.localMqttInstance.disconnect();
                this.activeConnections.localMqtt--;
                this.localMqttInstance = null;
                this.clientUsers.local.clear();
                node.log("Disconnected and cleared Local MqttClientCore instance");
                this.logActiveConnections(node);
            }
        }
        else if (type === "mysql" && this.mysqlInstance) {
            this.mysqlInstance.disconnect();
            this.activeConnections.mysql--;
            this.mysqlInstance = null;
            this.clientUsers.mysql.clear();
            node.log("Disconnected and cleared MySQL client instance");
            this.logActiveConnections(node);
        }
    }
    static logActiveConnections(node) {
        node.warn(`[CONNECTION-STATUS] Active server connections - Modbus: ${this.activeConnections.modbus}, ThingsBoard MQTT: ${this.activeConnections.thingsboardMqtt}, Local MQTT: ${this.activeConnections.localMqtt}, MySQL: ${this.activeConnections.mysql}`);
        // Enforce single connection validation
        if (this.activeConnections.modbus > 1) {
            node.error(`[CRITICAL-ERROR] MULTIPLE MODBUS CONNECTIONS DETECTED! Count: ${this.activeConnections.modbus}. This should NEVER happen!`);
        }
        else if (this.activeConnections.modbus === 1) {
            node.warn(`[MODBUS-SINGLE-CONNECTION] ✓ Correctly using SINGLE modbus connection as designed`);
        }
    }
    static logConnectionCounts(node) {
        node.warn(`[CONNECTION-COUNTS] Reference counts - Modbus: ${this.referenceCount.modbus}, ThingsBoard: ${this.referenceCount.thingsboard}, Local MQTT: ${this.referenceCount.local}`);
        this.logActiveConnections(node);
        // Log shared modbus config if exists
        if (this.modbusConfig && this.referenceCount.modbus > 0) {
            node.warn(`[MODBUS-SINGLE-CONNECTION] Shared config used by ALL nodes: ${this.modbusConfig.type} ${this.modbusConfig.host}:${this.modbusConfig.tcpPort} unit=${this.modbusConfig.unitId}`);
            node.warn(`[MODBUS-SINGLE-CONNECTION] All nodes sharing THE SAME connection: ${Array.from(this.clientUsers.modbus).join(', ')}`);
        }
    }
    /**
     * Validate that only one modbus connection exists
     * This method should be called periodically to ensure system integrity
     */
    static validateSingleModbusConnection(node) {
        const isValid = this.activeConnections.modbus <= 1;
        if (!isValid) {
            node.error(`[CRITICAL-VIOLATION] MULTIPLE MODBUS CONNECTIONS DETECTED! Active: ${this.activeConnections.modbus}`);
            node.error(`[CRITICAL-VIOLATION] This violates the single connection requirement!`);
            node.error(`[CRITICAL-VIOLATION] Users: ${Array.from(this.clientUsers.modbus).join(', ')}`);
        }
        else if (this.activeConnections.modbus === 1) {
            node.log(`[MODBUS-VALIDATION] ✓ Single connection requirement satisfied`);
        }
        return isValid;
    }
    /**
     * Get current modbus connection status for monitoring
     */
    static getModbusConnectionStatus() {
        return {
            hasConnection: this.modbusInstance !== null,
            activeConnections: this.activeConnections.modbus,
            referenceCount: this.referenceCount.modbus,
            users: Array.from(this.clientUsers.modbus),
            config: this.modbusConfig
        };
    }
}
ClientRegistry.modbusInstance = null;
ClientRegistry.thingsboardMqttInstance = null;
ClientRegistry.localMqttInstance = null;
ClientRegistry.mysqlInstance = null;
ClientRegistry.referenceCount = { modbus: 0, thingsboard: 0, local: 0 };
ClientRegistry.activeConnections = {
    modbus: 0,
    thingsboardMqtt: 0,
    localMqtt: 0,
    mysql: 0
};
// Store the config used for the shared modbus client
ClientRegistry.modbusConfig = null;
// Mutex-like flags to prevent race conditions
ClientRegistry.initializingFlags = {
    thingsboard: false,
    local: false,
    modbus: false,
    mysql: false
};
// Track which nodes are using which clients for debugging
ClientRegistry.clientUsers = {
    modbus: new Set(),
    thingsboard: new Set(),
    local: new Set(),
    mysql: new Set()
};
exports.default = ClientRegistry;

import { Node } from "node-red";
import { ModbusClientCore, ModbusConfig } from "./modbus-client";
import { MqttClientCore, MqttConfig } from "./mqtt-client";
import { MySqlClientCore } from "./mysql-client";

class ClientRegistry {
    private static modbusInstance: ModbusClientCore | null = null;
    private static thingsboardMqttInstance: MqttClientCore | null = null;
    private static localMqttInstance: MqttClientCore | null = null;
    private static mysqlInstance: MySqlClientCore | null = null;
    private static referenceCount = { modbus: 0, thingsboard: 0, local: 0 };
    private static activeConnections = {
        modbus: 0,
        thingsboardMqtt: 0,
        localMqtt: 0,
        mysql: 0
    };

    // Store the config used for the shared modbus client
    private static modbusConfig: ModbusConfig | null = null;

    // Mutex-like flags to prevent race conditions
    private static initializingFlags = {
        thingsboard: false,
        local: false,
        modbus: false,
        mysql: false
    };

    // Track which nodes are using which clients for debugging
    private static clientUsers = {
        modbus: new Set<string>(),
        thingsboard: new Set<string>(),
        local: new Set<string>(),
        mysql: new Set<string>()
    };

    static async getThingsboardMqttClient(config: MqttConfig, node: Node): Promise<MqttClientCore> {
        // Wait if another node is already initializing
        while (this.initializingFlags.thingsboard) {
            node.warn("[THINGSBOARD-INIT] Another node is initializing ThingsBoard client, waiting...");
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!this.thingsboardMqttInstance) {
            this.initializingFlags.thingsboard = true;
            node.warn(`[THINGSBOARD-INIT] Node ${node.id} starting ThingsBoard MQTT client initialization`);

            try {
                this.thingsboardMqttInstance = new MqttClientCore(config, node);
                node.warn("Created new Thingsboard MqttClientCore instance");

                await this.thingsboardMqttInstance.waitForConnection();
                this.activeConnections.thingsboardMqtt++;
                node.warn("Thingsboard MQTT client connected successfully");
                this.logActiveConnections(node);
            } catch (error) {
                this.thingsboardMqttInstance = null; // Reset on failure
                node.error(`Failed to connect Thingsboard MQTT client: ${(error as Error).message}`);
                throw error;
            } finally {
                this.initializingFlags.thingsboard = false;
            }
        }
        this.referenceCount.thingsboard++;
        this.clientUsers.thingsboard.add(node.id);
        node.warn(`[THINGSBOARD-INIT] Node ${node.id} got ThingsBoard client, ref count: ${this.referenceCount.thingsboard}`);
        node.warn(`[THINGSBOARD-INIT] Active users: ${Array.from(this.clientUsers.thingsboard).join(', ')}`);
        return this.thingsboardMqttInstance;
    }

    static async getLocalMqttClient(config: MqttConfig, node: Node): Promise<MqttClientCore> {
        // Wait if another node is already initializing
        while (this.initializingFlags.local) {
            node.warn("[LOCAL-INIT] Another node is initializing Local MQTT client, waiting...");
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!this.localMqttInstance) {
            this.initializingFlags.local = true;
            node.warn(`[LOCAL-INIT] Node ${node.id} starting Local MQTT client initialization`);

            try {
                this.localMqttInstance = new MqttClientCore(config, node);
                node.warn("Created new Local MqttClientCore instance");

                await this.localMqttInstance.waitForConnection();
                this.activeConnections.localMqtt++;
                node.warn("Local MQTT client connected successfully");
                this.logActiveConnections(node);
            } catch (error) {
                this.localMqttInstance = null; // Reset on failure
                node.error(`Failed to connect Local MQTT client: ${(error as Error).message}`);
                throw error;
            } finally {
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
     */
    private static validateModbusConfig(config: ModbusConfig, node: Node): boolean {
        if (!this.modbusConfig) {
            return true; // No existing config, any config is valid
        }

        const configMatches = (
            this.modbusConfig.type === config.type &&
            this.modbusConfig.host === config.host &&
            this.modbusConfig.tcpPort === config.tcpPort &&
            this.modbusConfig.serialPort === config.serialPort &&
            this.modbusConfig.baudRate === config.baudRate &&
            this.modbusConfig.parity === config.parity &&
            this.modbusConfig.unitId === config.unitId
        );

        if (!configMatches) {
            node.warn(`[MODBUS-CONFIG-MISMATCH] Node ${node.id} config differs from shared config:`);
            node.warn(`  Existing: ${this.modbusConfig.type} ${this.modbusConfig.host}:${this.modbusConfig.tcpPort} unit=${this.modbusConfig.unitId}`);
            node.warn(`  Requested: ${config.type} ${config.host}:${config.tcpPort} unit=${config.unitId}`);
            node.warn(`  Using existing shared connection with config from first node.`);
        }

        return configMatches;
    }

    static getModbusClient(config: ModbusConfig, node: Node): ModbusClientCore {
        // Wait if another node is already initializing
        while (this.initializingFlags.modbus) {
            node.warn("[MODBUS-INIT] Another node is initializing Modbus client, waiting...");
            // Use synchronous wait to avoid async issues in this method
            const start = Date.now();
            while (Date.now() - start < 100) { /* busy wait */ }
        }

        // Validate config compatibility
        this.validateModbusConfig(config, node);

        if (!this.modbusInstance || !this.modbusInstance.isConnectedCheck()) {
            this.initializingFlags.modbus = true;
            node.warn(`[MODBUS-INIT] Node ${node.id} starting Modbus client initialization`);

            try {
                if (this.modbusInstance) {
                    this.modbusInstance.disconnect();
                    this.activeConnections.modbus--;
                    node.log("Previous Modbus instance disconnected due to invalid state");
                }

                // Store the config from the first node that creates the connection
                if (!this.modbusConfig) {
                    this.modbusConfig = { ...config };
                    node.warn(`[MODBUS-INIT] Storing shared config: ${config.type} ${config.host}:${config.tcpPort} unit=${config.unitId}`);
                }

                // Always use the stored config to ensure consistency
                this.modbusInstance = new ModbusClientCore(this.modbusConfig, node);
                this.activeConnections.modbus++;
                node.log("Created new ModbusClientCore instance with shared config");
                this.logActiveConnections(node);
            } finally {
                this.initializingFlags.modbus = false;
            }
        }
        this.referenceCount.modbus++;
        this.clientUsers.modbus.add(node.id);
        node.warn(`[MODBUS-INIT] Node ${node.id} got Modbus client, ref count: ${this.referenceCount.modbus}`);
        node.warn(`[MODBUS-INIT] Active users: ${Array.from(this.clientUsers.modbus).join(', ')}`);
        node.warn(`[MODBUS-INIT] Shared connection config: ${this.modbusConfig?.type} ${this.modbusConfig?.host}:${this.modbusConfig?.tcpPort}`);
        return this.modbusInstance;
    }

    static getMySqlClient(config: any, node: Node): MySqlClientCore {
        if (!this.mysqlInstance) {
            this.mysqlInstance = new MySqlClientCore(config, node);
            this.activeConnections.mysql++;
            node.log("Created new MySQL client instance");
            this.logActiveConnections(node);
        }
        return this.mysqlInstance;
    }

    static releaseClient(type: "modbus" | "thingsboard" | "local" | "mysql", node: Node) {
        if (type === "modbus" && this.modbusInstance) {
            this.referenceCount.modbus--;
            this.clientUsers.modbus.delete(node.id);
            node.warn(`[MODBUS-RELEASE] Node ${node.id} released Modbus client, ref count: ${this.referenceCount.modbus}`);
            if (this.referenceCount.modbus <= 0) {
                this.modbusInstance.disconnect();
                this.activeConnections.modbus--;
                this.modbusInstance = null;
                this.modbusConfig = null; // Reset config when no nodes are using the client
                this.clientUsers.modbus.clear();
                node.log("Disconnected and cleared ModbusClientCore instance and config");
                this.logActiveConnections(node);
            }
        } else if (type === "thingsboard" && this.thingsboardMqttInstance) {
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
        } else if (type === "local" && this.localMqttInstance) {
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
        } else if (type === "mysql" && this.mysqlInstance) {
            this.mysqlInstance.disconnect();
            this.activeConnections.mysql--;
            this.mysqlInstance = null;
            this.clientUsers.mysql.clear();
            node.log("Disconnected and cleared MySQL client instance");
            this.logActiveConnections(node);
        }
    }

    static logActiveConnections(node: Node) {
        node.warn(`Active server connections - Modbus: ${this.activeConnections.modbus}, ThingsBoard MQTT: ${this.activeConnections.thingsboardMqtt}, Local MQTT: ${this.activeConnections.localMqtt}, MySQL: ${this.activeConnections.mysql}`);
    }

    static logConnectionCounts(node: Node) {
        node.warn(`Reference counts - Modbus: ${this.referenceCount.modbus}, ThingsBoard: ${this.referenceCount.thingsboard}, Local MQTT: ${this.referenceCount.local}`);
        this.logActiveConnections(node);

        // Log shared modbus config if exists
        if (this.modbusConfig && this.referenceCount.modbus > 0) {
            node.warn(`Shared Modbus config: ${this.modbusConfig.type} ${this.modbusConfig.host}:${this.modbusConfig.tcpPort} unit=${this.modbusConfig.unitId}`);
            node.warn(`Modbus users: ${Array.from(this.clientUsers.modbus).join(', ')}`);
        }
    }
}

export default ClientRegistry;
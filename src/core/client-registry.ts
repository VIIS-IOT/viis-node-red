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

    static async getThingsboardMqttClient(config: MqttConfig, node: Node): Promise<MqttClientCore> {
        if (!this.thingsboardMqttInstance) {
            this.thingsboardMqttInstance = new MqttClientCore(config, node);
            node.warn("Created new Thingsboard MqttClientCore instance");
            try {
                await this.thingsboardMqttInstance.waitForConnection();
                this.activeConnections.thingsboardMqtt++;
                node.warn("Thingsboard MQTT client connected successfully");
                this.logActiveConnections(node);
            } catch (error) {
                node.error(`Failed to connect Thingsboard MQTT client: ${(error as Error).message}`);
                throw error;
            }
        }
        this.referenceCount.thingsboard++;
        return this.thingsboardMqttInstance;
    }

    static async getLocalMqttClient(config: MqttConfig, node: Node): Promise<MqttClientCore> {
        if (!this.localMqttInstance) {
            this.localMqttInstance = new MqttClientCore(config, node);
            node.warn("Created new Local MqttClientCore instance");
            try {
                await this.localMqttInstance.waitForConnection();
                this.activeConnections.localMqtt++;
                node.warn("Local MQTT client connected successfully");
                this.logActiveConnections(node);
            } catch (error) {
                node.error(`Failed to connect Local MQTT client: ${(error as Error).message}`);
                throw error;
            }
        }
        this.referenceCount.local++;
        return this.localMqttInstance;
    }

    static getModbusClient(config: ModbusConfig, node: Node): ModbusClientCore {
        if (!this.modbusInstance || !this.modbusInstance.isConnectedCheck()) {
            if (this.modbusInstance) {
                this.modbusInstance.disconnect();
                this.activeConnections.modbus--;
                node.log("Previous Modbus instance disconnected due to invalid state");
            }
            this.modbusInstance = new ModbusClientCore(config, node);
            this.activeConnections.modbus++;
            node.log("Created new ModbusClientCore instance");
            this.logActiveConnections(node);
        }
        this.referenceCount.modbus++;
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
            if (this.referenceCount.modbus <= 0) {
                this.modbusInstance.disconnect();
                this.activeConnections.modbus--;
                this.modbusInstance = null;
                node.log("Disconnected and cleared ModbusClientCore instance");
                this.logActiveConnections(node);
            }
        } else if (type === "thingsboard" && this.thingsboardMqttInstance) {
            this.referenceCount.thingsboard--;
            if (this.referenceCount.thingsboard <= 0) {
                this.thingsboardMqttInstance.disconnect();
                this.activeConnections.thingsboardMqtt--;
                this.thingsboardMqttInstance = null;
                node.log("Disconnected and cleared Thingsboard MqttClientCore instance");
                this.logActiveConnections(node);
            }
        } else if (type === "local" && this.localMqttInstance) {
            this.referenceCount.local--;
            if (this.referenceCount.local <= 0) {
                this.localMqttInstance.disconnect();
                this.activeConnections.localMqtt--;
                this.localMqttInstance = null;
                node.log("Disconnected and cleared Local MqttClientCore instance");
                this.logActiveConnections(node);
            }
        } else if (type === "mysql" && this.mysqlInstance) {
            this.mysqlInstance.disconnect();
            this.activeConnections.mysql--;
            this.mysqlInstance = null;
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
    }
}

export default ClientRegistry;
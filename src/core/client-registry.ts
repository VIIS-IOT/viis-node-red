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

    static async getThingsboardMqttClient(config: MqttConfig, node: Node): Promise<MqttClientCore> {
        if (!this.thingsboardMqttInstance) {
            this.thingsboardMqttInstance = new MqttClientCore(config, node);
            node.warn("Created new Thingsboard MqttClientCore instance");
            try {
                await this.thingsboardMqttInstance.waitForConnection();
                node.warn("Thingsboard MQTT client connected successfully");
            } catch (error) {
                node.error(`Failed to connect Thingsboard MQTT client: ${(error as Error).message}`);
                throw error;
            }
        }
        this.referenceCount.thingsboard++;
        return this.thingsboardMqttInstance;
    }

    // Các hàm khác giữ nguyên, chỉ cần đảm bảo async nếu cần
    static async getLocalMqttClient(config: MqttConfig, node: Node): Promise<MqttClientCore> {
        if (!this.localMqttInstance) {
            this.localMqttInstance = new MqttClientCore(config, node);
            node.warn("Created new Local MqttClientCore instance");
            try {
                await this.localMqttInstance.waitForConnection();
                node.warn("Local MQTT client connected successfully");
            } catch (error) {
                node.error(`Failed to connect Local MQTT client: ${(error as Error).message}`);
                throw error;
            }
        }
        this.referenceCount.local++;
        return this.localMqttInstance;
    }

    static getModbusClient(config: ModbusConfig, node: Node): ModbusClientCore {
        if (!this.modbusInstance) {
            this.modbusInstance = new ModbusClientCore(config, node);
            node.log("Created new ModbusClientCore instance");
        }
        this.referenceCount.modbus++;
        return this.modbusInstance;
    }

    static getMySqlClient(config: any, node: Node): MySqlClientCore {
        if (!this.mysqlInstance) {
            this.mysqlInstance = new MySqlClientCore(config, node);
            node.log("Created new MySQL client instance");
        }
        return this.mysqlInstance;
    }

    static releaseClient(type: "modbus" | "thingsboard" | "local" | "mysql", node: Node) {
        if (type === "modbus" && this.modbusInstance) {
            this.referenceCount.modbus--;
            if (this.referenceCount.modbus <= 0) {
                this.modbusInstance.disconnect();
                this.modbusInstance = null;
                node.log("Disconnected and cleared ModbusClientCore instance");
            }
        } else if (type === "thingsboard" && this.thingsboardMqttInstance) {
            this.referenceCount.thingsboard--;
            if (this.referenceCount.thingsboard <= 0) {
                this.thingsboardMqttInstance.disconnect();
                this.thingsboardMqttInstance = null;
                node.log("Disconnected and cleared Thingsboard MqttClientCore instance");
            }
        } else if (type === "local" && this.localMqttInstance) {
            this.referenceCount.local--;
            if (this.referenceCount.local <= 0) {
                this.localMqttInstance.disconnect();
                this.localMqttInstance = null;
                node.log("Disconnected and cleared Local MqttClientCore instance");
            }
        } else if (type === "mysql" && this.mysqlInstance) {
            this.mysqlInstance.disconnect();
            this.mysqlInstance = null;
            node.log("Disconnected and cleared MySQL client instance");
        }
    }
}

export default ClientRegistry;
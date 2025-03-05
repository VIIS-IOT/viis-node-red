import { Node } from "node-red";
import { ModbusClientCore, ModbusConfig } from "./modbus-client";
import { MqttClientCore, MqttConfig } from "./mqtt-client";

// Registry để lưu trữ các instance chung
class ClientRegistry {
    private static modbusInstance: ModbusClientCore | null = null;
    private static thingsboardMqttInstance: MqttClientCore | null = null;
    private static localMqttInstance: MqttClientCore | null = null;
    private static referenceCount = { modbus: 0, thingsboard: 0, local: 0 };

    // Lấy hoặc tạo instance ModbusClientCore
    static getModbusClient(config: ModbusConfig, node: Node): ModbusClientCore {
        if (!this.modbusInstance) {
            this.modbusInstance = new ModbusClientCore(config, node);
            node.log("Created new ModbusClientCore instance");
        }
        this.referenceCount.modbus++;
        return this.modbusInstance;
    }

    // Lấy hoặc tạo instance MqttClientCore cho ThingsBoard
    static getThingsboardMqttClient(config: MqttConfig, node: Node): MqttClientCore {
        if (!this.thingsboardMqttInstance) {
            this.thingsboardMqttInstance = new MqttClientCore(config, node);
            node.log("Created new Thingsboard MqttClientCore instance");
        }
        this.referenceCount.thingsboard++;
        return this.thingsboardMqttInstance;
    }

    // Lấy hoặc tạo instance MqttClientCore cho EMQX local
    static getLocalMqttClient(config: MqttConfig, node: Node): MqttClientCore {
        if (!this.localMqttInstance) {
            this.localMqttInstance = new MqttClientCore(config, node);
            node.log("Created new Local MqttClientCore instance");
        }
        this.referenceCount.local++;
        return this.localMqttInstance;
    }

    // Giảm reference count và ngắt kết nối nếu không còn node nào sử dụng
    static releaseClient(type: "modbus" | "thingsboard" | "local", node: Node) {
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
        }
    }
}

export default ClientRegistry;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_client_1 = require("./modbus-client");
const mqtt_client_1 = require("./mqtt-client");
// Registry để lưu trữ các instance chung
class ClientRegistry {
    // Lấy hoặc tạo instance ModbusClientCore
    static getModbusClient(config, node) {
        if (!this.modbusInstance) {
            this.modbusInstance = new modbus_client_1.ModbusClientCore(config, node);
            node.log("Created new ModbusClientCore instance");
        }
        this.referenceCount.modbus++;
        return this.modbusInstance;
    }
    // Lấy hoặc tạo instance MqttClientCore cho ThingsBoard
    static getThingsboardMqttClient(config, node) {
        if (!this.thingsboardMqttInstance) {
            this.thingsboardMqttInstance = new mqtt_client_1.MqttClientCore(config, node);
            node.log("Created new Thingsboard MqttClientCore instance");
        }
        this.referenceCount.thingsboard++;
        return this.thingsboardMqttInstance;
    }
    // Lấy hoặc tạo instance MqttClientCore cho EMQX local
    static getLocalMqttClient(config, node) {
        if (!this.localMqttInstance) {
            this.localMqttInstance = new mqtt_client_1.MqttClientCore(config, node);
            node.log("Created new Local MqttClientCore instance");
        }
        this.referenceCount.local++;
        return this.localMqttInstance;
    }
    // Giảm reference count và ngắt kết nối nếu không còn node nào sử dụng
    static releaseClient(type, node) {
        if (type === "modbus" && this.modbusInstance) {
            this.referenceCount.modbus--;
            if (this.referenceCount.modbus <= 0) {
                this.modbusInstance.disconnect();
                this.modbusInstance = null;
                node.log("Disconnected and cleared ModbusClientCore instance");
            }
        }
        else if (type === "thingsboard" && this.thingsboardMqttInstance) {
            this.referenceCount.thingsboard--;
            if (this.referenceCount.thingsboard <= 0) {
                this.thingsboardMqttInstance.disconnect();
                this.thingsboardMqttInstance = null;
                node.log("Disconnected and cleared Thingsboard MqttClientCore instance");
            }
        }
        else if (type === "local" && this.localMqttInstance) {
            this.referenceCount.local--;
            if (this.referenceCount.local <= 0) {
                this.localMqttInstance.disconnect();
                this.localMqttInstance = null;
                node.log("Disconnected and cleared Local MqttClientCore instance");
            }
        }
    }
}
ClientRegistry.modbusInstance = null;
ClientRegistry.thingsboardMqttInstance = null;
ClientRegistry.localMqttInstance = null;
ClientRegistry.referenceCount = { modbus: 0, thingsboard: 0, local: 0 };
exports.default = ClientRegistry;

"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_client_1 = require("./modbus-client");
const mqtt_client_1 = require("./mqtt-client");
const mysql_client_1 = require("./mysql-client");
class ClientRegistry {
    static getThingsboardMqttClient(config, node) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.thingsboardMqttInstance) {
                this.thingsboardMqttInstance = new mqtt_client_1.MqttClientCore(config, node);
                node.warn("Created new Thingsboard MqttClientCore instance");
                try {
                    yield this.thingsboardMqttInstance.waitForConnection();
                    node.warn("Thingsboard MQTT client connected successfully");
                }
                catch (error) {
                    node.error(`Failed to connect Thingsboard MQTT client: ${error.message}`);
                    throw error;
                }
            }
            this.referenceCount.thingsboard++;
            return this.thingsboardMqttInstance;
        });
    }
    // Các hàm khác giữ nguyên, chỉ cần đảm bảo async nếu cần
    static getLocalMqttClient(config, node) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.localMqttInstance) {
                this.localMqttInstance = new mqtt_client_1.MqttClientCore(config, node);
                node.warn("Created new Local MqttClientCore instance");
                try {
                    yield this.localMqttInstance.waitForConnection();
                    node.warn("Local MQTT client connected successfully");
                }
                catch (error) {
                    node.error(`Failed to connect Local MQTT client: ${error.message}`);
                    throw error;
                }
            }
            this.referenceCount.local++;
            return this.localMqttInstance;
        });
    }
    static getModbusClient(config, node) {
        if (!this.modbusInstance) {
            this.modbusInstance = new modbus_client_1.ModbusClientCore(config, node);
            node.log("Created new ModbusClientCore instance");
        }
        this.referenceCount.modbus++;
        return this.modbusInstance;
    }
    static getMySqlClient(config, node) {
        if (!this.mysqlInstance) {
            this.mysqlInstance = new mysql_client_1.MySqlClientCore(config, node);
            node.log("Created new MySQL client instance");
        }
        return this.mysqlInstance;
    }
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
        else if (type === "mysql" && this.mysqlInstance) {
            this.mysqlInstance.disconnect();
            this.mysqlInstance = null;
            node.log("Disconnected and cleared MySQL client instance");
        }
    }
}
ClientRegistry.modbusInstance = null;
ClientRegistry.thingsboardMqttInstance = null;
ClientRegistry.localMqttInstance = null;
ClientRegistry.mysqlInstance = null;
ClientRegistry.referenceCount = { modbus: 0, thingsboard: 0, local: 0 };
exports.default = ClientRegistry;

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
                    this.activeConnections.thingsboardMqtt++;
                    node.warn("Thingsboard MQTT client connected successfully");
                    this.logActiveConnections(node);
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
    static getLocalMqttClient(config, node) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.localMqttInstance) {
                this.localMqttInstance = new mqtt_client_1.MqttClientCore(config, node);
                node.warn("Created new Local MqttClientCore instance");
                try {
                    yield this.localMqttInstance.waitForConnection();
                    this.activeConnections.localMqtt++;
                    node.warn("Local MQTT client connected successfully");
                    this.logActiveConnections(node);
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
        if (!this.modbusInstance || !this.modbusInstance.isConnectedCheck()) {
            if (this.modbusInstance) {
                this.modbusInstance.disconnect();
                this.activeConnections.modbus--;
                node.log("Previous Modbus instance disconnected due to invalid state");
            }
            this.modbusInstance = new modbus_client_1.ModbusClientCore(config, node);
            this.activeConnections.modbus++;
            node.log("Created new ModbusClientCore instance");
            this.logActiveConnections(node);
        }
        this.referenceCount.modbus++;
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
            if (this.referenceCount.modbus <= 0) {
                this.modbusInstance.disconnect();
                this.activeConnections.modbus--;
                this.modbusInstance = null;
                node.log("Disconnected and cleared ModbusClientCore instance");
                this.logActiveConnections(node);
            }
        }
        else if (type === "thingsboard" && this.thingsboardMqttInstance) {
            this.referenceCount.thingsboard--;
            if (this.referenceCount.thingsboard <= 0) {
                this.thingsboardMqttInstance.disconnect();
                this.activeConnections.thingsboardMqtt--;
                this.thingsboardMqttInstance = null;
                node.log("Disconnected and cleared Thingsboard MqttClientCore instance");
                this.logActiveConnections(node);
            }
        }
        else if (type === "local" && this.localMqttInstance) {
            this.referenceCount.local--;
            if (this.referenceCount.local <= 0) {
                this.localMqttInstance.disconnect();
                this.activeConnections.localMqtt--;
                this.localMqttInstance = null;
                node.log("Disconnected and cleared Local MqttClientCore instance");
                this.logActiveConnections(node);
            }
        }
        else if (type === "mysql" && this.mysqlInstance) {
            this.mysqlInstance.disconnect();
            this.activeConnections.mysql--;
            this.mysqlInstance = null;
            node.log("Disconnected and cleared MySQL client instance");
            this.logActiveConnections(node);
        }
    }
    static logActiveConnections(node) {
        node.warn(`Active server connections - Modbus: ${this.activeConnections.modbus}, ThingsBoard MQTT: ${this.activeConnections.thingsboardMqtt}, Local MQTT: ${this.activeConnections.localMqtt}, MySQL: ${this.activeConnections.mysql}`);
    }
    static logConnectionCounts(node) {
        node.warn(`Reference counts - Modbus: ${this.referenceCount.modbus}, ThingsBoard: ${this.referenceCount.thingsboard}, Local MQTT: ${this.referenceCount.local}`);
        this.logActiveConnections(node);
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
exports.default = ClientRegistry;

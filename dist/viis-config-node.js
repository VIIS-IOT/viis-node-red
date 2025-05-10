"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mqtt_1 = __importDefault(require("mqtt"));
const uuid_1 = require("uuid");
const const_1 = require("./const");
const parseMesssageIgnoreError = (msg) => {
    try {
        return JSON.parse(msg);
    }
    catch (error) {
        return null;
    }
};
module.exports = function (RED) {
    function ViisConfigNode(config) {
        RED.nodes.createNode(this, config);
        this.device = config.device || { id: "", accessToken: "" };
        const node = this;
        const connectMQTT = () => {
            if (!this.device.clientMQtt || !this.device.clientMQtt.connected) {
                const mqttOptions = {
                    host: const_1.mqttServerUrl,
                    port: 1883,
                    username: this.device.accessToken,
                    clientId: `node-red-${(0, uuid_1.v4)()}`,
                    keepalive: 15,
                    clean: true,
                };
                this.device.clientMQtt = mqtt_1.default.connect(mqttOptions);
                this.device.clientMQtt.on("connect", () => {
                    var _a;
                    this.log(`Device ${this.device.id} connected to MQTT`);
                    node.emit("mqtt-status", { status: "connected" });
                    (_a = this.device.clientMQtt) === null || _a === void 0 ? void 0 : _a.subscribe("v1/devices/me/rpc/request/+", (err) => {
                        if (err) {
                            this.log(`Device ${this.device.id} connected to MQTT, but can not subscribe, Err: ${err}`);
                        }
                    });
                });
                this.device.clientMQtt.on("message", (topic, message) => {
                    this.log(`Device ${this.device.id} connected to MQTT`);
                    const payload = parseMesssageIgnoreError(message.toString());
                    if (payload) {
                        node.emit("mqtt-message", {
                            message: payload,
                        });
                    }
                });
                this.device.clientMQtt.on("error", (err) => {
                    this.error(`MQTT error for device ${this.device.id}: ${err.message}`);
                    node.emit("mqtt-status", { status: "error", error: err.message });
                });
                this.device.clientMQtt.on("close", () => {
                    this.log(`Device ${this.device.id} disconnected from MQTT`);
                    node.emit("mqtt-status", { status: "disconnected" });
                });
            }
        };
        const disconnectMQTT = () => {
            if (this.device.clientMQtt && this.device.clientMQtt.connected) {
                this.device.clientMQtt.end();
                this.device.clientMQtt = undefined;
                this.log(`Device ${this.device.id} MQTT connection closed`);
                node.emit("mqtt-status", { status: "disconnected" });
            }
        };
        let isDeviceUsed = false;
        RED.nodes.eachNode((node) => {
            if (node.type === "viis-automation-node" && node.configNode === this.id) {
                isDeviceUsed = true;
            }
        });
        if (isDeviceUsed) {
            connectMQTT();
        }
        else {
            disconnectMQTT();
        }
        this.on("close", () => {
            disconnectMQTT();
        });
    }
    RED.nodes.registerType("viis-config-node", ViisConfigNode);
};

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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const device_1 = require("./core/device");
const dayjs_1 = __importDefault(require("dayjs"));
module.exports = function (RED) {
    function ViisUploadTelemetry(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNode = RED.nodes.getNode(config.configNode);
        if (!configNode) {
            node.error("Configuration node not found");
            return;
        }
        // Lấy thông tin thiết bị được chọn
        const selectedDevice = configNode.device;
        node.on("input", function (msg) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!selectedDevice) {
                    node.error("Device not found");
                    msg.payload = "Device not found";
                    node.send(msg);
                    return;
                }
                if (config.protocol === "MQTT") {
                    if (configNode.device.clientMQtt &&
                        configNode.device.clientMQtt.connected) {
                        configNode.device.clientMQtt.publish("v1/devices/me/telemetry", JSON.stringify(msg.payload));
                        node.send({
                            payload: {
                                ts: (0, dayjs_1.default)().valueOf(),
                                data: msg.payload,
                                success: true,
                            },
                        });
                    }
                    else if (config.enableBackup) {
                        node.warn("MQTT disconnected. Storing message for backup.");
                        node.send({
                            payload: {
                                ts: (0, dayjs_1.default)().valueOf(),
                                data: msg.payload,
                                success: false,
                            },
                        });
                        // Backup logic here (store in a queue or database)
                    }
                    else {
                        node.warn("MQTT disconnected");
                        node.send({
                            payload: {
                                ts: (0, dayjs_1.default)().valueOf(),
                                data: msg.payload,
                                success: false,
                            },
                        });
                    }
                }
                else if (config.protocol === "HTTP") {
                    const status = yield (0, device_1.sendTelemetryByHttp)(configNode.device.accessToken, msg.payload);
                    if (status) {
                        node.send({
                            payload: {
                                ts: (0, dayjs_1.default)().valueOf(),
                                data: msg.payload,
                                success: true,
                            },
                        });
                    }
                    else {
                        if (config.enableBackup) {
                            node.warn("HTTP upload error. Storing message for backup.");
                            node.send({
                                payload: {
                                    ts: (0, dayjs_1.default)().valueOf(),
                                    data: msg.payload,
                                    success: false,
                                },
                            });
                        }
                        else {
                            node.warn("HTTP upload error.");
                            node.send({
                                payload: {
                                    ts: (0, dayjs_1.default)().valueOf(),
                                    data: msg.payload,
                                    success: false,
                                },
                            });
                        }
                    }
                }
            });
        });
        configNode.on("mqtt-status", (data) => {
            if (data.status === "connected") {
                node.status({ fill: "green", shape: "dot", text: "Connected" });
            }
            else if (data.status === "disconnected") {
                node.status({ fill: "red", shape: "ring", text: "Disconnected" });
            }
            else if (data.status === "error") {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: `Error: ${data.error}`,
                });
            }
        });
    }
    RED.nodes.registerType("viis-upload-telemetry", ViisUploadTelemetry); // Đổi tên ở đây
};

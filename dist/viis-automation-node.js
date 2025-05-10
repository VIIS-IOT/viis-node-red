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
const device_1 = require("./core/device");
const deviceIntents_1 = require("./core/deviceIntents");
module.exports = function (RED) {
    function ViisAutomationNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNode = RED.nodes.getNode(config.configNode);
        if (!configNode) {
            node.error("Configuration node not found");
            return;
        }
        // Lấy thông tin thiết bị được chọn
        const selectedDevice = configNode.device;
        function processIntents(intents, devicesData) {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    const intentService = new deviceIntents_1.DeviceIntentService(intents, devicesData);
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `Processing intents`,
                    });
                    const results = yield intentService.processDeviceIntents();
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `Success Processing intents`,
                    });
                    node.send([
                        {
                            payload: {
                                intents: intents,
                                devices_data: devicesData,
                                results: results,
                            },
                        },
                        null,
                    ]);
                }
                catch (error) {
                    console.log(`Error process intents ${error}`);
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: `Error process: ${error}`,
                    });
                }
            });
        }
        node.on("input", function (msg) {
            var _a, _b;
            let intents = node.context().get("intents");
            const manualIntents = ((_a = msg.payload) === null || _a === void 0 ? void 0 : _a.intents) || [];
            if (manualIntents.length) {
                intents = manualIntents;
            }
            const devicesData = ((_b = msg.payload) === null || _b === void 0 ? void 0 : _b.devices_data) || [];
            processIntents(intents, devicesData);
        });
        function getMyIntents() {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    const intents = yield (0, device_1.getDeviceIntentsByToken)(selectedDevice.accessToken);
                    node.context().set("intents", intents || []);
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `Loaded ${intents ? intents.length : 0} intents`,
                    });
                    node.send([
                        null,
                        {
                            payload: intents,
                        },
                    ]);
                }
                catch (error) {
                    console.log(`Error lading intents of ${selectedDevice.id}`);
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: `Error: ${error}`,
                    });
                }
            });
        }
        configNode.on("mqtt-status", (data) => {
            if (data.status === "connected") {
                node.status({ fill: "green", shape: "dot", text: "Connected" });
                getMyIntents();
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
        configNode.on("mqtt-message", (data) => {
            if (data.message.method === "update_intents") {
                getMyIntents();
            }
        });
    }
    RED.nodes.registerType("viis-automation-node", ViisAutomationNode); // Đổi tên ở đây
};

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const device_1 = require("./core/device");
const deviceIntents_1 = require("./core/deviceIntents");
const offline_resilience_1 = require("./core/offline-resilience");
// Global flag to ensure error handlers are setup only once
let globalErrorHandlersInitialized = false;
module.exports = function (RED) {
    // Setup global error handlers (only once for all nodes)
    if (!globalErrorHandlersInitialized) {
        (0, offline_resilience_1.setupGlobalErrorHandlers)(RED);
        globalErrorHandlersInitialized = true;
    }
    function ViisAutomationNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNode = RED.nodes.getNode(config.configNode);
        if (!configNode) {
            node.error("Configuration node not found");
            return;
        }
        // Get device credentials (auto-loaded from config node)
        const selectedDevice = configNode.device;
        // Validate credentials
        if (!selectedDevice || !selectedDevice.id || !selectedDevice.accessToken) {
            node.error("Device credentials not found. Configure viis-config-node or set device_id/device_access_token in env-loader");
            node.status({ fill: "red", shape: "ring", text: "No credentials" });
            return;
        }
        node.log(`Using device: ${selectedDevice.id}`);
        // Lấy thông tin thiết bị được chọn
        async function processIntents(intents, devicesData) {
            try {
                const intentService = new deviceIntents_1.DeviceIntentService(intents, devicesData);
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `Processing intents`,
                });
                const results = await intentService.processDeviceIntents();
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
        async function getMyIntents() {
            try {
                const intents = await (0, device_1.getDeviceIntentsByToken)(selectedDevice.accessToken);
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

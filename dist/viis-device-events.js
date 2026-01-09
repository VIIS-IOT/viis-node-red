"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
module.exports = function (RED) {
    function ViisDeviceEventNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNode = RED.nodes.getNode(config.configNode);
        if (!configNode) {
            node.error("Configuration node not found");
            return;
        }
        // Validate config node has device credentials (auto-loaded)
        if (!configNode.device || !configNode.device.id) {
            node.warn("Device credentials not fully configured. Events may not be received.");
        }
        else {
            node.log(`Listening for events from device: ${configNode.device.id}`);
        }
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
        configNode.on("mqtt-message", (data) => {
            node.send({
                payload: {
                    message: data.message,
                },
            });
        });
    }
    RED.nodes.registerType("viis-device-events", ViisDeviceEventNode);
};

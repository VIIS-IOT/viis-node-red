"use strict";
/**
 * @fileoverview Configuration node for VIIS IoT device management
 * This node only stores device credentials (id and accessToken).
 * MQTT connections are managed by ClientRegistry in other nodes (vietplants-rpc-control, viis-rpc-control).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const env_helper_1 = require("./ultils/env-helper");
/**
 * Node-RED node registration function
 * @param {NodeAPI} RED - The Node-RED API object
 */
module.exports = function (RED) {
    /**
     * Constructor for the VIIS configuration node
     * @param {ViisConfigNodeDef} config - Configuration settings for this node
     */
    function ViisConfigNode(config) {
        var _a, _b, _c;
        RED.nodes.createNode(this, config);
        // Auto-load credentials from global context → process.env → UI config
        const credentials = (0, env_helper_1.loadDeviceCredentials)(this.context(), (_a = config.device) === null || _a === void 0 ? void 0 : _a.id, (_b = config.device) === null || _b === void 0 ? void 0 : _b.accessToken);
        this.device = {
            id: credentials.deviceId,
            accessToken: credentials.accessToken
        };
        // Log loading source for debugging
        if (((_c = config.device) === null || _c === void 0 ? void 0 : _c.id) && config.device.id.trim() !== '') {
            this.log(`Device ID loaded from UI config: ${credentials.deviceId}`);
        }
        else if (credentials.deviceId) {
            this.log(`Device ID auto-loaded from environment: ${credentials.deviceId}`);
        }
        // IMPORTANT: This config node only stores device credentials
        // All MQTT connections are managed by ClientRegistry in vietplants-rpc-control/viis-rpc-control nodes
        this.log(`Device ${this.device.id} credentials loaded (MQTT managed by ClientRegistry)`);
    }
    RED.nodes.registerType("viis-config-node", ViisConfigNode);
};

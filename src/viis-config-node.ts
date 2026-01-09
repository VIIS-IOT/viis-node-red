/**
 * @fileoverview Configuration node for VIIS IoT device management
 * This node only stores device credentials (id and accessToken).
 * MQTT connections are managed by ClientRegistry in other nodes (vietplants-rpc-control, viis-rpc-control).
 */

import { NodeAPI, NodeDef, Node } from "node-red";
import { loadDeviceCredentials } from "./ultils/env-helper";

/**
 * Represents an IoT device with its connection credentials
 * @interface Device
 */
export interface Device {
  /** Unique identifier for the device */
  id: string;
  /** Authentication token used for MQTT connection */
  accessToken: string;
}

/**
 * Configuration definition for the VIIS config node
 * @interface ViisConfigNodeDef
 * @extends NodeDef
 */
interface ViisConfigNodeDef extends NodeDef {
  /** Device configuration information */
  device: Device;
}

/**
 * Runtime instance of the VIIS config node
 * @interface ViisConfigNode
 * @extends Node
 */
export interface ViisConfigNode extends Node {
  /** Device instance with connection state */
  device: Device;
}



/**
 * Node-RED node registration function
 * @param {NodeAPI} RED - The Node-RED API object
 */
module.exports = function (RED: NodeAPI) {
  /**
   * Constructor for the VIIS configuration node
   * @param {ViisConfigNodeDef} config - Configuration settings for this node
   */
  function ViisConfigNode(this: ViisConfigNode, config: ViisConfigNodeDef) {
    RED.nodes.createNode(this, config);

    // Auto-load credentials from global context → process.env → UI config
    const credentials = loadDeviceCredentials(
      this.context(),
      config.device?.id,
      config.device?.accessToken
    );

    this.device = {
      id: credentials.deviceId,
      accessToken: credentials.accessToken
    };

    // Log loading source for debugging
    if (config.device?.id && config.device.id.trim() !== '') {
      this.log(`Device ID loaded from UI config: ${credentials.deviceId}`);
    } else if (credentials.deviceId) {
      this.log(`Device ID auto-loaded from environment: ${credentials.deviceId}`);
    }





    // IMPORTANT: This config node only stores device credentials
    // All MQTT connections are managed by ClientRegistry in vietplants-rpc-control/viis-rpc-control nodes
    this.log(`Device ${this.device.id} credentials loaded (MQTT managed by ClientRegistry)`);
  }

  RED.nodes.registerType("viis-config-node", ViisConfigNode);
};

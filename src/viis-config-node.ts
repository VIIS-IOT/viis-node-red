import { NodeAPI, NodeDef, Node } from "node-red";
import mqtt, { MqttClient } from "mqtt";
import { v4 } from "uuid";
import { mqttServerUrl } from "./const";

export interface Device {
  id: string;
  accessToken: string;
  clientMQtt?: MqttClient;
}

interface ViisConfigNodeDef extends NodeDef {
  device: Device;
}

export interface ViisConfigNode extends Node {
  device: Device;
}

const parseMesssageIgnoreError = (msg: string) => {
  try {
    return JSON.parse(msg);
  } catch (error) {
    return null;
  }
};

module.exports = function (RED: NodeAPI) {
  function ViisConfigNode(this: ViisConfigNode, config: ViisConfigNodeDef) {
    RED.nodes.createNode(this, config);
    this.device = config.device || { id: "", accessToken: "" };
    const node = this;

    const connectMQTT = () => {
      if (!this.device.clientMQtt || !this.device.clientMQtt.connected) {
        const mqttOptions = {
          host: mqttServerUrl,
          port: 1883,
          username: this.device.accessToken,
          clientId: `node-red-${v4()}`,
          keepalive: 15,
          clean: true,
        };

        this.device.clientMQtt = mqtt.connect(mqttOptions);

        this.device.clientMQtt.on("connect", () => {
          this.log(`Device ${this.device.id} connected to MQTT`);
          node.emit("mqtt-status", { status: "connected" });
          this.device.clientMQtt?.subscribe(
            "v1/devices/me/rpc/request/+",
            (err) => {
              if (err) {
                this.log(
                  `Device ${this.device.id} connected to MQTT, but can not subscribe, Err: ${err}`
                );
              }
            }
          );
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
    RED.nodes.eachNode((node: any) => {
      if (node.type === "viis-automation-node" && node.configNode === this.id) {
        isDeviceUsed = true;
      }
    });

    if (isDeviceUsed) {
      connectMQTT();
    } else {
      disconnectMQTT();
    }
    this.on("close", () => {
      disconnectMQTT();
    });
  }

  RED.nodes.registerType("viis-config-node", ViisConfigNode);
};

import { NodeAPI, NodeDef, Node } from "node-red";
import { sendTelemetryByHttp } from "./core/device";
import dayjs from "dayjs";

interface MyNodeDef extends NodeDef {
  configNode: string;
  protocol: "MQTT" | "HTTP";
  enableBackup: boolean;
  backupLimit: number;
}

module.exports = function (RED: NodeAPI) {
  function ViisUploadTelemetry(this: Node, config: MyNodeDef) {
    RED.nodes.createNode(this, config);

    const node = this;
    const configNode = RED.nodes.getNode(config.configNode) as any;

    if (!configNode) {
      node.error("Configuration node not found");
      return;
    }

    // Lấy thông tin thiết bị được chọn
    const selectedDevice = configNode.device;

    node.on("input", async function (msg: any) {
      if (!selectedDevice) {
        node.error("Device not found");
        msg.payload = "Device not found";
        node.send(msg);
        return;
      }

      if (config.protocol === "MQTT") {
        if (
          configNode.device.clientMQtt &&
          configNode.device.clientMQtt.connected
        ) {
          configNode.device.clientMQtt.publish(
            "v1/devices/me/telemetry",
            JSON.stringify(msg.payload)
          );

          node.send({
            payload: {
              ts: dayjs().valueOf(),
              data: msg.payload,
              success: true,
            },
          });
        } else if (config.enableBackup) {
          node.warn("MQTT disconnected. Storing message for backup.");
          node.send({
            payload: {
              ts: dayjs().valueOf(),
              data: msg.payload,
              success: false,
            },
          });
          // Backup logic here (store in a queue or database)
        } else {
          node.warn("MQTT disconnected");
          node.send({
            payload: {
              ts: dayjs().valueOf(),
              data: msg.payload,
              success: false,
            },
          });
        }
      } else if (config.protocol === "HTTP") {
        const status = await sendTelemetryByHttp(
          configNode.device.accessToken,
          msg.payload
        );
        if (status) {
          node.send({
            payload: {
              ts: dayjs().valueOf(),
              data: msg.payload,
              success: true,
            },
          });
        } else {
          if (config.enableBackup) {
            node.warn("HTTP upload error. Storing message for backup.");
            node.send({
              payload: {
                ts: dayjs().valueOf(),
                data: msg.payload,
                success: false,
              },
            });
          } else {
            node.warn("HTTP upload error.");
            node.send({
              payload: {
                ts: dayjs().valueOf(),
                data: msg.payload,
                success: false,
              },
            });
          }
        }
      }
    });

    configNode.on("mqtt-status", (data: { status: string; error?: string }) => {
      if (data.status === "connected") {
        node.status({ fill: "green", shape: "dot", text: "Connected" });
      } else if (data.status === "disconnected") {
        node.status({ fill: "red", shape: "ring", text: "Disconnected" });
      } else if (data.status === "error") {
        node.status({
          fill: "yellow",
          shape: "ring",
          text: `Error: ${data.error}`,
        });
      }
    });

    configNode.on("mqtt-message", (data: { message: any }) => {
      node.send({
        payload: {
          message: data.message,
        },
      });
    });
  }

  RED.nodes.registerType("viis-upload-telemetry", ViisUploadTelemetry); // Đổi tên ở đây
};

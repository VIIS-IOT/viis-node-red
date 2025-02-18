import { NodeAPI, NodeDef, Node } from "node-red";

interface MyNodeDef extends NodeDef {
  configNode: string;
}

module.exports = function (RED: NodeAPI) {
  function ViisDeviceEventNode(this: Node, config: MyNodeDef) {
    RED.nodes.createNode(this, config);

    const node = this;
    const configNode = RED.nodes.getNode(config.configNode) as any;

    if (!configNode) {
      node.error("Configuration node not found");
      return;
    }

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

  RED.nodes.registerType("viis-device-events", ViisDeviceEventNode);
};

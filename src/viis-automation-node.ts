import { NodeAPI, NodeDef, Node } from "node-red";

interface MyNodeDef extends NodeDef {
  configNode: string;
}

module.exports = function (RED: NodeAPI) {
  function ViisAutomationNode(this: Node, config: MyNodeDef) {
    RED.nodes.createNode(this, config);

    const node = this;
    const configNode = RED.nodes.getNode(config.configNode) as any;

    if (!configNode) {
      node.error("Configuration node not found");
      return;
    }

    // Lấy thông tin thiết bị được chọn
    const selectedDevice = configNode.device;

    node.on("input", function (msg: any) {
      if (selectedDevice) {
        // Sử dụng accessToken và thông tin thiết bị
        msg.payload = {
          message: `Hello, ${selectedDevice.name}!`,
          accessToken: selectedDevice.accessToken,
        };
      } else {
        msg.payload = "Device not found";
      }
      node.send(msg);
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

  RED.nodes.registerType("viis-automation-node", ViisAutomationNode); // Đổi tên ở đây
};

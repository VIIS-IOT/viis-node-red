import { NodeAPI, NodeDef, Node } from "node-red";
import { DeviceIntent, DeviceLatestData } from "./core/type";
import { getDeviceIntentsByToken } from "./core/device";
import { DeviceIntentService } from "./core/deviceIntents";

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

    async function processIntents(
      intents: DeviceIntent[],
      devicesData: DeviceLatestData[]
    ) {
      try {
        const intentService = new DeviceIntentService(
          intents as DeviceIntent[],
          devicesData
        );
        node.status({
          fill: "blue",
          shape: "dot",
          text: `Processing intents`,
        });
        const results: any = await intentService.processDeviceIntents();
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
      } catch (error) {
        console.log(`Error process intents ${error}`);
        node.status({
          fill: "yellow",
          shape: "ring",
          text: `Error process: ${error}`,
        });
      }
    }

    node.on("input", function (msg: any) {
      let intents = node.context().get("intents");
      const manualIntents: DeviceIntent[] = msg.payload?.intents || [];
      if (manualIntents.length) {
        intents = manualIntents;
      }
      const devicesData = msg.payload?.devices_data || [];
      processIntents(intents as DeviceIntent[], devicesData);
    });

    async function getMyIntents() {
      try {
        const intents = await getDeviceIntentsByToken(
          selectedDevice.accessToken
        );
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
      } catch (error) {
        console.log(`Error lading intents of ${selectedDevice.id}`);
        node.status({
          fill: "yellow",
          shape: "ring",
          text: `Error: ${error}`,
        });
      }
    }

    configNode.on("mqtt-status", (data: { status: string; error?: string }) => {
      if (data.status === "connected") {
        node.status({ fill: "green", shape: "dot", text: "Connected" });
        getMyIntents();
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
      if (data.message.method === "update_intents") {
        getMyIntents();
      }
    });
  }

  RED.nodes.registerType("viis-automation-node", ViisAutomationNode); // Đổi tên ở đây
};

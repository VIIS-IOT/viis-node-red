import { NodeAPI, NodeDef, Node } from "node-red";
import { sendTelemetryByHttp } from "./core/device";
import ClientRegistry from "./core/client-registry";
import { MqttConfig } from "./core/mqtt-client";
import { GlobalContextHelper } from "./ultils/global-context-helper";
import dayjs from "dayjs";

interface MyNodeDef extends NodeDef {
  configNode: string;
  protocol: "MQTT" | "HTTP";
  mode: "publish" | "subscribe";
  topic: string;
  enableBackup: boolean;
  backupLimit: number;
}

const MQTT_CONFIG = {
  THINGSBOARD: {
    DEFAULT_HOST: "mqtt.viis.tech",
    DEFAULT_PORT: "1883",
    QOS: 1 as 0 | 1 | 2,
    PUBLISH_TOPIC: "v1/devices/me/telemetry",
    SUBSCRIBE_TOPIC: "v1/devices/me/rpc/request/+"
  },
  INIT_TIMEOUT_MS: 30000,
  POLL_INTERVAL_MS: 100,
};

/**
 * Match MQTT topic with wildcard support (+ and #)
 * + matches exactly one level
 * # matches zero or more levels (must be last)
 */
function matchTopic(pattern: string, topic: string): boolean {
  const patternParts = pattern.split('/');
  const topicParts = topic.split('/');

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === '#') {
      return true;
    }
    if (i >= topicParts.length) {
      return false;
    }
    if (patternParts[i] !== '+' && patternParts[i] !== topicParts[i]) {
      return false;
    }
  }

  return patternParts.length === topicParts.length;
}

module.exports = function (RED: NodeAPI) {
  function ViisMqttClient(this: Node, config: MyNodeDef) {
    RED.nodes.createNode(this, config);

    const node = this;
    const configNode = RED.nodes.getNode(config.configNode) as any;
    const globalHelper = new GlobalContextHelper(node.context());

    if (!configNode) {
      node.error("Configuration node not found");
      node.status({ fill: "red", shape: "ring", text: "No config node" });
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

    node.log(`Using device: ${selectedDevice.id} for telemetry ${config.mode}`);

    // Determine topic based on mode and configuration
    let topic: string;
    if (config.mode === "publish") {
      topic = config.topic || MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC;
    } else {
      topic = config.topic || MQTT_CONFIG.THINGSBOARD.SUBSCRIBE_TOPIC;
    }

    // MQTT state
    let mqttClient: any = null;
    let mqttReady = false;
    let isSubscribed = false;
    let statusHandler: ((data: any) => void) | null = null;
    let messageHandlerInterval: NodeJS.Timeout | null = null;
    const pendingMessages: any[] = [];

    if (config.protocol === "MQTT") {
      const mqttConfig: MqttConfig = {
        broker: `mqtt://${globalHelper.getEnvVar('THINGSBOARD_HOST', MQTT_CONFIG.THINGSBOARD.DEFAULT_HOST)}:${globalHelper.getEnvVar('THINGSBOARD_PORT', MQTT_CONFIG.THINGSBOARD.DEFAULT_PORT)}`,
        clientId: `node-red-upload-${config.mode}-${Math.random().toString(16).substring(2, 10)}`,
        username: selectedDevice.accessToken,
        password: "",
        qos: MQTT_CONFIG.THINGSBOARD.QOS,
      };

      // Initialize MQTT client
      (async () => {
        try {
          mqttClient = await ClientRegistry.getThingsboardMqttClient(mqttConfig, node);

          // Register status listener on mqttClient (not configNode)
          statusHandler = (data: { status: string; error?: string }) => {
            if (data.status === "connected") {
              node.status({ fill: "green", shape: "dot", text: "Connected" });
            } else if (data.status === "disconnected") {
              node.status({ fill: "red", shape: "ring", text: "Disconnected" });
            } else if (data.status === "error") {
              node.status({ fill: "yellow", shape: "ring", text: `Error: ${data.error}` });
            }
          };
          mqttClient.on("mqtt-status", statusHandler);

          if (config.mode === "subscribe") {
            // Register message handler BEFORE subscribing
            const handleMessage = (event: any) => {
              try {
                const msgTopic = event?.message?.topic ?? event?.topic;
                const rawMessage = event?.message?.message ?? event?.message;

                if (!msgTopic) return;

                // Check if message matches this node's topic
                if (matchTopic(topic, msgTopic)) {
                  let payload: any;

                  if (typeof rawMessage === 'string') {
                    try {
                      payload = JSON.parse(rawMessage);
                    } catch {
                      payload = rawMessage;
                    }
                  } else if (rawMessage?.message) {
                    payload = rawMessage.message;
                  } else {
                    payload = rawMessage;
                  }

                  const outputMsg: any = {
                    topic: msgTopic,
                    payload: payload,
                  };
                  outputMsg.receivedAt = dayjs().valueOf();
                  node.send(outputMsg);
                }
              } catch (error) {
                node.error(`Error handling MQTT message: ${(error as Error).message}`);
              }
            };

            mqttClient.on("mqtt-message", handleMessage);

            await mqttClient.subscribe(topic);
            isSubscribed = true;
            node.log(`Subscribed to topic: ${topic}`);
            node.status({ fill: "green", shape: "dot", text: "Subscribed" });
          } else {
            node.status({ fill: "green", shape: "dot", text: "Ready" });
          }

          // Mark ready and flush pending messages
          mqttReady = true;
          while (pendingMessages.length > 0) {
            const queuedMsg = pendingMessages.shift();
            try {
              const publishTopic = config.topic || MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC;
              await mqttClient.publish(publishTopic, JSON.stringify(queuedMsg.payload));
              node.send({
                payload: {
                  ts: dayjs().valueOf(),
                  data: queuedMsg.payload,
                  topic: publishTopic,
                  success: true,
                },
              });
            } catch (err) {
              node.error(`Failed to publish queued message: ${(err as Error).message}`);
              node.send({
                payload: {
                  ts: dayjs().valueOf(),
                  data: queuedMsg.payload,
                  success: false,
                  error: `Failed to publish queued message: ${(err as Error).message}`,
                },
              });
            }
          }
        } catch (error) {
          const errorMsg = `MQTT initialization failed: ${(error as Error).message}`;
          node.error(errorMsg);
          node.status({ fill: "red", shape: "ring", text: "MQTT failed" });

          // Reject all pending messages
          while (pendingMessages.length > 0) {
            const queuedMsg = pendingMessages.shift();
            node.send({
              payload: {
                ts: dayjs().valueOf(),
                data: queuedMsg.payload,
                success: false,
                error: errorMsg,
              },
            });
          }
        }
      })();
    }

    // Handle input messages
    node.on("input", async function (msg: any) {
      if (config.protocol === "MQTT") {
        if (!mqttReady || !mqttClient) {
          // Queue message while MQTT is initializing
          node.warn("MQTT client not ready, queuing message");
          pendingMessages.push(msg);
          return;
        }

        try {
          const publishTopic = config.topic || MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC;
          await mqttClient.publish(publishTopic, JSON.stringify(msg.payload));

          node.send({
            payload: {
              ts: dayjs().valueOf(),
              data: msg.payload,
              topic: publishTopic,
              success: true,
            },
          });
        } catch (error) {
          const errorMsg = `MQTT publish failed: ${(error as Error).message}`;
          node.error(errorMsg);

          if (config.enableBackup) {
            const backupKey = `backup_${Date.now()}`;
            node.context().set(backupKey, {
              ts: dayjs().valueOf(),
              data: msg.payload,
              topic: config.topic || MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC,
            });
            node.warn(`Message backed up to context: ${backupKey}`);
          }

          node.send({
            payload: {
              ts: dayjs().valueOf(),
              data: msg.payload,
              success: false,
              error: errorMsg,
              backedUp: config.enableBackup,
            },
          });
        }
      } else if (config.protocol === "HTTP") {
        const status = await sendTelemetryByHttp(
          selectedDevice.accessToken,
          msg.payload,
          node.context()
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
          const errorMsg = "HTTP upload error";

          if (config.enableBackup) {
            const backupKey = `backup_${Date.now()}`;
            node.context().set(backupKey, {
              ts: dayjs().valueOf(),
              data: msg.payload,
            });
            node.warn(`Message backed up to context: ${backupKey}`);
          }

          node.send({
            payload: {
              ts: dayjs().valueOf(),
              data: msg.payload,
              success: false,
              error: errorMsg,
              backedUp: config.enableBackup,
            },
          });
        }
      }
    });

    // Cleanup on node close
    node.on("close", async (done: () => void) => {
      try {
        // Remove status handler from mqttClient
        if (statusHandler && mqttClient) {
          mqttClient.removeListener("mqtt-status", statusHandler);
          statusHandler = null;
        }

        // Clear any pending poll interval (safety)
        if (messageHandlerInterval) {
          clearInterval(messageHandlerInterval);
          messageHandlerInterval = null;
        }

        if (mqttClient && isSubscribed) {
          try {
            await mqttClient.unsubscribe(topic);
            node.log(`Unsubscribed from topic: ${topic}`);
          } catch (error) {
            node.warn(`Failed to unsubscribe from ${topic}: ${(error as Error).message}`);
          }

          ClientRegistry.releaseClient("thingsboard", node);
        }
      } catch (error) {
        node.error(`Cleanup error: ${(error as Error).message}`);
      } finally {
        done();
      }
    });
  }

  RED.nodes.registerType("viis-mqtt-client", ViisMqttClient);
};

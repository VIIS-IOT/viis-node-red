import { NodeAPI, NodeDef, Node } from "node-red";
import { sendTelemetryByHttp } from "./core/device";
import ClientRegistry from "./core/client-registry";
import { MqttConfig } from "./core/mqtt-client";
import { GlobalContextHelper } from "./ultils/global-context-helper";
import { matchTopic, MAX_PENDING_MESSAGES } from "./core/mqtt-topic-matcher";
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
  CREDENTIAL_RETRY_INTERVAL_MS: 2000,
  CREDENTIAL_MAX_RETRIES: 30,
};

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

    // MQTT state (shared across initializeMqtt and input/close handlers)
    let mqttClient: any = null;
    let mqttReady = false;
    let isSubscribed = false;
    let statusHandler: ((data: any) => void) | null = null;
    let messageHandler: ((event: any) => void) | null = null;
    const pendingMessages: any[] = [];
    const backupLimit = config.backupLimit;

    // Determine topic based on mode and configuration
    const topic = config.mode === "publish"
      ? (config.topic || MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC)
      : (config.topic || MQTT_CONFIG.THINGSBOARD.SUBSCRIBE_TOPIC);

    /**
     * Initialize MQTT connection with the given device credentials.
     * Called either immediately or after credentials become available.
     */
    function initializeMqtt(device: any) {
      node.log(`Using device: ${device.id} for telemetry ${config.mode}`);

      if (config.protocol === "MQTT") {
        const mqttConfig: MqttConfig = {
          broker: `mqtt://${globalHelper.getEnvVar('THINGSBOARD_HOST', MQTT_CONFIG.THINGSBOARD.DEFAULT_HOST)}:${globalHelper.getEnvVar('THINGSBOARD_PORT', MQTT_CONFIG.THINGSBOARD.DEFAULT_PORT)}`,
          clientId: `node-red-upload-${config.mode}-${Math.random().toString(16).substring(2, 10)}`,
          username: device.accessToken,
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

              messageHandler = handleMessage;
              mqttClient.on("mqtt-message", messageHandler);

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
    }

    // === CREDENTIAL LOADING WITH RETRY ===
    let selectedDevice = configNode.device;
    const hasCredentials = () => selectedDevice && selectedDevice.id && selectedDevice.accessToken;

    if (hasCredentials()) {
      // Credentials already loaded, proceed immediately
      initializeMqtt(selectedDevice);
    } else {
      // Credentials not loaded yet (env-loader may still be loading)
      // Start retry mechanism
      node.status({ fill: "yellow", shape: "ring", text: "Waiting for credentials..." });
      node.log("Credentials not loaded yet, waiting for env-loader...");

      let credentialRetries = 0;
      const retryInterval = setInterval(() => {
        credentialRetries++;
        selectedDevice = configNode.device;

        if (hasCredentials()) {
          clearInterval(retryInterval);
          node.log(`Credentials loaded after ${credentialRetries} retries`);
          initializeMqtt(selectedDevice);
        } else if (credentialRetries >= MQTT_CONFIG.CREDENTIAL_MAX_RETRIES) {
          clearInterval(retryInterval);
          node.error("Device credentials not found after waiting. Configure viis-config-node or set device_id/device_access_token in env-loader");
          node.status({ fill: "red", shape: "ring", text: "No credentials" });
        } else {
          node.status({ fill: "yellow", shape: "ring", text: `Waiting for credentials (${credentialRetries}/${MQTT_CONFIG.CREDENTIAL_MAX_RETRIES})` });
        }
      }, MQTT_CONFIG.CREDENTIAL_RETRY_INTERVAL_MS);
    }

    // Prune oldest backups when limit is exceeded
    function pruneBackups(): void {
      if (backupLimit < 0) return; // unlimited
      const keys = node.context().keys().filter((k: string) => k.startsWith('backup_')).sort();
      while (keys.length >= backupLimit) {
        const oldestKey = keys.shift()!;
        node.context().set(oldestKey, undefined);
      }
    }

    // Handle input messages
    node.on("input", async function (msg: any) {
      if (config.protocol === "MQTT") {
        if (!mqttReady || !mqttClient) {
          // Queue message while MQTT is initializing
          node.warn("MQTT client not ready, queuing message");
          if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
            pendingMessages.shift();
            node.warn("Pending message queue full, dropping oldest message");
          }
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
            pruneBackups();
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
        if (!selectedDevice) {
          node.warn("Device not available yet");
          return;
        }

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
            pruneBackups();
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
        // Remove event listeners from mqttClient
        if (statusHandler && mqttClient) {
          mqttClient.removeListener("mqtt-status", statusHandler);
          statusHandler = null;
        }
        if (messageHandler && mqttClient) {
          mqttClient.removeListener("mqtt-message", messageHandler);
          messageHandler = null;
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

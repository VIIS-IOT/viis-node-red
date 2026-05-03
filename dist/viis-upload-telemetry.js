"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const device_1 = require("./core/device");
const client_registry_1 = __importDefault(require("./core/client-registry"));
const global_context_helper_1 = require("./ultils/global-context-helper");
const dayjs_1 = __importDefault(require("dayjs"));
const MQTT_CONFIG = {
    THINGSBOARD: {
        DEFAULT_HOST: "mqtt.viis.tech",
        DEFAULT_PORT: "1883",
        QOS: 1,
        PUBLISH_TOPIC: "v1/devices/me/telemetry",
        SUBSCRIBE_TOPIC: "v1/devices/me/rpc/request/+"
    }
};
module.exports = function (RED) {
    function ViisUploadTelemetry(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNode = RED.nodes.getNode(config.configNode);
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
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
        let topic;
        if (config.mode === "publish") {
            topic = config.topic || MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC;
        }
        else {
            topic = config.topic || MQTT_CONFIG.THINGSBOARD.SUBSCRIBE_TOPIC;
        }
        // Initialize MQTT client if protocol is MQTT
        let mqttClient = null;
        let isSubscribed = false;
        if (config.protocol === "MQTT") {
            const mqttConfig = {
                broker: `mqtt://${globalHelper.getEnvVar('THINGSBOARD_HOST', MQTT_CONFIG.THINGSBOARD.DEFAULT_HOST)}:${globalHelper.getEnvVar('THINGSBOARD_PORT', MQTT_CONFIG.THINGSBOARD.DEFAULT_PORT)}`,
                clientId: `node-red-upload-${config.mode}-${Math.random().toString(16).substring(2, 10)}`,
                username: selectedDevice.accessToken,
                password: "",
                qos: MQTT_CONFIG.THINGSBOARD.QOS,
            };
            // Initialize MQTT client
            (async () => {
                try {
                    mqttClient = await client_registry_1.default.getThingsboardMqttClient(mqttConfig, node);
                    if (config.mode === "subscribe") {
                        // Subscribe to topic
                        await mqttClient.subscribe(topic);
                        isSubscribed = true;
                        node.log(`Subscribed to topic: ${topic}`);
                        node.status({ fill: "green", shape: "dot", text: "Subscribed" });
                    }
                    else {
                        node.status({ fill: "green", shape: "dot", text: "Ready" });
                    }
                }
                catch (error) {
                    const errorMsg = `MQTT initialization failed: ${error.message}`;
                    node.error(errorMsg);
                    node.status({ fill: "red", shape: "ring", text: "MQTT failed" });
                }
            })();
            // Handle incoming MQTT messages (for subscribe mode)
            if (config.mode === "subscribe") {
                const handleMessage = (event) => {
                    try {
                        const { topic: msgTopic, message } = event.message || event;
                        // Check if message is for this node's topic
                        if (msgTopic === topic || msgTopic.startsWith(topic.replace('+', '').replace('#', ''))) {
                            let payload;
                            // Parse message
                            if (typeof message === 'string') {
                                try {
                                    payload = JSON.parse(message);
                                }
                                catch (_a) {
                                    payload = message;
                                }
                            }
                            else if (message.message) {
                                payload = message.message;
                            }
                            else {
                                payload = message;
                            }
                            // Send output message
                            const outputMsg = {
                                topic: msgTopic,
                                payload: payload
                            };
                            outputMsg.receivedAt = (0, dayjs_1.default)().valueOf();
                            node.send(outputMsg);
                        }
                    }
                    catch (error) {
                        node.error(`Error handling MQTT message: ${error.message}`);
                    }
                };
                // Register message handler immediately
                // The handler will be called when messages arrive after subscription
                const checkClient = setInterval(() => {
                    if (mqttClient) {
                        mqttClient.on("mqtt-message", handleMessage);
                        clearInterval(checkClient);
                    }
                }, 100);
            }
        }
        // Handle input messages (for publish mode)
        node.on("input", async function (msg) {
            if (!selectedDevice) {
                node.error("Device not found");
                msg.payload = "Device not found";
                node.send(msg);
                return;
            }
            if (config.protocol === "MQTT") {
                if (!mqttClient) {
                    node.warn("MQTT client not initialized yet");
                    return;
                }
                try {
                    const publishTopic = config.topic || MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC;
                    await mqttClient.publish(publishTopic, JSON.stringify(msg.payload));
                    node.send({
                        payload: {
                            ts: (0, dayjs_1.default)().valueOf(),
                            data: msg.payload,
                            topic: publishTopic,
                            success: true,
                        },
                    });
                }
                catch (error) {
                    const errorMsg = `MQTT publish failed: ${error.message}`;
                    node.error(errorMsg);
                    if (config.enableBackup) {
                        node.warn("MQTT disconnected. Storing message for backup.");
                        node.send({
                            payload: {
                                ts: (0, dayjs_1.default)().valueOf(),
                                data: msg.payload,
                                success: false,
                                error: errorMsg,
                            },
                        });
                    }
                    else {
                        node.send({
                            payload: {
                                ts: (0, dayjs_1.default)().valueOf(),
                                data: msg.payload,
                                success: false,
                                error: errorMsg,
                            },
                        });
                    }
                }
            }
            else if (config.protocol === "HTTP") {
                const status = await (0, device_1.sendTelemetryByHttp)(selectedDevice.accessToken, msg.payload, node.context());
                if (status) {
                    node.send({
                        payload: {
                            ts: (0, dayjs_1.default)().valueOf(),
                            data: msg.payload,
                            success: true,
                        },
                    });
                }
                else {
                    const errorMsg = "HTTP upload error";
                    if (config.enableBackup) {
                        node.warn(`${errorMsg}. Storing message for backup.`);
                        node.send({
                            payload: {
                                ts: (0, dayjs_1.default)().valueOf(),
                                data: msg.payload,
                                success: false,
                                error: errorMsg,
                            },
                        });
                    }
                    else {
                        node.warn(errorMsg);
                        node.send({
                            payload: {
                                ts: (0, dayjs_1.default)().valueOf(),
                                data: msg.payload,
                                success: false,
                                error: errorMsg,
                            },
                        });
                    }
                }
            }
        });
        // Handle connection status changes
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
        // Cleanup on node close
        node.on("close", async (done) => {
            try {
                if (mqttClient && isSubscribed) {
                    // Unsubscribe from topic before releasing
                    try {
                        await mqttClient.unsubscribe(topic);
                        node.log(`Unsubscribed from topic: ${topic}`);
                    }
                    catch (error) {
                        node.warn(`Failed to unsubscribe from ${topic}: ${error.message}`);
                    }
                    // Release the client
                    client_registry_1.default.releaseClient("thingsboard", node);
                }
            }
            catch (error) {
                node.error(`Cleanup error: ${error.message}`);
            }
            finally {
                done();
            }
        });
    }
    RED.nodes.registerType("viis-upload-telemetry", ViisUploadTelemetry);
};

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const device_1 = require("./core/device");
const client_registry_1 = __importDefault(require("./core/client-registry"));
const global_context_helper_1 = require("./ultils/global-context-helper");
const mqtt_topic_matcher_1 = require("./core/mqtt-topic-matcher");
const demeter_mqtt_topics_1 = require("./core/demeter-mqtt-topics");
const dayjs_1 = __importDefault(require("dayjs"));
const MQTT_CONFIG = {
    THINGSBOARD: {
        DEFAULT_HOST: demeter_mqtt_topics_1.DEFAULT_MQTT_HOST,
        DEFAULT_PORT: demeter_mqtt_topics_1.DEFAULT_MQTT_PORT,
        QOS: 1,
    },
    INIT_TIMEOUT_MS: 30000,
    POLL_INTERVAL_MS: 100,
    CREDENTIAL_RETRY_INTERVAL_MS: 2000,
    CREDENTIAL_MAX_RETRIES: 30,
};
module.exports = function (RED) {
    function ViisMqttClient(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNode = RED.nodes.getNode(config.configNode);
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        if (!configNode) {
            node.error("Configuration node not found");
            node.status({ fill: "red", shape: "ring", text: "No config node" });
            return;
        }
        // MQTT state (shared across initializeMqtt and input/close handlers)
        let mqttClient = null;
        let mqttReady = false;
        let isSubscribed = false;
        let topic = "";
        let statusHandler = null;
        let messageHandler = null;
        const pendingMessages = [];
        const backupLimit = config.backupLimit;
        // Determine topic based on mode and configuration
        const resolveDefaultTopic = (deviceId) => config.mode === "publish"
            ? (config.topic || (0, demeter_mqtt_topics_1.buildDeviceTelemetryTopic)(deviceId))
            : (config.topic || (0, demeter_mqtt_topics_1.buildDeviceRpcSubscribeTopic)(deviceId));
        /**
         * Initialize MQTT connection with the given device credentials.
         * Called either immediately or after credentials become available.
         */
        function initializeMqtt(device) {
            node.log(`Using device: ${device.id} for telemetry ${config.mode}`);
            if (config.protocol === "MQTT") {
                topic = resolveDefaultTopic(device.id);
                const mqttConfig = {
                    broker: `mqtt://${globalHelper.getEnvVar('THINGSBOARD_HOST', MQTT_CONFIG.THINGSBOARD.DEFAULT_HOST)}:${globalHelper.getEnvVar('THINGSBOARD_PORT', MQTT_CONFIG.THINGSBOARD.DEFAULT_PORT)}`,
                    deviceId: device.id,
                    clientId: `node-red-upload-${config.mode}-${Math.random().toString(16).substring(2, 10)}`,
                    username: device.accessToken,
                    password: "",
                    qos: MQTT_CONFIG.THINGSBOARD.QOS,
                };
                // Initialize MQTT client
                (async () => {
                    try {
                        mqttClient = await client_registry_1.default.getThingsboardMqttClient(mqttConfig, node);
                        // Register status listener on mqttClient (not configNode)
                        statusHandler = (data) => {
                            if (data.status === "connected") {
                                node.status({ fill: "green", shape: "dot", text: "Connected" });
                            }
                            else if (data.status === "disconnected") {
                                node.status({ fill: "red", shape: "ring", text: "Disconnected" });
                            }
                            else if (data.status === "error") {
                                node.status({ fill: "yellow", shape: "ring", text: `Error: ${data.error}` });
                            }
                        };
                        mqttClient.on("mqtt-status", statusHandler);
                        if (config.mode === "subscribe") {
                            // Register message handler BEFORE subscribing
                            const handleMessage = (event) => {
                                var _a, _b, _c, _d;
                                try {
                                    const msgTopic = (_b = (_a = event === null || event === void 0 ? void 0 : event.message) === null || _a === void 0 ? void 0 : _a.topic) !== null && _b !== void 0 ? _b : event === null || event === void 0 ? void 0 : event.topic;
                                    const rawMessage = (_d = (_c = event === null || event === void 0 ? void 0 : event.message) === null || _c === void 0 ? void 0 : _c.message) !== null && _d !== void 0 ? _d : event === null || event === void 0 ? void 0 : event.message;
                                    if (!msgTopic)
                                        return;
                                    // Check if message matches this node's topic
                                    if ((0, mqtt_topic_matcher_1.matchTopic)(topic, msgTopic)) {
                                        let payload;
                                        if (typeof rawMessage === 'string') {
                                            try {
                                                payload = JSON.parse(rawMessage);
                                            }
                                            catch (_e) {
                                                payload = rawMessage;
                                            }
                                        }
                                        else if (rawMessage === null || rawMessage === void 0 ? void 0 : rawMessage.message) {
                                            payload = rawMessage.message;
                                        }
                                        else {
                                            payload = rawMessage;
                                        }
                                        const outputMsg = {
                                            topic: msgTopic,
                                            payload: payload,
                                        };
                                        outputMsg.receivedAt = (0, dayjs_1.default)().valueOf();
                                        node.send(outputMsg);
                                    }
                                }
                                catch (error) {
                                    node.error(`Error handling MQTT message: ${error.message}`);
                                }
                            };
                            messageHandler = handleMessage;
                            mqttClient.on("mqtt-message", messageHandler);
                            await mqttClient.subscribe(topic);
                            isSubscribed = true;
                            node.log(`Subscribed to topic: ${topic}`);
                            node.status({ fill: "green", shape: "dot", text: "Subscribed" });
                        }
                        else {
                            node.status({ fill: "green", shape: "dot", text: "Ready" });
                        }
                        // Mark ready and flush pending messages
                        mqttReady = true;
                        while (pendingMessages.length > 0) {
                            const queuedMsg = pendingMessages.shift();
                            try {
                                const publishTopic = config.topic || (0, demeter_mqtt_topics_1.buildDeviceTelemetryTopic)(device.id);
                                await mqttClient.publish(publishTopic, JSON.stringify(queuedMsg.payload));
                                node.send({
                                    payload: {
                                        ts: (0, dayjs_1.default)().valueOf(),
                                        data: queuedMsg.payload,
                                        topic: publishTopic,
                                        success: true,
                                    },
                                });
                            }
                            catch (err) {
                                node.error(`Failed to publish queued message: ${err.message}`);
                                node.send({
                                    payload: {
                                        ts: (0, dayjs_1.default)().valueOf(),
                                        data: queuedMsg.payload,
                                        success: false,
                                        error: `Failed to publish queued message: ${err.message}`,
                                    },
                                });
                            }
                        }
                    }
                    catch (error) {
                        const errorMsg = `MQTT initialization failed: ${error.message}`;
                        node.error(errorMsg);
                        node.status({ fill: "red", shape: "ring", text: "MQTT failed" });
                        // Reject all pending messages
                        while (pendingMessages.length > 0) {
                            const queuedMsg = pendingMessages.shift();
                            node.send({
                                payload: {
                                    ts: (0, dayjs_1.default)().valueOf(),
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
        }
        else {
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
                }
                else if (credentialRetries >= MQTT_CONFIG.CREDENTIAL_MAX_RETRIES) {
                    clearInterval(retryInterval);
                    node.error("Device credentials not found after waiting. Configure viis-config-node or set device_id/device_access_token in env-loader");
                    node.status({ fill: "red", shape: "ring", text: "No credentials" });
                }
                else {
                    node.status({ fill: "yellow", shape: "ring", text: `Waiting for credentials (${credentialRetries}/${MQTT_CONFIG.CREDENTIAL_MAX_RETRIES})` });
                }
            }, MQTT_CONFIG.CREDENTIAL_RETRY_INTERVAL_MS);
        }
        // Prune oldest backups when limit is exceeded
        function pruneBackups() {
            if (backupLimit < 0)
                return; // unlimited
            const keys = node.context().keys().filter((k) => k.startsWith('backup_')).sort();
            while (keys.length >= backupLimit) {
                const oldestKey = keys.shift();
                node.context().set(oldestKey, undefined);
            }
        }
        // Handle input messages
        node.on("input", async function (msg) {
            if (config.protocol === "MQTT") {
                if (!mqttReady || !mqttClient) {
                    // Queue message while MQTT is initializing
                    node.warn("MQTT client not ready, queuing message");
                    if (pendingMessages.length >= mqtt_topic_matcher_1.MAX_PENDING_MESSAGES) {
                        pendingMessages.shift();
                        node.warn("Pending message queue full, dropping oldest message");
                    }
                    pendingMessages.push(msg);
                    return;
                }
                try {
                    const publishTopic = config.topic || (0, demeter_mqtt_topics_1.buildDeviceTelemetryTopic)((selectedDevice === null || selectedDevice === void 0 ? void 0 : selectedDevice.id) || "");
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
                        const backupKey = `backup_${Date.now()}`;
                        pruneBackups();
                        node.context().set(backupKey, {
                            ts: (0, dayjs_1.default)().valueOf(),
                            data: msg.payload,
                            topic: config.topic || (0, demeter_mqtt_topics_1.buildDeviceTelemetryTopic)((selectedDevice === null || selectedDevice === void 0 ? void 0 : selectedDevice.id) || ""),
                        });
                        node.warn(`Message backed up to context: ${backupKey}`);
                    }
                    node.send({
                        payload: {
                            ts: (0, dayjs_1.default)().valueOf(),
                            data: msg.payload,
                            success: false,
                            error: errorMsg,
                            backedUp: config.enableBackup,
                        },
                    });
                }
            }
            else if (config.protocol === "HTTP") {
                if (!selectedDevice) {
                    node.warn("Device not available yet");
                    return;
                }
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
                        const backupKey = `backup_${Date.now()}`;
                        pruneBackups();
                        node.context().set(backupKey, {
                            ts: (0, dayjs_1.default)().valueOf(),
                            data: msg.payload,
                        });
                        node.warn(`Message backed up to context: ${backupKey}`);
                    }
                    node.send({
                        payload: {
                            ts: (0, dayjs_1.default)().valueOf(),
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
        node.on("close", async (done) => {
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
                    }
                    catch (error) {
                        node.warn(`Failed to unsubscribe from ${topic}: ${error.message}`);
                    }
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
    RED.nodes.registerType("viis-mqtt-client", ViisMqttClient);
};

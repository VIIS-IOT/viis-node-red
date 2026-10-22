import { NodeAPI, Node } from "node-red";
import { setupGlobalErrorHandlers } from "../../core/offline-resilience";
import ClientRegistry from "../../core/client-registry";
import { MqttConfig } from "../../core/mqtt-client";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { IntentService } from "./services/intentService";
import { ProcessingService } from "./services/processingService";
import { MqttAutomationService } from "./services/mqttService";
import { MqttInitRetry } from "./services/mqttInitRetry";
import { AutomationHandler } from "./handlers/automationHandler";
import {
    ViisAutomationNodeDef,
    ServiceOptions,
    DeviceCredentials
} from "./interfaces/types";
import { Logger } from "./utils/logger";

// Global flag to ensure error handlers are setup only once
let globalErrorHandlersInitialized = false;

// Environment keys
const ENV_KEYS = {
    DEVICE_ID: "device_id",
    DEVICE_ACCESS_TOKEN: "device_access_token",
    THINGSBOARD_HOST: "thingsboard_mqtt_broker",
    THINGSBOARD_PORT: "thingsboard_mqtt_port"
};

// MQTT config defaults
const MQTT_CONFIG = {
    THINGSBOARD: {
        DEFAULT_HOST: "mqtt.viis.tech",
        DEFAULT_PORT: "1883",
        QOS: 1 as 0 | 1 | 2,
        SUBSCRIBE_TOPIC: "v1/devices/me/rpc/request/+"
    }
};

module.exports = function (RED: NodeAPI) {
    // Setup global error handlers (only once for all nodes)
    if (!globalErrorHandlersInitialized) {
        setupGlobalErrorHandlers(RED);
        globalErrorHandlersInitialized = true;
    }

    function ViisAutomationNode(this: Node, config: ViisAutomationNodeDef) {
        RED.nodes.createNode(this, config);

        const node = this;
        const logger = new Logger(node, "AUTOMATION");

        // Wrap async initialization in IIFE
        (async () => {
            try {
                // Get config node
                const configNode = RED.nodes.getNode(config.configNode) as any;

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

                logger.log(`Initializing automation node for device: ${selectedDevice.id}`);

                // Prepare credentials
                const credentials: DeviceCredentials = {
                    id: selectedDevice.id,
                    accessToken: selectedDevice.accessToken
                };

                // Get contexts
                const flowContext = node.context().flow;
                const globalContext = node.context().global;

                // Initialize GlobalContextHelper
                const globalHelper = new GlobalContextHelper(node.context());

                // Create service options
                const serviceOptions: ServiceOptions = {
                    node,
                    flowContext,
                    globalContext
                };

                // Load device ID from environment
                const deviceId = globalHelper.getEnvVar(ENV_KEYS.DEVICE_ID, credentials.id);

                // Initialize MQTT client configuration (ThingsBoard MQTT)
                const mqttConfig: MqttConfig = {
                    broker: `mqtt://${globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_HOST, MQTT_CONFIG.THINGSBOARD.DEFAULT_HOST)}:${globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_PORT, MQTT_CONFIG.THINGSBOARD.DEFAULT_PORT)}`,
                    clientId: `node-red-automation-${Math.random().toString(16).substring(2, 10)}`,
                    username: credentials.accessToken, // Use device access token
                    password: "",
                    qos: MQTT_CONFIG.THINGSBOARD.QOS,
                    healthCheckInterval: 0 // Disable health check to prevent false positive reconnects
                };

                // Define MQTT topic for intent updates (use wildcard for subscription)
                const subscribeTopic = MQTT_CONFIG.THINGSBOARD.SUBSCRIBE_TOPIC;

                logger.log(`MQTT config: ${mqttConfig.broker}, topic: ${subscribeTopic}`);

                // Initialize services
                const intentService = new IntentService(serviceOptions, credentials);
                const processingService = new ProcessingService(serviceOptions);
                const mqttService = new MqttAutomationService(serviceOptions);

                // Initialize handler
                const automationHandler = new AutomationHandler(
                    serviceOptions,
                    intentService,
                    processingService,
                    mqttService
                );

                // OFFLINE intents run from the local cache, so input must work even while MQTT is down.
                node.on("input", function (msg: any) {
                    automationHandler.handleInput(msg);
                });

                // Initialize ThingsBoard MQTT client + subscription, retrying until the broker is reachable
                let mqttClient: any = null;
                const mqttInit = new MqttInitRetry({
                    attempt: async () => {
                        if (!mqttClient) {
                            logger.log("Initializing ThingsBoard MQTT client from ClientRegistry...");
                            mqttClient = await ClientRegistry.getThingsboardMqttClient(mqttConfig, node);
                            if (!mqttClient) {
                                throw new Error("Failed to get MQTT client from registry");
                            }
                            logger.log("MQTT client initialized successfully");
                        }

                        await mqttService.initialize(
                            mqttClient,
                            subscribeTopic,
                            (message) => {
                                automationHandler.handleMqttMessage(message);
                            }
                        );
                    },
                    onSuccess: () => {
                        logger.log("MQTT service initialized with message handler");
                        node.status({ fill: "green", shape: "dot", text: "Ready" });
                        // Initial sync of intents
                        void automationHandler.syncIntents();
                    },
                    onFailure: (error, retryInMs, attemptNumber) => {
                        logger.error(`Failed to initialize MQTT service (attempt ${attemptNumber}), retry in ${retryInMs / 1000}s: ${error.message}`);
                        node.status({ fill: "red", shape: "ring", text: `MQTT subscription failed, retry in ${retryInMs / 1000}s` });
                    },
                });

                // Cleanup on node close
                node.on("close", (done: () => void) => {
                    try {
                        logger.log("Closing automation node");
                        mqttInit.stop();
                        automationHandler.cleanup();

                        // Release ThingsBoard MQTT client
                        if (mqttClient) {
                            ClientRegistry.releaseClient("thingsboard", node);
                        }

                        done();
                    } catch (error) {
                        logger.error(`Close error: ${(error as Error).message}`);
                        done();
                    }
                });

                mqttInit.start();
                logger.log("Automation node initialized");

            } catch (error) {
                logger.error(`Node initialization failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            logger.error(`Async initialization failed: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
    }

    RED.nodes.registerType("viis-automation-node", ViisAutomationNode);
};

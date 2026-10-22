"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const offline_resilience_1 = require("../../core/offline-resilience");
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const intentService_1 = require("./services/intentService");
const processingService_1 = require("./services/processingService");
const mqttService_1 = require("./services/mqttService");
const mqttInitRetry_1 = require("./services/mqttInitRetry");
const automationHandler_1 = require("./handlers/automationHandler");
const logger_1 = require("./utils/logger");
const scenarioTriggerTracker_1 = require("./services/scenarioTriggerTracker");
const scenarioTriggerEvents_1 = require("./services/scenarioTriggerEvents");
const scenarioTriggerSender_1 = require("./services/scenarioTriggerSender");
const demeter_mqtt_topics_1 = require("../../core/demeter-mqtt-topics");
// Global flag to ensure error handlers are setup only once
let globalErrorHandlersInitialized = false;
// Environment keys
const ENV_KEYS = {
    DEVICE_ID: "DEVICE_ID",
    DEVICE_ACCESS_TOKEN: "DEVICE_ACCESS_TOKEN",
};
const MQTT_CONFIG = {
    THINGSBOARD: {
        QOS: 1,
    }
};
module.exports = function (RED) {
    // Setup global error handlers (only once for all nodes)
    if (!globalErrorHandlersInitialized) {
        (0, offline_resilience_1.setupGlobalErrorHandlers)(RED);
        globalErrorHandlersInitialized = true;
    }
    function ViisAutomationNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const logger = new logger_1.Logger(node, "AUTOMATION");
        // Wrap async initialization in IIFE
        (async () => {
            try {
                // Get config node
                const configNode = RED.nodes.getNode(config.configNode);
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
                const credentials = {
                    id: selectedDevice.id,
                    accessToken: selectedDevice.accessToken
                };
                // Get contexts
                const flowContext = node.context().flow;
                const globalContext = node.context().global;
                // Initialize GlobalContextHelper
                const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
                // Create service options
                const serviceOptions = {
                    node,
                    flowContext,
                    globalContext
                };
                // Load device ID from environment
                const deviceId = globalHelper.getEnvVar(ENV_KEYS.DEVICE_ID, credentials.id);
                // Initialize MQTT client configuration (ThingsBoard MQTT)
                const broker = (0, demeter_mqtt_topics_1.resolveThingsboardMqttBroker)(globalHelper);
                if (!broker) {
                    logger.error("THINGSBOARD_HOST / THINGSBOARD_MQTT_BROKER is not set. Load common.json via env-loader.");
                    node.status({ fill: "red", shape: "ring", text: "Missing MQTT broker env" });
                    return;
                }
                const mqttConfig = {
                    broker,
                    deviceId,
                    clientId: `node-red-automation-${Math.random().toString(16).substring(2, 10)}`,
                    username: credentials.accessToken, // Use device access token
                    password: "",
                    qos: MQTT_CONFIG.THINGSBOARD.QOS,
                    healthCheckInterval: 0 // Disable health check to prevent false positive reconnects
                };
                const subscribeTopic = (0, demeter_mqtt_topics_1.buildDeviceRpcSubscribeTopic)(deviceId);
                logger.log(`MQTT config: ${mqttConfig.broker}, topic: ${subscribeTopic}`);
                // Initialize services
                const intentService = new intentService_1.IntentService(serviceOptions, credentials);
                const processingService = new processingService_1.ProcessingService(serviceOptions);
                const mqttService = new mqttService_1.MqttAutomationService(serviceOptions);
                // Scenario trigger events (ADR-035): rising edges persist in the node context.
                const scenarioTriggers = new scenarioTriggerTracker_1.ScenarioTriggerReporter({
                    deviceId,
                    edges: new scenarioTriggerEvents_1.ScenarioTriggerEdges(node.context()),
                    sink: (0, scenarioTriggerSender_1.createScenarioTriggerSender)(globalHelper, logger),
                    logger,
                });
                // Initialize handler
                const automationHandler = new automationHandler_1.AutomationHandler(serviceOptions, intentService, processingService, mqttService, scenarioTriggers);
                // OFFLINE intents run from the local cache, so input must work even while MQTT is down.
                node.on("input", function (msg) {
                    automationHandler.handleInput(msg);
                });
                // Initialize ThingsBoard MQTT client + subscription, retrying until the broker is reachable
                let mqttClient = null;
                const mqttInit = new mqttInitRetry_1.MqttInitRetry({
                    attempt: async () => {
                        if (!mqttClient) {
                            logger.log("Initializing ThingsBoard MQTT client from ClientRegistry...");
                            mqttClient = await client_registry_1.default.getThingsboardMqttClient(mqttConfig, node);
                            if (!mqttClient) {
                                throw new Error("Failed to get MQTT client from registry");
                            }
                            logger.log("MQTT client initialized successfully");
                        }
                        await mqttService.initialize(mqttClient, subscribeTopic, (message) => {
                            automationHandler.handleMqttMessage(message);
                        });
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
                node.on("close", (done) => {
                    try {
                        logger.log("Closing automation node");
                        mqttInit.stop();
                        automationHandler.cleanup();
                        // Release ThingsBoard MQTT client
                        if (mqttClient) {
                            client_registry_1.default.releaseClient("thingsboard", node);
                        }
                        done();
                    }
                    catch (error) {
                        logger.error(`Close error: ${error.message}`);
                        done();
                    }
                });
                mqttInit.start();
                logger.log("Automation node initialized");
            }
            catch (error) {
                logger.error(`Node initialization failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            logger.error(`Async initialization failed: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
    }
    RED.nodes.registerType("viis-automation-node", ViisAutomationNode);
};

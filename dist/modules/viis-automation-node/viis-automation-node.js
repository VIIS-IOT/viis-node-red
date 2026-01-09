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
const automationHandler_1 = require("./handlers/automationHandler");
const logger_1 = require("./utils/logger");
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
        QOS: 1,
        SUBSCRIBE_TOPIC: "v1/devices/me/rpc/request/+"
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
                const mqttConfig = {
                    broker: `mqtt://${globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_HOST, MQTT_CONFIG.THINGSBOARD.DEFAULT_HOST)}:${globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_PORT, MQTT_CONFIG.THINGSBOARD.DEFAULT_PORT)}`,
                    clientId: `node-red-automation-${Math.random().toString(16).substring(2, 10)}`,
                    username: credentials.accessToken, // Use device access token
                    password: "",
                    qos: MQTT_CONFIG.THINGSBOARD.QOS
                };
                // Define MQTT topic for intent updates (use wildcard for subscription)
                const subscribeTopic = MQTT_CONFIG.THINGSBOARD.SUBSCRIBE_TOPIC;
                logger.log(`MQTT config: ${mqttConfig.broker}, topic: ${subscribeTopic}`);
                // Initialize MQTT client from ClientRegistry (ThingsBoard)
                let mqttClient;
                try {
                    logger.log("Initializing ThingsBoard MQTT client from ClientRegistry...");
                    mqttClient = await client_registry_1.default.getThingsboardMqttClient(mqttConfig, node);
                    if (!mqttClient) {
                        throw new Error("Failed to get MQTT client from registry");
                    }
                    logger.log("MQTT client initialized successfully");
                }
                catch (error) {
                    const errorMsg = `MQTT initialization failed: ${error.message}`;
                    logger.error(errorMsg);
                    node.status({ fill: "red", shape: "ring", text: "MQTT connection failed" });
                    return;
                }
                // Initialize services
                const intentService = new intentService_1.IntentService(serviceOptions, credentials);
                const processingService = new processingService_1.ProcessingService(serviceOptions);
                const mqttService = new mqttService_1.MqttAutomationService(serviceOptions);
                // Initialize handler
                const automationHandler = new automationHandler_1.AutomationHandler(serviceOptions, intentService, processingService, mqttService);
                // Initialize MQTT service with message handler
                try {
                    await mqttService.initialize(mqttClient, subscribeTopic, (message) => {
                        automationHandler.handleMqttMessage(message);
                    });
                    logger.log("MQTT service initialized with message handler");
                    // Initial sync of intents
                    await automationHandler.syncIntents();
                }
                catch (error) {
                    logger.error(`Failed to initialize MQTT service: ${error.message}`);
                    node.status({ fill: "red", shape: "ring", text: "MQTT subscription failed" });
                    return;
                }
                // Handle input messages
                node.on("input", function (msg) {
                    automationHandler.handleInput(msg);
                });
                // Cleanup on node close
                node.on("close", (done) => {
                    try {
                        logger.log("Closing automation node");
                        automationHandler.cleanup();
                        // Release ThingsBoard MQTT client
                        client_registry_1.default.releaseClient("thingsboard", node);
                        done();
                    }
                    catch (error) {
                        logger.error(`Close error: ${error.message}`);
                        done();
                    }
                });
                logger.log("Automation node initialized successfully");
                node.status({ fill: "green", shape: "dot", text: "Ready" });
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

import { NodeAPI, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";
import { MqttConfig, MqttMessage } from "../../core/mqtt-client";
import { LuoiMappingHandler } from "./luoi-mapping-handler";
import {
    ViisRpcControlNodeDef,
    RpcMessage
} from "./interfaces/types";
import { RpcHandler } from "./handlers/rpcHandler";
import { MessageHandler } from "./handlers/messageHandler";
import { ConfigService } from "./services/configService";
import { MqttService } from "./services/mqttService";
import { ModbusService } from "./services/modbusService";
import { ValidationService } from "./services/validationService";
import { Logger } from "./utils/logger";
import { ScalingUtils } from "./utils/scaling";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import {
    MQTT_CONFIG,
    MODBUS_CONFIG,
    ENV_KEYS,
    DEFAULTS,
    ERROR_MESSAGES,
    STATUS_MESSAGES
} from "./constants";



module.exports = function (RED: NodeAPI) {
    function ViisRpcControlNode(this: Node, config: ViisRpcControlNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize logger
        const logger = new Logger(node);

        // Get contexts
        const flowContext = node.context().flow;
        const globalContext = node.context().global;

        // Initialize GlobalContextHelper
        const globalHelper = new GlobalContextHelper(node.context());

        // Create service options
        const serviceOptions = {
            node,
            flowContext,
            globalContext,
        };

        // Wrap async initialization in IIFE
        (async () => {
            try {
                // Initialize configuration service
                const configService = new ConfigService(serviceOptions);
                configService.initializeConfig(config.configKeys, config.scaleConfigs);
                configService.initializeManualOverrides();

                // Initialize validation service
                const validationService = new ValidationService(serviceOptions, configService);

                // Initialize scaling utils
                const scalingUtils = new ScalingUtils(configService, new Logger(node, "SCALING"));

                // Load environment configuration
                const deviceId = globalHelper.getEnvVar(ENV_KEYS.DEVICE_ID, DEFAULTS.DEVICE_ID);

                // Initialize Modbus client configuration
                const modbusConfig = {
                    type: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_TYPE, MODBUS_CONFIG.DEFAULT_TYPE) as "TCP" | "RTU"),
                    host: globalHelper.getEnvVar(ENV_KEYS.MODBUS_HOST, MODBUS_CONFIG.DEFAULT_HOST),
                    tcpPort: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TCP_PORT, MODBUS_CONFIG.DEFAULT_TCP_PORT),
                    serialPort: globalHelper.getEnvVar(ENV_KEYS.MODBUS_SERIAL_PORT, MODBUS_CONFIG.DEFAULT_SERIAL_PORT),
                    baudRate: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_BAUD_RATE, MODBUS_CONFIG.DEFAULT_BAUD_RATE),
                    parity: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_PARITY, MODBUS_CONFIG.DEFAULT_PARITY) as "none" | "even" | "odd"),
                    unitId: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_UNIT_ID, MODBUS_CONFIG.DEFAULT_UNIT_ID),
                    timeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TIMEOUT, MODBUS_CONFIG.DEFAULT_TIMEOUT),
                    reconnectInterval: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_RECONNECT_INTERVAL, MODBUS_CONFIG.DEFAULT_RECONNECT_INTERVAL),
                };

                // Log Modbus configuration for debugging
                logger.log(`Modbus Configuration: ${JSON.stringify(modbusConfig, null, 2)}`);

                // Validate Modbus configuration
                if (modbusConfig.type === "TCP" && (!modbusConfig.host || !modbusConfig.tcpPort)) {
                    const error = "Invalid Modbus TCP configuration: host and tcpPort are required";
                    logger.error(error);
                    node.status({ fill: "red", shape: "ring", text: error });
                    return;
                }

                if (modbusConfig.type === "RTU" && !modbusConfig.serialPort) {
                    const error = "Invalid Modbus RTU configuration: serialPort is required";
                    logger.error(error);
                    node.status({ fill: "red", shape: "ring", text: error });
                    return;
                }

                // Initialize MQTT client configuration
                const mqttConfig: MqttConfig = config.mqttBroker === "thingsboard"
                    ? {
                        broker: `mqtt://${globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_HOST, MQTT_CONFIG.THINGSBOARD.DEFAULT_HOST)}:${globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_PORT, MQTT_CONFIG.THINGSBOARD.DEFAULT_PORT)}`,
                        clientId: `node-red-thingsboard-rpc-${Math.random().toString(16).substring(2, 10)}`,
                        username: globalHelper.getEnvVar(ENV_KEYS.DEVICE_ACCESS_TOKEN, ""),
                        password: globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_PASSWORD, ""),
                        qos: MQTT_CONFIG.THINGSBOARD.QOS,
                    }
                    : {
                        broker: `mqtt://${globalHelper.getEnvVar(ENV_KEYS.EMQX_HOST, MQTT_CONFIG.LOCAL.DEFAULT_HOST)}:${globalHelper.getEnvVar(ENV_KEYS.EMQX_PORT, MQTT_CONFIG.LOCAL.DEFAULT_PORT)}`,
                        clientId: `node-red-local-rpc-${Math.random().toString(16).substring(2, 10)}`,
                        username: globalHelper.getEnvVar(ENV_KEYS.EMQX_USERNAME, ""),
                        password: globalHelper.getEnvVar(ENV_KEYS.EMQX_PASSWORD, ""),
                        qos: MQTT_CONFIG.LOCAL.QOS,
                    };

                logger.log(`mqttConfig: ${JSON.stringify(mqttConfig, null, 2)}`);

                // Define MQTT topics
                const subscribeTopic = config.mqttBroker === "thingsboard"
                    ? MQTT_CONFIG.THINGSBOARD.SUBSCRIBE_TOPIC
                    : `v1/devices/me/rpc/request/${deviceId}`;
                const publishTopic = config.mqttBroker === "thingsboard"
                    ? MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC
                    : `v1/devices/me/telemetry/${deviceId}`;
                logger.log(`MQTT Configuration: ${JSON.stringify(mqttConfig, null, 2)}`);

                // Initialize clients with better error handling
                let modbusClient: any;
                let mqttClient: any;

                try {
                    // Initialize Modbus client
                    logger.log("Initializing Modbus client...");
                    modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);

                    // Wait a moment for Modbus connection to establish
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // Check if Modbus client is actually connected
                    if (!modbusClient.isConnectedCheck()) {
                        throw new Error("Modbus client failed to connect - check device connection and configuration");
                    }

                    logger.log("Modbus client initialized successfully");
                } catch (error) {
                    const errorMsg = `Modbus initialization failed: ${(error as Error).message}`;
                    logger.error(errorMsg);
                    node.status({ fill: "red", shape: "ring", text: "Modbus connection failed" });
                    return;
                }

                try {
                    // Initialize MQTT client
                    logger.warn("[MQTT-INIT] Starting MQTT client initialization...");
                    logger.warn(`[MQTT-INIT] Broker type: ${config.mqttBroker}`);
                    logger.warn(`[MQTT-INIT] MQTT config: ${JSON.stringify(mqttConfig, null, 2)}`);

                    mqttClient = config.mqttBroker === "thingsboard"
                        ? await ClientRegistry.getThingsboardMqttClient(mqttConfig, node)
                        : await ClientRegistry.getLocalMqttClient(mqttConfig, node);

                    logger.warn("[MQTT-INIT] MQTT client initialized successfully");
                    logger.warn(`[MQTT-INIT] Client connected status: ${mqttClient.isConnected()}`);
                } catch (error) {
                    const errorMsg = `MQTT initialization failed: ${(error as Error).message}`;
                    logger.error(`[MQTT-INIT] ${errorMsg}`);
                    logger.error(`[MQTT-INIT] Error stack: ${(error as Error).stack}`);
                    node.status({ fill: "red", shape: "ring", text: "MQTT connection failed" });
                    return;
                }

                if (!modbusClient || !mqttClient) {
                    node.error(ERROR_MESSAGES.CLIENT_INIT_FAILED);
                    node.status({ fill: "red", shape: "ring", text: ERROR_MESSAGES.CLIENT_INIT_FAILED });
                    return;
                }

                logger.log(`MQTT client initialized and connected: ${mqttClient.isConnected()}`);

                // Initialize services
                const modbusService = new ModbusService(serviceOptions, modbusClient, scalingUtils);
                const mqttService = new MqttService(serviceOptions, mqttClient, publishTopic);
                const messageHandler = new MessageHandler(serviceOptions);
                const luoiHandler = new LuoiMappingHandler(node, modbusService, validationService, mqttService);
                const rpcHandler = new RpcHandler(
                    serviceOptions,
                    configService,
                    validationService,
                    modbusService,
                    mqttService,
                    luoiHandler
                );



                // Set up MQTT subscription
                try {
                    logger.warn("[MQTT-SUB] Setting up MQTT subscription...");
                    logger.warn(`[MQTT-SUB] Subscribe topic: ${subscribeTopic}`);
                    logger.warn(`[MQTT-SUB] Publish topic: ${publishTopic}`);

                    // Wait for client to be connected before subscribing
                    if (!mqttClient.isConnected()) {
                        logger.warn("[MQTT-SUB] MQTT client not connected, waiting for connection...");
                        await new Promise<void>((resolve) => {
                            mqttClient.once("mqtt-status", ({ status }) => {
                                logger.warn(`[MQTT-SUB] Received status event: ${status}`);
                                if (status === "connected") {
                                    logger.warn("[MQTT-SUB] Connection established, proceeding with subscription");
                                    resolve();
                                }
                            });

                            // Set a timeout in case connection never happens
                            setTimeout(() => {
                                logger.warn("[MQTT-SUB] MQTT connection timeout, proceeding anyway");
                                resolve();
                            }, 5000);
                        });
                    } else {
                        logger.warn("[MQTT-SUB] MQTT client already connected");
                    }

                    logger.warn(`[MQTT-SUB] Attempting to subscribe to: ${subscribeTopic}`);
                    await mqttClient.subscribe(subscribeTopic);
                    logger.warn(`[MQTT-SUB] Successfully subscribed to topic: ${subscribeTopic}`);
                } catch (error) {
                    const errorMsg = `Failed to subscribe to ${subscribeTopic}: ${(error as Error).message}`;
                    logger.error(`[MQTT-SUB] ${errorMsg}`);
                    logger.error(`[MQTT-SUB] Error stack: ${(error as Error).stack}`);
                    node.error(errorMsg);
                    node.status({ fill: "red", shape: "ring", text: ERROR_MESSAGES.SUBSCRIPTION_FAILED });

                    // Attempt to reconnect and resubscribe after a delay
                    setTimeout(async () => {
                        try {
                            if (mqttClient.isConnected()) {
                                await mqttClient.subscribe(subscribeTopic);
                                logger.log(`Resubscribed to topic after connection recovery: ${subscribeTopic}`);
                                node.status({ fill: "green", shape: "dot", text: "Subscription recovered" });
                            } else {
                                logger.warn("MQTT still disconnected, will retry on connection event");
                                mqttClient.once("mqtt-status", async ({ status }) => {
                                    if (status === "connected") {
                                        await mqttClient.subscribe(subscribeTopic);
                                        logger.log(`Resubscribed on reconnection: ${subscribeTopic}`);
                                        node.status({ fill: "green", shape: "dot", text: "Subscription recovered" });
                                    }
                                });
                            }
                        } catch (retryError) {
                            logger.error(`Resubscription attempt failed: ${(retryError as Error).message}`);
                        }
                    }, 3000);
                    return;
                }

                // Set up MQTT message handler
                logger.warn("[MQTT-HANDLER] Setting up MQTT message event listener...");
                mqttClient.on("mqtt-message", ({ message }: { message: MqttMessage }) => {
                    logger.warn(`[MQTT-HANDLER] Received MQTT message on topic: ${message.topic}`);
                    logger.warn(`[MQTT-HANDLER] Message content: ${JSON.stringify(message)}`);
                    logger.warn(`[MQTT-HANDLER] Expected subscribe topic: ${subscribeTopic}`);

                    try {
                        const result = messageHandler.processMqttMessage(
                            message,
                            subscribeTopic,
                            async (payload: any) => {
                                logger.warn("[MQTT-HANDLER] Processing MQTT RPC message with payload:");
                                logger.warn(`[MQTT-HANDLER] Payload: ${JSON.stringify(payload)}`);
                                ClientRegistry.logConnectionCounts(node);
                                await rpcHandler.handleRpcRequest(payload);
                            }
                        );

                        if (result === null) {
                            logger.warn("[MQTT-HANDLER] Message was rejected or filtered out");
                        } else {
                            logger.warn("[MQTT-HANDLER] Message processed successfully");
                        }
                    } catch (error) {
                        logger.error(`[MQTT-HANDLER] Error processing MQTT message: ${(error as Error).message}`);
                    }
                });
                logger.warn("[MQTT-HANDLER] MQTT message event listener registered successfully");

                // Test MQTT message reception after 5 seconds
                setTimeout(() => {
                    logger.warn("[TEST] Testing MQTT message reception...");
                    logger.warn(`[TEST] Current subscribed topics: ${Array.from(mqttClient.subscribedTopics || []).join(', ')}`);
                    logger.warn(`[TEST] MQTT client still connected: ${mqttClient.isConnected()}`);

                    // Test if we can receive any message by subscribing to a test topic
                    const testTopic = "test/viis/rpc";
                    mqttClient.subscribe(testTopic).then(() => {
                        logger.warn(`[TEST] Successfully subscribed to test topic: ${testTopic}`);

                        // Publish a test message to ourselves
                        setTimeout(() => {
                            mqttClient.publish(testTopic, JSON.stringify({
                                method: "test",
                                params: { test: true },
                                timestamp: Date.now()
                            })).then(() => {
                                logger.warn("[TEST] Test message published successfully");
                            }).catch((error: Error) => {
                                logger.error(`[TEST] Failed to publish test message: ${error.message}`);
                            });
                        }, 1000);
                    }).catch((error: Error) => {
                        logger.error(`[TEST] Failed to subscribe to test topic: ${error.message}`);
                    });
                }, 5000);

                // Node initialization completed successfully
                logger.warn("[INIT] ===== VIIS RPC Control Node initialization completed successfully =====");
                logger.warn(`[INIT] Node ID: ${node.id}`);
                logger.warn(`[INIT] MQTT Broker: ${config.mqttBroker}`);
                logger.warn(`[INIT] Subscribe Topic: ${subscribeTopic}`);
                logger.warn(`[INIT] Publish Topic: ${publishTopic}`);
                logger.warn(`[INIT] MQTT Connected: ${mqttClient.isConnected()}`);
                logger.warn(`[INIT] Modbus Connected: ${modbusClient.isConnectedCheck()}`);
                node.status({ fill: "green", shape: "dot", text: "Ready - Listening for MQTT messages" });

                // Handle input messages for dynamic configuration updates and RPC commands
                node.on('input', (msg: any) => {
                    logger.log('Input message received');
                    node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.MESSAGE_RECEIVED });

                    // Handle RPC commands from input
                    if ((msg.payload && typeof msg.payload === 'object' && msg.payload.method === 'set_state') ||
                        (typeof msg.method === 'string' && msg.method === 'set_state')) {

                        logger.warn("Processing RPC input");

                        try {
                            let rpcBody: RpcMessage;
                            if (typeof msg.payload === 'object' && msg.payload.method === 'set_state') {
                                rpcBody = msg.payload;
                            } else if (typeof msg.method === 'string' && msg.method === 'set_state' && msg.params) {
                                rpcBody = {
                                    method: msg.method,
                                    params: msg.params,
                                    timeout: msg.timeout
                                };
                            } else {
                                throw new Error(ERROR_MESSAGES.INVALID_RPC_FORMAT);
                            }

                            node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.PROCESSING_RPC_INPUT });
                            rpcHandler.handleRpcRequest(rpcBody);
                        } catch (error) {
                            logger.error(ERROR_MESSAGES.RPC_INPUT_FAILED + `: ${(error as Error).message}`);
                            node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.RPC_INPUT_ERROR });
                        }
                    }
                });



                // Cleanup when node is removed
                node.on('close', async (done: () => void) => {
                    try {
                        // Clear all timeouts and caches
                        mqttService.clearAllTimeouts();
                        messageHandler.clearProcessedMessages();
                        configService.clearNodeConfigs();

                        // Disconnect clients
                        mqttClient.disconnect();
                        ClientRegistry.releaseClient("modbus", node);
                        if (config.mqttBroker === "thingsboard") {
                            ClientRegistry.releaseClient("thingsboard", node);
                        } else {
                            ClientRegistry.releaseClient("local", node);
                        }

                        logger.log("Node closed and all resources cleaned");
                        done();
                    } catch (error) {
                        logger.error(`Cleanup error: ${(error as Error).message}`);
                        done();
                    }
                });

            } catch (error) {
                logger.error(`Node initialization failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            logger.error(`Async initialization failed: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
    }

    RED.nodes.registerType("viis-rpc-control", ViisRpcControlNode);
};

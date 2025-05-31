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

                // Define MQTT topics
                const subscribeTopic = config.mqttBroker === "thingsboard"
                    ? MQTT_CONFIG.THINGSBOARD.SUBSCRIBE_TOPIC
                    : `v1/devices/me/rpc/request/${deviceId}`;
                const publishTopic = config.mqttBroker === "thingsboard"
                    ? MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC
                    : `v1/devices/me/telemetry/${deviceId}`;
                console.log("mqttConfig is", mqttConfig)
                // Initialize clients
                const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
                const mqttClient = config.mqttBroker === "thingsboard"
                    ? await ClientRegistry.getThingsboardMqttClient(mqttConfig, node)
                    : await ClientRegistry.getLocalMqttClient(mqttConfig, node);

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
                    // Wait for client to be connected before subscribing
                    if (!mqttClient.isConnected()) {
                        logger.log("MQTT client not connected, waiting for connection...");
                        await new Promise<void>((resolve) => {
                            mqttClient.once("mqtt-status", ({ status }) => {
                                if (status === "connected") {
                                    resolve();
                                }
                            });

                            // Set a timeout in case connection never happens
                            setTimeout(() => {
                                logger.warn("MQTT connection timeout, proceeding anyway");
                                resolve();
                            }, 5000);
                        });
                    }

                    await mqttClient.subscribe(subscribeTopic);
                    logger.log(`Subscribed to topic: ${subscribeTopic}`);
                } catch (error) {
                    node.error(`Failed to subscribe to ${subscribeTopic}: ${(error as Error).message}`);
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
                mqttClient.on("mqtt-message", ({ message }: { message: MqttMessage }) => {
                    messageHandler.processMqttMessage(
                        message,
                        subscribeTopic,
                        async (payload: any) => {
                            console.log("fuck you")
                            ClientRegistry.logConnectionCounts(node);
                            await rpcHandler.handleRpcRequest(payload);
                        }
                    );
                });

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

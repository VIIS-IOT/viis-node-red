import { NodeAPI, Node } from "node-red";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
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

        // Track current Modbus config for hot-reload detection
        let currentModbusConfig: any = null;
        let configCheckInterval: NodeJS.Timeout | null = null;
        let currentBoardId: string | undefined = config.boardId;
        let isMultiBoardMode: boolean = false;

        // Helper function to read fresh Modbus config from global context
        const readModbusConfig = () => {
            // Check for multi-board configuration
            const boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);
            
            if (boardsConfig) {
                try {
                    let boards;
                    
                    // Handle both already-parsed array and JSON string
                    if (Array.isArray(boardsConfig)) {
                        boards = boardsConfig;
                    } else if (typeof boardsConfig === 'string') {
                        boards = JSON.parse(boardsConfig);
                    } else {
                        logger.error(`Invalid MODBUS_BOARDS type: ${typeof boardsConfig}`);
                        boards = null;
                    }
                    
                    if (Array.isArray(boards) && boards.length > 0) {
                        // Multi-board mode
                        return {
                            mode: 'multi',
                            boards: boards,
                            defaultBoard: globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id)
                        };
                    }
                } catch (e) {
                    logger.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                }
            }
            
            // Single-board mode (backward compatible)
            return {
                mode: 'single',
                config: {
                    type: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_TYPE, MODBUS_CONFIG.DEFAULT_TYPE) as "TCP" | "RTU"),
                    host: globalHelper.getEnvVar(ENV_KEYS.MODBUS_HOST, MODBUS_CONFIG.DEFAULT_HOST),
                    tcpPort: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TCP_PORT, MODBUS_CONFIG.DEFAULT_TCP_PORT),
                    serialPort: globalHelper.getEnvVar(ENV_KEYS.MODBUS_SERIAL_PORT, MODBUS_CONFIG.DEFAULT_SERIAL_PORT),
                    baudRate: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_BAUD_RATE, MODBUS_CONFIG.DEFAULT_BAUD_RATE),
                    parity: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_PARITY, MODBUS_CONFIG.DEFAULT_PARITY) as "none" | "even" | "odd"),
                    unitId: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_UNIT_ID, MODBUS_CONFIG.DEFAULT_UNIT_ID),
                    timeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TIMEOUT, MODBUS_CONFIG.DEFAULT_TIMEOUT),
                    reconnectInterval: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_RECONNECT_INTERVAL, MODBUS_CONFIG.DEFAULT_RECONNECT_INTERVAL),
                    // Board-specific configuration
                    boardType: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_BOARD_TYPE, MODBUS_CONFIG.DEFAULT_BOARD_TYPE) as "STM32" | "ATMEGA" | "GENERIC"),
                    writeTimeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_WRITE_TIMEOUT, MODBUS_CONFIG.DEFAULT_WRITE_TIMEOUT),
                    readTimeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_READ_TIMEOUT, MODBUS_CONFIG.DEFAULT_READ_TIMEOUT),
                    connectionTimeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_CONNECTION_TIMEOUT, MODBUS_CONFIG.DEFAULT_CONNECTION_TIMEOUT),
                    maxRetries: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_MAX_RETRIES, MODBUS_CONFIG.DEFAULT_MAX_RETRIES),
                }
            };
        };

        // Wrap async initialization in IIFE
        (async () => {
            try {
                // Add random delay to stagger initialization when multiple nodes deploy simultaneously
                const initDelay = Math.random() * 2000; // 0-2 seconds
                logger.warn(`[INIT] Node ${node.id} waiting ${Math.round(initDelay)}ms before initialization to avoid conflicts`);
                await new Promise(resolve => setTimeout(resolve, initDelay));

                logger.warn(`[INIT] Node ${node.id} starting initialization sequence`);

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

                // Initialize Modbus client configuration with board-specific settings
                const configData = readModbusConfig();
                currentModbusConfig = { ...configData }; // Store for hot-reload detection

                // Auto-detect mode
                if (configData.mode === 'multi') {
                    isMultiBoardMode = true;
                    logger.log(`Multi-board mode detected with ${configData.boards.length} boards`);
                    
                    // Initialize multi-board configuration
                    const multiConfig: MultiModbusConfig = {
                        mode: 'multi',
                        defaultBoard: configData.defaultBoard,
                        boards: configData.boards
                    };
                    ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
                } else {
                    isMultiBoardMode = false;
                    const cfg = configData.config;
                    logger.log(`Single-board mode: ${cfg.type} ${cfg.host}:${cfg.tcpPort}`);
                    
                    // Validate single-board configuration
                    if (cfg.type === "TCP" && (!cfg.host || !cfg.tcpPort)) {
                        const error = "Invalid Modbus TCP configuration: host and tcpPort are required";
                        logger.error(error);
                        node.status({ fill: "red", shape: "ring", text: error });
                        return;
                    }

                    if (cfg.type === "RTU" && !cfg.serialPort) {
                        const error = "Invalid Modbus RTU configuration: serialPort is required";
                        logger.error(error);
                        node.status({ fill: "red", shape: "ring", text: error });
                        return;
                    }
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
                    
                    // Determine which client to get based on mode and configuration
                    if (isMultiBoardMode) {
                        const boardToUse = currentBoardId || configData.defaultBoard;
                        logger.log(`Getting client for board: ${boardToUse}`);
                        modbusClient = ClientRegistry.getModbusClientV2(boardToUse, node);
                    } else {
                        modbusClient = ClientRegistry.getModbusClientV2(configData.config, node);
                    }

                    // Wait a moment for Modbus connection to establish
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for connection
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
                    logger.warn(`[MQTT-INIT] Node ID: ${node.id}`);
                    logger.warn(`[MQTT-INIT] Broker type: ${config.mqttBroker}`);
                    logger.warn(`[MQTT-INIT] MQTT config: ${JSON.stringify(mqttConfig, null, 2)}`);

                    // Log current client registry state
                    ClientRegistry.logConnectionCounts(node);

                    // Add delay to avoid race conditions with other nodes
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    mqttClient = config.mqttBroker === "thingsboard"
                        ? await ClientRegistry.getThingsboardMqttClient(mqttConfig, node)
                        : await ClientRegistry.getLocalMqttClient(mqttConfig, node);

                    logger.warn("[MQTT-INIT] MQTT client initialized successfully");
                    logger.warn(`[MQTT-INIT] Client connected status: ${mqttClient.isConnected()}`);

                    // Log final client registry state
                    ClientRegistry.logConnectionCounts(node);
                } catch (error) {
                    const errorMsg = `MQTT initialization failed: ${(error as Error).message}`;
                    logger.error(`[MQTT-INIT] ${errorMsg}`);
                    logger.error(`[MQTT-INIT] Error stack: ${(error as Error).stack}`);
                    node.error(errorMsg);
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
                    logger.warn(`[MQTT-SUB] Node ID: ${node.id}`);
                    logger.warn(`[MQTT-SUB] Subscribe topic: ${subscribeTopic}`);
                    logger.warn(`[MQTT-SUB] Publish topic: ${publishTopic}`);

                    // Verify MQTT client is still valid
                    if (!mqttClient) {
                        throw new Error("MQTT client is null after initialization");
                    }

                    logger.warn(`[MQTT-SUB] MQTT client instance exists: ${!!mqttClient}`);
                    logger.warn(`[MQTT-SUB] MQTT client type: ${mqttClient.constructor.name}`);

                    // Wait for connection before subscribing with shorter timeout for faster recovery
                    if (!mqttClient.isConnected()) {
                        logger.warn("[MQTT-SUBSCRIBE] Waiting for MQTT connection before subscribing...");
                        try {
                            await mqttClient.waitForConnection(10000); // Wait up to 10 seconds for faster failure detection
                        } catch (error) {
                            logger.error(`[MQTT-SUBSCRIBE] Connection timeout: ${(error as Error).message}`);
                            // Trigger circuit breaker reset for immediate recovery
                            if (mqttClient && typeof mqttClient.resetCircuitBreaker === 'function') {
                                mqttClient.resetCircuitBreaker();
                            }
                            throw error;
                        }
                    }

                    // Subscribe with more aggressive retries
                    let retryCount = 0;
                    const maxRetries = 5; // Increased from 3

                    while (retryCount < maxRetries) {
                        try {
                            await mqttClient.subscribe(subscribeTopic);
                            logger.warn(`[MQTT-SUB] Successfully subscribed to topic: ${subscribeTopic}`);
                            break;
                        } catch (error) {
                            retryCount++;
                            logger.error(`[MQTT-SUB] Failed to subscribe to ${subscribeTopic}: ${(error as Error).message}`);
                            logger.error(`[MQTT-SUB] Error stack: ${(error as Error).stack}`);
                            logger.error(`[MQTT-SUB] Retrying subscription in 2 seconds...`);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }

                    if (retryCount >= maxRetries) {
                        throw new Error(`Failed to subscribe to ${subscribeTopic} after ${maxRetries} retries`);
                    }
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
                                mqttClient.once("mqtt-status", async ({ status }: any) => {
                                    if (status === "connected") {
                                        await mqttClient.subscribe(subscribeTopic);
                                        logger.log(`Resubscribed on reconnection: ${subscribeTopic}`);
                                        node.status({ fill: "green", shape: "dot", text: "Subscription recovered" });
                                    } else if (status === 'disconnected') {
                                        logger.warn("[MQTT-STATUS] MQTT disconnected - recovery will be attempted");
                                        node.status({ fill: "yellow", shape: "ring", text: "Disconnected - recovering" });
                                        // Trigger immediate recovery attempt
                                        if (mqttClient && typeof mqttClient.resetCircuitBreaker === 'function') {
                                            setTimeout(() => {
                                                logger.warn("[MQTT-STATUS] Triggering circuit breaker reset for recovery");
                                                mqttClient.resetCircuitBreaker();
                                            }, 1000); // 1 second delay to avoid rapid resets
                                        }
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

                // Auto-detect config changes every 30 seconds
                configCheckInterval = setInterval(async () => {
                    try {
                        const newConfig = readModbusConfig();
                        
                        // Check if mode has changed or if critical config has changed
                        let hasChanged = false;
                        let changeDescription = "";
                        
                        if (currentModbusConfig.mode !== newConfig.mode) {
                            hasChanged = true;
                            changeDescription = `mode changed from ${currentModbusConfig.mode} to ${newConfig.mode}`;
                        } else if (newConfig.mode === 'single' && currentModbusConfig.mode === 'single') {
                            // Check single mode config changes
                            const oldCfg = currentModbusConfig.config;
                            const newCfg = newConfig.config;
                            hasChanged = 
                                oldCfg.host !== newCfg.host ||
                                oldCfg.tcpPort !== newCfg.tcpPort ||
                                oldCfg.serialPort !== newCfg.serialPort ||
                                oldCfg.type !== newCfg.type;
                            if (hasChanged) {
                                changeDescription = `${newCfg.host}:${newCfg.tcpPort}`;
                            }
                        } else if (newConfig.mode === 'multi' && currentModbusConfig.mode === 'multi') {
                            // Check multi mode config changes
                            const oldBoards = JSON.stringify(currentModbusConfig.boards);
                            const newBoards = JSON.stringify(newConfig.boards);
                            hasChanged = oldBoards !== newBoards;
                            if (hasChanged) {
                                changeDescription = `board configuration updated`;
                            }
                        }

                        if (hasChanged) {
                            logger.warn(`[HOT-RELOAD] Config change detected: ${changeDescription}`);
                            
                            // Reinitialize based on new mode
                            if (newConfig.mode === 'multi') {
                                const multiConfig: MultiModbusConfig = {
                                    mode: 'multi',
                                    defaultBoard: newConfig.defaultBoard,
                                    boards: newConfig.boards
                                };
                                ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
                                
                                // Get new client for current board
                                const boardToUse = currentBoardId || newConfig.defaultBoard;
                                modbusClient = ClientRegistry.getModbusClientV2(boardToUse, node);
                            } else {
                                // Single mode reload
                                const reloaded = await ClientRegistry.reloadModbusConfig(newConfig.config, node);
                                if (reloaded) {
                                    modbusClient = ClientRegistry.getModbusClientV2(newConfig.config, node);
                                }
                            }
                            
                            // Update service with new client
                            if (modbusService && modbusClient) {
                                (modbusService as any).modbusClient = modbusClient;
                            }
                            
                            currentModbusConfig = { ...newConfig };
                            isMultiBoardMode = newConfig.mode === 'multi';
                            logger.warn(`[HOT-RELOAD] Modbus reloaded: ${changeDescription}`);
                            
                            node.status({ fill: "green", shape: "dot", text: `Reloaded: ${changeDescription}` });
                            setTimeout(() => {
                                node.status({ fill: "green", shape: "dot", text: "Ready - Listening for MQTT messages" });
                            }, 5000);
                        }
                    } catch (error) {
                        logger.error(`[HOT-RELOAD] Config check error: ${(error as Error).message}`);
                    }
                }, 30000); // Check every 30 seconds

                // Node initialization completed successfully
                logger.warn("[INIT] ===== VIIS RPC Control Node initialization completed successfully =====");
                logger.warn(`[INIT] Node ID: ${node.id}`);
                logger.warn(`[INIT] MQTT Broker: ${config.mqttBroker}`);
                logger.warn(`[INIT] Subscribe Topic: ${subscribeTopic}`);
                logger.warn(`[INIT] Publish Topic: ${publishTopic}`);
                logger.warn(`[INIT] MQTT Connected: ${mqttClient.isConnected()}`);
                logger.warn(`[INIT] Modbus Connected: ${modbusClient.isConnectedCheck()}`);
                logger.warn(`[INIT] Hot-reload enabled: Checking config every 30s`);
                node.status({ fill: "green", shape: "dot", text: "Ready - Listening for MQTT messages" });

                // Handle input messages for dynamic configuration updates and RPC commands
                node.on('input', async (msg: any) => {
                    logger.log('Input message received');
                    node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.MESSAGE_RECEIVED });

                    // Handle manual Modbus config reload command
                    if (msg.topic === 'reload-modbus-config' || msg.payload === 'reload-modbus-config') {
                        logger.warn("[MANUAL-RELOAD] Manual Modbus config reload requested");
                        
                        try {
                            const newConfig = readModbusConfig();
                            
                            // Reinitialize based on mode
                            if (newConfig.mode === 'multi') {
                                const multiConfig: MultiModbusConfig = {
                                    mode: 'multi',
                                    defaultBoard: newConfig.defaultBoard,
                                    boards: newConfig.boards
                                };
                                ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
                                const boardToUse = currentBoardId || newConfig.defaultBoard;
                                modbusClient = ClientRegistry.getModbusClientV2(boardToUse, node);
                            } else {
                                const reloaded = await ClientRegistry.reloadModbusConfig(newConfig.config, node);
                                if (reloaded) {
                                    modbusClient = ClientRegistry.getModbusClientV2(newConfig.config, node);
                                }
                            }
                            
                            if (modbusService && modbusClient) {
                                (modbusService as any).modbusClient = modbusClient;
                            }
                            currentModbusConfig = { ...newConfig };
                            
                            logger.warn("[MANUAL-RELOAD] Manual reload completed successfully");
                        } catch (error) {
                            logger.error(`[MANUAL-RELOAD] Manual reload failed: ${(error as Error).message}`);
                        }
                        return;
                    }

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
                        // Stop config check interval
                        if (configCheckInterval) {
                            clearInterval(configCheckInterval);
                            configCheckInterval = null;
                            logger.log("[CLEANUP] Config check interval stopped");
                        }

                        // Clear all timeouts and caches
                        mqttService.clearAllTimeouts();
                        messageHandler.clearProcessedMessages();
                        configService.clearNodeConfigs();

                        // Disconnect clients
                        mqttClient.disconnect();
                        
                        // Release Modbus client (multi-board aware)
                        if (isMultiBoardMode && currentBoardId) {
                            ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
                        } else {
                            ClientRegistry.releaseClientV2("modbus", node);
                        }
                        
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

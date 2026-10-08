import { NodeAPI, Node } from "node-red";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
import { MqttConfig, MqttMessage } from "../../core/mqtt-client";
import { LuoiMappingHandler } from "./luoi-mapping-handler";
import {
    ViisRpcControlNodeDef,
    RpcMessage
} from "./interfaces/types";
import { RpcHandler } from "./handlers/rpcHandler";
import { resolveWaterHammerDelayMs } from "../shared/fertigation-start-sequence";
import { MessageHandler } from "./handlers/messageHandler";
import { ConfigService } from "./services/configService";
import { MqttService } from "./services/mqttService";
import { ModbusService } from "./services/modbusService";
import { ValidationService } from "./services/validationService";
import { Logger } from "./utils/logger";
import { ScalingUtils } from "./utils/scaling";
import { DiagnosticLogger } from "../../core/observability/diagnostic-logger";
import { getDiagnosticRuntime, runtimeBootId } from "../../core/observability/runtime";
import { attachBusinessRequestId, createId, createTraceContext } from "../../core/observability/trace-context";
import { TraceContext } from "../../core/observability/types";
import { attachRpcMqttMessageHandler } from "./rpc-mqtt-ingress";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { ProtectionGateService } from "../viis-device-protection/services/protection-gate-service";
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
        const diagnostic = new DiagnosticLogger(node, "viis-rpc-control");
        const nodeInstanceId = createId();

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
        let modbusClient: any;
        let mqttClient: any;
        let mqttService: MqttService | undefined;
        let messageHandler: MessageHandler | undefined;
        let rpcHandler: RpcHandler | undefined;
        let initPhase = "created";
        let handlerAttached = false;
        let inputHandlerAttached = false;
        let subscriptionState: "unknown" | "pending" | "subscribed" | "failed" = "unknown";
        let subscriptionRetryInterval: NodeJS.Timeout | null = null;
        let subscriptionRecoveryTimeout: NodeJS.Timeout | null = null;
        let recoveryStatusListener: ((event: any) => void) | undefined;
        let subscriptionAttemptInProgress = false;
        let lastReceivedAt: string | undefined;
        let lastRpcStartedAt: string | undefined;
        let lastExecutionFinishedAt: string | undefined;
        let lastPublishAcknowledgedAt: string | undefined;
        let deviceIdForDiag: string | undefined;
        let nextHealthAt = Date.now() + (Number(process.env.VIIS_DIAGNOSTICS_HEALTH_INTERVAL_MS) || 30000);
        const healthIntervalMs = Number(process.env.VIIS_DIAGNOSTICS_HEALTH_INTERVAL_MS) || 30000;
        const healthTimer = setInterval(() => {
            const now = Date.now();
            const state = mqttClient?.getDiagnosticStatus?.() || mqttClient?.getConnectionState?.();
            const modbusState = modbusClient?.getDiagnosticStatus?.();
            diagnostic.emit("info", "rpc.health_snapshot", {
                nodeInstanceId,
                deviceId: deviceIdForDiag,
                initPhase,
                handlerAttached,
                subscriptionState,
                mqtt: mqttClient ? {
                    clientId: state?.clientId,
                    connected: Boolean(mqttClient.isConnected?.()),
                    reconnectAttempts: state?.reconnectAttempts,
                    circuitBreakerOpen: state?.circuitBreakerOpen,
                    queue: state?.queue || mqttClient.getQueueStatus?.(),
                } : { initialized: false },
                modbus: modbusState || {
                    initialized: Boolean(modbusClient),
                    connected: Boolean(modbusClient?.isConnectedCheck?.()),
                },
                rpc: rpcHandler?.getDiagnosticStatus?.(),
                publish: mqttService?.getDiagnosticStatus?.(),
                lastReceivedAt,
                lastRpcStartedAt,
                lastExecutionFinishedAt,
                lastPublishAcknowledgedAt: mqttService?.getDiagnosticStatus?.().lastPublishAcknowledgedAt || lastPublishAcknowledgedAt,
                eventLoopDriftMs: Math.max(0, now - nextHealthAt),
                diagnosticSink: getDiagnosticRuntime().getStatus(),
            });
            nextHealthAt = now + healthIntervalMs;
        }, healthIntervalMs);
        healthTimer.unref?.();
        node.on("close", () => {
            clearInterval(healthTimer);
            initPhase = "closed";
            diagnostic.emit("info", "node.closed", { nodeInstanceId, handlerAttached, subscriptionState });
        });

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
                initPhase = "initializing";
                diagnostic.emit("info", "node.initializing", { nodeInstanceId });
                // Add random delay to stagger initialization when multiple nodes deploy simultaneously
                const initDelay = Math.random() * 2000; // 0-2 seconds
                await new Promise(resolve => setTimeout(resolve, initDelay));
                if (initPhase === "closed") return;

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
                deviceIdForDiag = deviceId;

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

                // Define MQTT topics
                // Always use wildcard for RPC requests to receive all RPC commands
                const subscribeTopic = config.mqttBroker === "thingsboard"
                    ? MQTT_CONFIG.THINGSBOARD.SUBSCRIBE_TOPIC  // "v1/devices/me/rpc/request/+"
                    : MQTT_CONFIG.THINGSBOARD.SUBSCRIBE_TOPIC; // Also use wildcard for local MQTT
                const publishTopic = config.mqttBroker === "thingsboard"
                    ? MQTT_CONFIG.THINGSBOARD.PUBLISH_TOPIC
                    : `v1/devices/me/telemetry/${deviceId}`;

                // Initialize clients with better error handling
                try {
                    // Initialize Modbus client
                    logger.log("Initializing Modbus client...");

                    // Determine which client to get based on mode and configuration
                    if (isMultiBoardMode) {
                        const boardToUse = currentBoardId || configData.defaultBoard;
                        logger.log(`Getting client for board: ${boardToUse}`);
                        modbusClient = await ClientRegistry.getModbusClientV2(boardToUse, node);
                    } else {
                        modbusClient = await ClientRegistry.getModbusClientV2(configData.config, node);
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
                    diagnostic.emit("error", "node.init_failed", { nodeInstanceId, phase: "modbus_initialization", error: { message: (error as Error).message } });
                    if (modbusClient) {
                        if (isMultiBoardMode && currentBoardId) ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
                        else ClientRegistry.releaseClientV2("modbus", node);
                    }
                    node.status({ fill: "red", shape: "ring", text: "Modbus connection failed" });
                    return;
                }
                if (initPhase === "closed") {
                    if (isMultiBoardMode && currentBoardId) ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
                    else ClientRegistry.releaseClientV2("modbus", node);
                    return;
                }

                try {
                    // Initialize MQTT client
                    // Add delay to avoid race conditions with other nodes
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    mqttClient = config.mqttBroker === "thingsboard"
                        ? await ClientRegistry.getThingsboardMqttClient(mqttConfig, node)
                        : await ClientRegistry.getLocalMqttClient(mqttConfig, node);
                } catch (error) {
                    const errorMsg = `MQTT initialization failed: ${(error as Error).message}`;
                    logger.error(errorMsg);
                    diagnostic.emit("error", "node.init_failed", { nodeInstanceId, phase: "mqtt_initialization", error: { message: (error as Error).message } });
                    if (modbusClient) {
                        if (isMultiBoardMode && currentBoardId) ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
                        else ClientRegistry.releaseClientV2("modbus", node);
                    }
                    node.status({ fill: "red", shape: "ring", text: "MQTT connection failed" });
                    return;
                }
                if (initPhase === "closed") {
                    if (mqttClient) {
                        if (config.mqttBroker === "thingsboard") ClientRegistry.releaseClient("thingsboard", node);
                        else ClientRegistry.releaseClient("local", node);
                    }
                    if (isMultiBoardMode && currentBoardId) ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
                    else ClientRegistry.releaseClientV2("modbus", node);
                    return;
                }

                if (!modbusClient || !mqttClient) {
                    node.error(ERROR_MESSAGES.CLIENT_INIT_FAILED);
                    node.status({ fill: "red", shape: "ring", text: ERROR_MESSAGES.CLIENT_INIT_FAILED });
                    return;
                }

                // Initialize services
                const modbusService = new ModbusService(serviceOptions, modbusClient, scalingUtils);
                mqttService = new MqttService(serviceOptions, mqttClient, publishTopic);
                messageHandler = new MessageHandler(serviceOptions, { nodeInstanceId, brokerRole: config.mqttBroker, deviceId: deviceIdForDiag });
                const luoiHandler = new LuoiMappingHandler(node, modbusService, validationService, mqttService);
                rpcHandler = new RpcHandler(
                    serviceOptions,
                    configService,
                    validationService,
                    modbusService,
                    mqttService,
                    luoiHandler
                );
                rpcHandler.setWaterHammerDelayMs(resolveWaterHammerDelayMs(config.waterHammerDelay));

                // Connect to ProtectionGateService if available
                const globalContext = node.context().global;
                const protectionGate = globalContext.get('protectionGateService') as ProtectionGateService | undefined;
                if (protectionGate) {
                    rpcHandler.setProtectionGate(protectionGate);
                    logger.log("ProtectionGateService connected to RpcHandler");
                } else {
                    logger.log("ProtectionGateService not found in global context — protection disabled for RPC");
                }

                const detachMqttMessageHandler = attachRpcMqttMessageHandler(mqttClient, async ({ message }: { message: MqttMessage }) => {
                    lastReceivedAt = new Date().toISOString();
                    await messageHandler!.processMqttMessage(
                        message,
                        subscribeTopic,
                        async (payload: any, traceContext?: TraceContext) => {
                            lastRpcStartedAt = new Date().toISOString();
                            await rpcHandler!.handleRpcRequest(payload, 3, traceContext);
                            lastExecutionFinishedAt = new Date().toISOString();
                        },
                        { nodeInstanceId, brokerRole: config.mqttBroker, deviceId: deviceIdForDiag }
                    );
                }, error => {
                    logger.error(`Error processing MQTT message: ${(error as Error).message}`);
                    diagnostic.emit("error", "rpc.ingress_failed", { nodeInstanceId, error: { message: (error as Error).message } });
                });
                handlerAttached = true;
                diagnostic.emit("info", "mqtt.handler_attached", { nodeInstanceId, topic: subscribeTopic });

                // Install all listeners before the first subscription attempt.
                const setupSubscription = async (isRetry = false): Promise<boolean> => {
                    if (subscriptionAttemptInProgress || initPhase === "closed") return false;
                    subscriptionAttemptInProgress = true;
                    subscriptionState = "pending";
                    diagnostic.emit("info", "mqtt.subscribe_started", { nodeInstanceId, brokerRole: config.mqttBroker, topic: subscribeTopic, retry: isRetry });
                    try {
                        if (!mqttClient) throw new Error("MQTT client is null after initialization");
                        if (!mqttClient.isConnected()) {
                            try {
                                await mqttClient.waitForConnection(10000);
                            } catch (error) {
                                mqttClient.resetCircuitBreaker?.();
                                throw error;
                            }
                        }
                        if (initPhase === "closed") return false;

                        for (let attempt = 1; attempt <= 5; attempt++) {
                            try {
                                await mqttClient.subscribe(subscribeTopic);
                                if (initPhase === "closed") return false;
                                subscriptionState = "subscribed";
                                initPhase = "ready";
                                diagnostic.emit("info", "mqtt.subscribe_succeeded", { nodeInstanceId, topic: subscribeTopic, retry: isRetry });
                                diagnostic.emit("info", "node.ready", { nodeInstanceId, handlerAttached, inputHandlerAttached, subscriptionState });
                                node.status({ fill: "green", shape: "dot", text: "Ready - Listening for MQTT messages" });
                                if (subscriptionRetryInterval) clearInterval(subscriptionRetryInterval);
                                subscriptionRetryInterval = null;
                                node.context().set("subscriptionRetryInterval", null);
                                if (subscriptionRecoveryTimeout) clearTimeout(subscriptionRecoveryTimeout);
                                subscriptionRecoveryTimeout = null;
                                if (recoveryStatusListener) mqttClient.removeListener?.("mqtt-status", recoveryStatusListener);
                                recoveryStatusListener = undefined;
                                return true;
                            } catch (error) {
                                logger.error(`Failed to subscribe (${attempt}/5): ${(error as Error).message}`);
                                if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 2000));
                            }
                        }
                        throw new Error(`Failed to subscribe to ${subscribeTopic} after 5 attempts`);
                    } catch (error) {
                        if (initPhase === "closed") return false;
                        subscriptionState = "failed";
                        initPhase = "subscription_wait";
                        diagnostic.emit("error", "mqtt.subscribe_failed", {
                            nodeInstanceId,
                            topic: subscribeTopic,
                            retry: isRetry,
                            error: { message: (error as Error).message },
                        });
                        if (initPhase !== "closed" && !subscriptionRetryInterval) {
                            subscriptionRetryInterval = setInterval(() => { void setupSubscription(true); }, 30000);
                            node.context().set("subscriptionRetryInterval", subscriptionRetryInterval);
                        }
                        return false;
                    } finally {
                        subscriptionAttemptInProgress = false;
                    }
                };

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
                            logger.log(`Config change detected: ${changeDescription}`);

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
                                modbusClient = await ClientRegistry.getModbusClientV2(boardToUse, node);
                            } else {
                                // Single mode reload
                                const reloaded = await ClientRegistry.reloadModbusConfig(newConfig.config, node);
                                if (reloaded) {
                                    modbusClient = await ClientRegistry.getModbusClientV2(newConfig.config, node);
                                }
                            }

                            // Update service with new client
                            if (modbusService && modbusClient) {
                                (modbusService as any).modbusClient = modbusClient;
                            }

                            currentModbusConfig = { ...newConfig };
                            isMultiBoardMode = newConfig.mode === 'multi';

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
                logger.log(`Initialized: ${config.mqttBroker} | topic=${subscribeTopic}`);

                // Handle input messages for dynamic configuration updates and RPC commands
                node.on('input', async (msg: any) => {
                    lastReceivedAt = new Date().toISOString();
                    logger.log('Input message received');
                    node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.MESSAGE_RECEIVED });

                    // Handle manual Modbus config reload command
                    if (msg.topic === 'reload-modbus-config' || msg.payload === 'reload-modbus-config') {
                        logger.log("Manual Modbus config reload requested");

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
                                modbusClient = await ClientRegistry.getModbusClientV2(boardToUse, node);
                            } else {
                                const reloaded = await ClientRegistry.reloadModbusConfig(newConfig.config, node);
                                if (reloaded) {
                                    modbusClient = await ClientRegistry.getModbusClientV2(newConfig.config, node);
                                }
                            }

                            if (modbusService && modbusClient) {
                                (modbusService as any).modbusClient = modbusClient;
                            }
                            currentModbusConfig = { ...newConfig };

                            logger.log("Manual reload completed");
                        } catch (error) {
                            logger.error(`Manual reload failed: ${(error as Error).message}`);
                        }
                        return;
                    }

                    // Handle RPC commands from input
                    if ((msg.payload && typeof msg.payload === 'object' && (msg.payload.method === 'set_state' || msg.payload.method === 'set_state_batch')) ||
                        (typeof msg.method === 'string' && (msg.method === 'set_state' || msg.method === 'set_state_batch'))) {

                        const inputTrace = createTraceContext({
                            runtimeBootId,
                            nodeId: node.id,
                            nodeInstanceId,
                            ingress: "node_input",
                            brokerRole: "none",
                            deviceId: deviceIdForDiag,
                            payload: msg.payload ?? { method: msg.method, params: msg.params },
                            nodeRedMessageId: msg._msgid,
                        });
                        diagnostic.emit("info", "rpc.received", { ...inputTrace, method: msg.payload?.method || msg.method });
                        let rpcBody: RpcMessage;
                        try {
                            if (typeof msg.payload === 'object' && (msg.payload.method === 'set_state' || msg.payload.method === 'set_state_batch')) {
                                rpcBody = msg.payload;
                            } else if (typeof msg.method === 'string' && (msg.method === 'set_state' || msg.method === 'set_state_batch') && msg.params) {
                                rpcBody = {
                                    method: msg.method,
                                    params: msg.params,
                                    timeout: msg.timeout
                                };
                            } else {
                                throw new Error(ERROR_MESSAGES.INVALID_RPC_FORMAT);
                            }
                        } catch (error) {
                            logger.error(ERROR_MESSAGES.RPC_INPUT_FAILED + `: ${(error as Error).message}`);
                            diagnostic.emit("error", "rpc.parse_failed", { ...inputTrace, disposition: "rejected", error: { message: (error as Error).message } });
                            node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.RPC_INPUT_ERROR });
                            return;
                        }

                        const attached = attachBusinessRequestId(inputTrace, rpcBody);
                        const traceContext = attached.context;
                        if (attached.invalidSource) diagnostic.emit("warn", "rpc.request_id_invalid", { ...traceContext, source: attached.invalidSource });
                        diagnostic.emit("info", "rpc.accepted", { ...traceContext, method: rpcBody.method, disposition: "accepted" });
                        node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.PROCESSING_RPC_INPUT });
                        lastRpcStartedAt = new Date().toISOString();
                        try {
                            await rpcHandler!.handleRpcRequest(rpcBody, 3, traceContext);
                            lastExecutionFinishedAt = new Date().toISOString();
                        } catch (error) {
                            logger.error(ERROR_MESSAGES.RPC_INPUT_FAILED + `: ${(error as Error).message}`);
                            diagnostic.emit("error", "rpc.ingress_failed", { ...traceContext, error: { message: (error as Error).message } });
                            node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.RPC_INPUT_ERROR });
                        }
                    }
                });
                inputHandlerAttached = true;



                // Cleanup when node is removed
                node.on('close', async (done: () => void) => {
                    try {
                        // Stop config check interval
                        if (configCheckInterval) {
                            clearInterval(configCheckInterval);
                            configCheckInterval = null;
                            logger.log("[CLEANUP] Config check interval stopped");
                        }

                        // Stop subscription retry interval if exists
                        const storedRetryInterval = node.context().get('subscriptionRetryInterval') as NodeJS.Timeout | undefined;
                        if (subscriptionRetryInterval || storedRetryInterval) {
                            clearInterval(subscriptionRetryInterval || storedRetryInterval);
                            subscriptionRetryInterval = null;
                            node.context().set("subscriptionRetryInterval", null);
                            logger.log("[CLEANUP] Subscription retry interval stopped");
                        }
                        if (subscriptionRecoveryTimeout) {
                            clearTimeout(subscriptionRecoveryTimeout);
                            subscriptionRecoveryTimeout = null;
                        }
                        if (recoveryStatusListener) {
                            mqttClient.removeListener?.("mqtt-status", recoveryStatusListener);
                            recoveryStatusListener = undefined;
                        }

                        // Clear all timeouts and caches
                        mqttService.clearAllTimeouts();
                        messageHandler.clearProcessedMessages();
                        configService.clearNodeConfigs();
                        detachMqttMessageHandler();

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
                        initPhase = "closed";
                        done();
                    } catch (error) {
                        logger.error(`Cleanup error: ${(error as Error).message}`);
                        done();
                    }
                });

                // Attach ingress and cleanup listeners before waiting for MQTT subscription.
                const subscribed = await setupSubscription();
                if (!subscribed && initPhase !== "closed") {
                    node.status({ fill: "red", shape: "ring", text: ERROR_MESSAGES.SUBSCRIPTION_FAILED });
                    subscriptionRecoveryTimeout = setTimeout(() => {
                        if (initPhase === "closed") return;
                        if (mqttClient.isConnected()) {
                            void setupSubscription(true);
                            return;
                        }
                        recoveryStatusListener = ({ status }: any) => {
                            if (initPhase === "closed") return;
                            if (status === "connected") {
                                void setupSubscription(true);
                            } else if (status === "disconnected") {
                                node.status({ fill: "yellow", shape: "ring", text: "Disconnected - recovering" });
                                setTimeout(() => mqttClient.resetCircuitBreaker?.(), 1000);
                            }
                        };
                        mqttClient.once("mqtt-status", recoveryStatusListener);
                    }, 3000);
                }

            } catch (error) {
                logger.error(`Node initialization failed: ${(error as Error).message}`);
                if (initPhase !== "closed") initPhase = "failed";
                diagnostic.emit("error", "node.init_failed", { nodeInstanceId, phase: initPhase, error: { message: (error as Error).message } });
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            logger.error(`Async initialization failed: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
    }

    RED.nodes.registerType("viis-rpc-control", ViisRpcControlNode);
};

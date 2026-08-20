"use strict";
/**
 * Refactored viis-telemetry node with improved architecture
 * Clean, maintainable, and debuggable implementation following Google standards
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const viis_telemetry_config_1 = require("./viis-telemetry-config");
const viis_telemetry_connection_manager_1 = require("./viis-telemetry-connection-manager");
const viis_telemetry_polling_service_1 = require("./viis-telemetry-polling-service");
const viis_telemetry_processor_1 = require("./viis-telemetry-processor");
const viis_telemetry_constants_1 = require("./viis-telemetry-constants");
const global_context_helper_1 = require("../../ultils/global-context-helper");
const demeter_mqtt_topics_1 = require("../../core/demeter-mqtt-topics");
/**
 * Register viis-telemetry node with Node-RED
 */
module.exports = function (RED) {
    /**
     * API endpoint to get Modbus keys from environment variables
     */
    RED.httpAdmin.get('/viis-telemetry/modbus-keys', (_req, res) => {
        try {
            // Create a temporary global context helper for the HTTP endpoint
            const tempNodeContext = {
                global: {
                    get: (key) => { var _a; return (_a = RED.settings.functionGlobalContext) === null || _a === void 0 ? void 0 : _a[key]; }
                }
            };
            const globalHelper = new global_context_helper_1.GlobalContextHelper(tempNodeContext);
            const modbusCoils = globalHelper.getJsonEnvVar('MODBUS_COILS', {});
            const modbusInputRegisters = globalHelper.getJsonEnvVar('MODBUS_INPUT_REGISTERS', {});
            const modbusHoldingRegisters = globalHelper.getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {});
            const keys = [
                ...Object.keys(modbusHoldingRegisters),
                ...Object.keys(modbusInputRegisters),
                ...Object.keys(modbusCoils)
            ];
            // Remove duplicates and sort
            const uniqueKeys = [...new Set(keys)].sort();
            res.json({
                success: true,
                keys: uniqueKeys,
                count: uniqueKeys.length,
                sources: {
                    holdingRegisters: Object.keys(modbusHoldingRegisters).length,
                    inputRegisters: Object.keys(modbusInputRegisters).length,
                    coils: Object.keys(modbusCoils).length
                }
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                error: error.message,
                keys: []
            });
        }
    });
    /**
     * Main viis-telemetry node implementation
     */
    function ViisTelemetryNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext = this.context();
        const flowContext = this.context().flow;
        // Initialize GlobalContextHelper
        const globalHelper = new global_context_helper_1.GlobalContextHelper(this.context());
        // Multi-board state variables (declared at function scope for cleanup access)
        let currentBoardId = config.boardId;
        let isMultiBoardMode = false;
        let currentModbusConfig;
        // Variables to store clients for cleanup
        let thingsboardMqttClient = null;
        // Wrap async initialization in IIFE to avoid Node-RED registration issues
        (async () => {
            try {
                // Initialize configuration manager
                const configManager = new viis_telemetry_config_1.ViisTelemetryConfigManager(config, nodeContext);
                const pollingConfig = configManager.getPollingConfig();
                const envConfig = configManager.getEnvironmentConfig();
                const mqttTopicConfig = configManager.getMqttTopicConfig(envConfig.deviceId);
                // Initialize context
                nodeContext.set(viis_telemetry_constants_1.CONTEXT_KEYS.PREVIOUS_STATE, {});
                nodeContext.set(viis_telemetry_constants_1.CONTEXT_KEYS.LAST_SENT, 0);
                nodeContext.set(viis_telemetry_constants_1.CONTEXT_KEYS.LAST_EC_UPDATE, nodeContext.get(viis_telemetry_constants_1.CONTEXT_KEYS.LAST_EC_UPDATE) || 0);
                nodeContext.set(viis_telemetry_constants_1.CONTEXT_KEYS.MAIN_PUMP_STATE, nodeContext.get(viis_telemetry_constants_1.CONTEXT_KEYS.MAIN_PUMP_STATE) || false);
                // Setup flow context for debug and threshold config
                const debugLogKey = `${viis_telemetry_constants_1.CONTEXT_KEYS.DEBUG_LOG}_${node.id}`;
                const thresholdConfigKey = `${viis_telemetry_constants_1.CONTEXT_KEYS.THRESHOLD_CONFIG}_${node.id}`;
                flowContext.set(debugLogKey, configManager.getDebugLogEnabled());
                flowContext.set(thresholdConfigKey, configManager.getThresholdConfig());
                // Load SCALE_CONFIGS from env and merge with existing global context
                const scaleConfigsJson = globalHelper.getEnvVar('SCALE_CONFIGS', '[]');
                try {
                    const newScaleConfigs = JSON.parse(scaleConfigsJson);
                    const existingConfigs = (nodeContext.global.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS) || []);
                    // Merge using key+direction as unique identifier
                    const configMap = new Map();
                    for (const config of existingConfigs) {
                        const uniqueKey = `${config.key}_${config.direction}`;
                        configMap.set(uniqueKey, config);
                    }
                    for (const config of newScaleConfigs) {
                        const uniqueKey = `${config.key}_${config.direction}`;
                        configMap.set(uniqueKey, config);
                    }
                    const mergedConfigs = Array.from(configMap.values());
                    nodeContext.global.set(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS, mergedConfigs);
                    node.log(`Merged scale configs (${existingConfigs.length} existing + ${newScaleConfigs.length} from env = ${mergedConfigs.length} total)`);
                }
                catch (error) {
                    node.warn(`Failed to parse SCALE_CONFIGS: ${error.message}`);
                    // Don't overwrite existing configs on parse error
                }
                // Create client configurations
                const configData = readModbusConfig(globalHelper);
                currentModbusConfig = Object.assign({}, configData);
                // Auto-detect mode
                if (configData.mode === 'multi') {
                    isMultiBoardMode = true;
                    node.log(`Multi-board mode detected with ${configData.boards.length} boards`);
                    const multiConfig = {
                        mode: 'multi',
                        defaultBoard: configData.defaultBoard,
                        boards: configData.boards
                    };
                    client_registry_1.default.initializeMultiBoardConfig(multiConfig, node);
                }
                else {
                    isMultiBoardMode = false;
                    node.log(`Single-board mode`);
                }
                const localMqttConfig = createLocalMqttConfig(globalHelper, envConfig.deviceId);
                const thingsboardMqttConfig = createThingsboardMqttConfig(globalHelper, envConfig.deviceId);
                const mysqlConfig = createMySqlConfig(globalHelper);
                // Get clients from registry
                let modbusClient;
                if (isMultiBoardMode) {
                    const boardToUse = currentBoardId || configData.defaultBoard;
                    node.log(`Getting client for board: ${boardToUse}`);
                    modbusClient = client_registry_1.default.getModbusClientV2(boardToUse, node);
                }
                else {
                    modbusClient = client_registry_1.default.getModbusClientV2(configData.config, node);
                }
                const localMqttClient = await client_registry_1.default.getLocalMqttClient(localMqttConfig, node);
                thingsboardMqttClient = await client_registry_1.default.getThingsboardMqttClient(thingsboardMqttConfig, node);
                const mysqlClient = await client_registry_1.default.getMySqlClient(mysqlConfig, node);
                if (!modbusClient || !localMqttClient || !thingsboardMqttClient || !mysqlClient) {
                    node.error("Failed to retrieve clients from registry");
                    node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
                    return;
                }
                // Initialize connection manager
                const connectionManager = new viis_telemetry_connection_manager_1.ViisTelemetryConnectionManager(node, modbusClient, localMqttClient, thingsboardMqttClient, mysqlClient);
                // Initialize polling service
                const pollingService = new viis_telemetry_polling_service_1.ViisTelemetryPollingService(node, nodeContext, modbusClient, currentBoardId, envConfig.deviceId);
                // Initialize telemetry processor
                const processorConfig = {
                    emqxTopic: mqttTopicConfig.emqx,
                    thingsboardTopic: mqttTopicConfig.thingsboard,
                    debugLogKey,
                    thresholdConfigKey,
                };
                const periodicSnapshotConfig = {
                    coil: pollingConfig.coil.periodicSnapshotInterval,
                    input: pollingConfig.input.periodicSnapshotInterval,
                    holding: pollingConfig.holding.periodicSnapshotInterval,
                };
                const telemetryProcessor = new viis_telemetry_processor_1.ViisTelemetryProcessor(node, nodeContext, flowContext, localMqttClient, thingsboardMqttClient, processorConfig, periodicSnapshotConfig);
                // Setup event handlers
                setupEventHandlers(node, connectionManager, pollingService, telemetryProcessor, pollingConfig, envConfig);
                // Setup input message handler
                setupInputHandler(node, telemetryProcessor, flowContext, debugLogKey, thresholdConfigKey, pollingService);
                // Setup cleanup handler
                setupCleanupHandler(node, pollingService, connectionManager, thingsboardMqttClient, flowContext, debugLogKey, thresholdConfigKey, isMultiBoardMode, currentBoardId);
                // Start polling if all clients are connected
                if (connectionManager.areAllClientsConnected()) {
                    startPolling(pollingService, pollingConfig, envConfig);
                    node.status({ fill: "green", shape: "dot", text: "Polling started" });
                }
                else {
                    node.status({ fill: "red", shape: "ring", text: "Waiting for all clients to connect" });
                }
            }
            catch (error) {
                node.error(`Node initialization failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            node.error(`Async initialization failed: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
    }
    /**
     * Read Modbus configuration with multi-board support
     */
    function readModbusConfig(globalHelper) {
        const boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);
        if (boardsConfig) {
            try {
                let boards;
                // Handle both already-parsed array and JSON string
                if (Array.isArray(boardsConfig)) {
                    boards = boardsConfig;
                }
                else if (typeof boardsConfig === 'string') {
                    boards = JSON.parse(boardsConfig);
                }
                else {
                    // Invalid type, fall through to single mode
                    boards = null;
                }
                if (Array.isArray(boards) && boards.length > 0) {
                    return {
                        mode: 'multi',
                        boards: boards,
                        defaultBoard: globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id)
                    };
                }
            }
            catch (e) {
                // Ignore parse errors, fall through to single mode
            }
        }
        return {
            mode: 'single',
            config: {
                type: globalHelper.getEnvVar('MODBUS_TYPE', 'TCP'),
                host: globalHelper.getEnvVar('MODBUS_HOST', 'localhost'),
                tcpPort: globalHelper.getNumericEnvVar('MODBUS_TCP_PORT', 502),
                serialPort: globalHelper.getEnvVar('MODBUS_SERIAL_PORT', '/dev/ttyUSB0'),
                baudRate: globalHelper.getNumericEnvVar('MODBUS_BAUD_RATE', 9600),
                parity: globalHelper.getEnvVar('MODBUS_PARITY', 'none'),
                unitId: globalHelper.getNumericEnvVar('MODBUS_UNIT_ID', 1),
                timeout: globalHelper.getNumericEnvVar('MODBUS_TIMEOUT', 5000),
                reconnectInterval: globalHelper.getNumericEnvVar('MODBUS_RECONNECT_INTERVAL', 5000),
            }
        };
    }
    /**
     * Create local MQTT configuration
     */
    function createLocalMqttConfig(globalHelper, _deviceId) {
        const host = globalHelper.getEnvVar('EMQX_HOST', 'emqx');
        const port = globalHelper.getNumericEnvVar('EMQX_PORT', 1883);
        return {
            broker: `mqtt://${host}:${port}`,
            clientId: `node-red-local-${Math.random().toString(16).substring(2, 10)}`,
            username: globalHelper.getEnvVar('EMQX_USERNAME', ''),
            password: globalHelper.getEnvVar('EMQX_PASSWORD', ''),
            qos: 1,
        };
    }
    /**
     * Create ThingsBoard MQTT configuration with validation
     */
    function createThingsboardMqttConfig(globalHelper, deviceId) {
        const host = globalHelper.getEnvVar('THINGSBOARD_HOST', demeter_mqtt_topics_1.DEFAULT_MQTT_HOST);
        const port = globalHelper.getEnvVar('THINGSBOARD_PORT', demeter_mqtt_topics_1.DEFAULT_MQTT_PORT);
        const deviceToken = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
        const password = globalHelper.getEnvVar('THINGSBOARD_PASSWORD', '');
        // Validate critical configuration
        if (!deviceToken || deviceToken.trim() === '') {
            throw new Error('DEVICE_ACCESS_TOKEN is required for ThingsBoard MQTT connection');
        }
        // Log configuration for debugging (without sensitive data)
        console.log(`[THINGSBOARD-CONFIG] Host: ${host}:${port}, Token: ${deviceToken.substring(0, 8)}...`);
        return {
            broker: `mqtt://${host}:${port}`,
            deviceId,
            clientId: `node-red-thingsboard-telemetry-${Math.random().toString(16).substring(2, 10)}`,
            username: deviceToken,
            password: password,
            qos: 1,
            // Enhanced connection settings for stability
            connectTimeout: 30000,
            keepalive: 60,
            maxReconnectAttempts: 15, // Increased from default 10
            reconnectBackoffMultiplier: 1.5,
            maxReconnectDelay: 60000,
            enableCircuitBreaker: true
        };
    }
    /**
     * Create MySQL configuration
     */
    function createMySqlConfig(globalHelper) {
        return {
            host: globalHelper.getEnvVar('DATABASE_HOST', 'localhost'),
            port: globalHelper.getNumericEnvVar('DATABASE_PORT', 3306),
            user: globalHelper.getEnvVar('DATABASE_USER', 'root'),
            password: globalHelper.getEnvVar('DATABASE_PASSWORD', ''),
            database: globalHelper.getEnvVar('DATABASE_NAME', 'your_database'),
            connectionLimit: globalHelper.getNumericEnvVar('DATABASE_CONNECTION_LIMIT', 10),
        };
    }
    /**
     * Setup event handlers for connection and telemetry processing
     */
    function setupEventHandlers(node, connectionManager, pollingService, telemetryProcessor, pollingConfig, envConfig) {
        // Handle connection status changes
        connectionManager.on('all-connected', () => {
            pollingService.resumePolling();
            startPolling(pollingService, pollingConfig, envConfig);
            node.status({ fill: "green", shape: "dot", text: "All clients connected, polling resumed" });
        });
        connectionManager.on('any-disconnected', () => {
            pollingService.pausePolling();
            node.status({ fill: "red", shape: "ring", text: "Client disconnected, polling paused" });
        });
        // Handle telemetry data from polling service
        pollingService.on('telemetry-data', async (event) => {
            try {
                await telemetryProcessor.processTelemetryData(event);
            }
            catch (error) {
                node.error(`Failed to process telemetry data: ${error.message}`);
            }
        });
    }
    /**
     * Start polling for all register types
     */
    function startPolling(pollingService, pollingConfig, envConfig) {
        pollingService.startPolling(pollingConfig.coil, pollingConfig.input, pollingConfig.holding, {
            coils: envConfig.modbusCoils,
            inputRegisters: envConfig.modbusInputRegisters,
            holdingRegisters: envConfig.modbusHoldingRegisters,
        });
    }
    /**
     * Setup input message handler for dynamic configuration updates
     */
    function setupInputHandler(node, telemetryProcessor, _flowContext, _debugLogKey, _thresholdConfigKey, pollingService) {
        node.on('input', (msg) => {
            try {
                // Handle debug log setting update
                if (typeof msg.enableDebugLog === 'boolean') {
                    telemetryProcessor.updateDebugLogSetting(msg.enableDebugLog);
                }
                // Handle threshold configuration update
                if (msg.thresholdConfig) {
                    let newThresholdConfig = typeof msg.thresholdConfig === 'object'
                        ? msg.thresholdConfig
                        : JSON.parse(msg.thresholdConfig);
                    if (typeof newThresholdConfig !== 'object' || Array.isArray(newThresholdConfig)) {
                        newThresholdConfig = {};
                    }
                    // PMR-005: bracket the config update with setConfigUpdating so the polling
                    // service's finally-blocks fire resetPreviousState() on the next poll cycle.
                    pollingService.setConfigUpdating(true);
                    try {
                        telemetryProcessor.updateThresholdConfig(newThresholdConfig);
                    }
                    finally {
                        pollingService.setConfigUpdating(false);
                    }
                }
            }
            catch (error) {
                node.error(`Failed to process input message: ${error.message}`);
            }
        });
    }
    /**
     * Setup cleanup handler for node shutdown
     */
    function setupCleanupHandler(node, pollingService, connectionManager, thingsboardMqttClient, flowContext, debugLogKey, thresholdConfigKey, isMultiBoardMode, currentBoardId) {
        node.on('close', async (done) => {
            try {
                // Stop polling
                pollingService.stopPolling();
                // Cleanup connection manager
                connectionManager.cleanup();
                // Clear flow context
                flowContext.set(debugLogKey, false);
                flowContext.set(thresholdConfigKey, {});
                // Release clients
                if (isMultiBoardMode && currentBoardId) {
                    client_registry_1.default.releaseClientV2('modbus-board', node, currentBoardId);
                }
                else {
                    client_registry_1.default.releaseClientV2('modbus', node);
                }
                client_registry_1.default.releaseClient('local', node);
                client_registry_1.default.releaseClient('mysql', node);
                // Disconnect ThingsBoard client via registry (not direct)
                client_registry_1.default.releaseClient('thingsboard', node);
                node.log('[Node] Closed and cleaned up successfully');
                done();
            }
            catch (error) {
                node.error(`Cleanup error: ${error.message}`);
                done();
            }
        });
    }
    // Register the node type with Node-RED
    RED.nodes.registerType("viis-telemetry", ViisTelemetryNode);
};

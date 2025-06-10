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
                // Create client configurations
                const modbusConfig = createModbusConfig(globalHelper);
                const localMqttConfig = createLocalMqttConfig(globalHelper, envConfig.deviceId);
                const thingsboardMqttConfig = createThingsboardMqttConfig(globalHelper);
                const mysqlConfig = createMySqlConfig(globalHelper);
                // Get clients from registry
                const modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
                const localMqttClient = await client_registry_1.default.getLocalMqttClient(localMqttConfig, node);
                const thingsboardMqttClient = await client_registry_1.default.getThingsboardMqttClient(thingsboardMqttConfig, node);
                const mysqlClient = await client_registry_1.default.getMySqlClient(mysqlConfig, node);
                if (!modbusClient || !localMqttClient || !thingsboardMqttClient || !mysqlClient) {
                    node.error("Failed to retrieve clients from registry");
                    node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
                    return;
                }
                // Initialize connection manager
                const connectionManager = new viis_telemetry_connection_manager_1.ViisTelemetryConnectionManager(node, modbusClient, localMqttClient, thingsboardMqttClient, mysqlClient);
                // Initialize polling service
                const pollingService = new viis_telemetry_polling_service_1.ViisTelemetryPollingService(node, nodeContext, modbusClient);
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
                setupInputHandler(node, telemetryProcessor, flowContext, debugLogKey, thresholdConfigKey);
                // Setup cleanup handler
                setupCleanupHandler(node, pollingService, connectionManager, thingsboardMqttClient, flowContext, debugLogKey, thresholdConfigKey);
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
     * Create Modbus configuration from environment variables
     */
    function createModbusConfig(globalHelper) {
        return {
            type: globalHelper.getEnvVar('MODBUS_TYPE', 'TCP'),
            host: globalHelper.getEnvVar('MODBUS_HOST', 'localhost'),
            tcpPort: globalHelper.getNumericEnvVar('MODBUS_TCP_PORT', 502),
            serialPort: globalHelper.getEnvVar('MODBUS_SERIAL_PORT', '/dev/ttyUSB0'),
            baudRate: globalHelper.getNumericEnvVar('MODBUS_BAUD_RATE', 9600),
            parity: globalHelper.getEnvVar('MODBUS_PARITY', 'none'),
            unitId: globalHelper.getNumericEnvVar('MODBUS_UNIT_ID', 1),
            timeout: globalHelper.getNumericEnvVar('MODBUS_TIMEOUT', 5000),
            reconnectInterval: globalHelper.getNumericEnvVar('MODBUS_RECONNECT_INTERVAL', 5000),
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
    function createThingsboardMqttConfig(globalHelper) {
        const host = globalHelper.getEnvVar('THINGSBOARD_HOST', 'mqtt.viis.tech');
        const port = globalHelper.getEnvVar('THINGSBOARD_PORT', '1883');
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
    function setupInputHandler(node, telemetryProcessor, _flowContext, _debugLogKey, _thresholdConfigKey) {
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
                    telemetryProcessor.updateThresholdConfig(newThresholdConfig);
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
    function setupCleanupHandler(node, pollingService, connectionManager, thingsboardMqttClient, flowContext, debugLogKey, thresholdConfigKey) {
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
                client_registry_1.default.releaseClient('modbus', node);
                client_registry_1.default.releaseClient('local', node);
                client_registry_1.default.releaseClient('mysql', node);
                // Disconnect ThingsBoard client
                thingsboardMqttClient.disconnect();
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

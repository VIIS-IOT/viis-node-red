"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const modbusPollerService_1 = require("./services/modbusPollerService");
const telemetryService_1 = require("./services/telemetryService");
const databaseService_1 = require("./services/databaseService");
const thresholdChecker_1 = require("./utils/thresholdChecker");
const logger_1 = require("./utils/logger");
const constants_1 = require("./constants");
module.exports = function (RED) {
    function ViisModbusPollerNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let modbusPollerService = null;
        let logger = null;
        let configCheckInterval = null;
        let currentModbusConfig = null;
        // Initialize node
        (async () => {
            try {
                node.status({ fill: "yellow", shape: "ring", text: constants_1.STATUS_MESSAGES.INITIALIZING });
                // Initialize logger
                logger = new logger_1.Logger(node, config.enableDebugLog);
                logger.log("Initializing VIIS Modbus Poller Node");
                // Initialize global context helper
                const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
                // Get environment configuration
                const environmentConfig = getEnvironmentConfig(globalHelper);
                logger.debug(`Environment config loaded: ${JSON.stringify(environmentConfig)}`);
                // Parse threshold configuration
                const thresholdConfig = parseThresholdConfig(config.thresholdConfig, logger);
                // Create Modbus client configuration
                const modbusConfig = createModbusConfig(globalHelper);
                currentModbusConfig = Object.assign({}, modbusConfig); // Store for hot-reload detection
                logger.debug(`Modbus config: ${modbusConfig.type} ${modbusConfig.host}:${modbusConfig.tcpPort}`);
                // Create MQTT client configurations
                const thingsboardMqttConfig = createThingsboardMqttConfig(globalHelper);
                const emqxMqttConfig = createEmqxMqttConfig(globalHelper);
                // Get shared clients from registry
                logger.log("Getting shared clients from ClientRegistry...");
                client_registry_1.default.logConnectionCounts(node);
                let modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
                if (!modbusClient) {
                    throw new Error(constants_1.ERROR_MESSAGES.MODBUS_CLIENT_INIT_FAILED);
                }
                const thingsboardMqttClient = await client_registry_1.default.getThingsboardMqttClient(thingsboardMqttConfig, node);
                if (!thingsboardMqttClient) {
                    throw new Error(constants_1.ERROR_MESSAGES.MQTT_CLIENT_INIT_FAILED);
                }
                const emqxMqttClient = await client_registry_1.default.getLocalMqttClient(emqxMqttConfig, node);
                if (!emqxMqttClient) {
                    throw new Error(constants_1.ERROR_MESSAGES.MQTT_CLIENT_INIT_FAILED);
                }
                logger.log("All clients initialized successfully");
                // Validate single modbus connection requirement
                const isValidConnection = client_registry_1.default.validateSingleModbusConnection(node);
                if (!isValidConnection) {
                    throw new Error("CRITICAL: Multiple modbus connections detected! This violates system requirements.");
                }
                // Initialize database service
                const databaseService = new databaseService_1.DatabaseService(logger);
                // Initialize services
                const telemetryService = new telemetryService_1.TelemetryService(logger, databaseService, thingsboardMqttClient, emqxMqttClient, environmentConfig.deviceId);
                modbusPollerService = new modbusPollerService_1.ModbusPollerService(node, logger, modbusClient, telemetryService, environmentConfig);
                // Initialize services
                await modbusPollerService.initialize();
                // Update configurations
                modbusPollerService.updateConfigurations({
                    interval: config.coilPollingInterval || constants_1.DEFAULT_CONFIG.COIL_POLLING_INTERVAL,
                    quantity: config.coilQuantity || constants_1.DEFAULT_CONFIG.COIL_QUANTITY
                }, {
                    interval: config.inputPollingInterval || constants_1.DEFAULT_CONFIG.INPUT_POLLING_INTERVAL,
                    quantity: config.inputQuantity || constants_1.DEFAULT_CONFIG.INPUT_QUANTITY
                }, {
                    interval: config.holdingPollingInterval || constants_1.DEFAULT_CONFIG.HOLDING_POLLING_INTERVAL,
                    quantity: config.holdingQuantity || constants_1.DEFAULT_CONFIG.HOLDING_QUANTITY
                }, thresholdConfig, config.periodicSnapshotInterval || constants_1.DEFAULT_CONFIG.PERIODIC_SNAPSHOT_INTERVAL);
                // Start polling
                modbusPollerService.startPolling();
                logger.log("VIIS Modbus Poller Node initialized successfully");
                // Auto-detect config changes every 30 seconds
                configCheckInterval = setInterval(async () => {
                    try {
                        const newConfig = createModbusConfig(globalHelper);
                        // Check if critical Modbus config has changed
                        const hasChanged = currentModbusConfig.host !== newConfig.host ||
                            currentModbusConfig.tcpPort !== newConfig.tcpPort ||
                            currentModbusConfig.serialPort !== newConfig.serialPort ||
                            currentModbusConfig.type !== newConfig.type;
                        if (hasChanged) {
                            logger.log("[HOT-RELOAD] Config change detected, triggering Modbus reconnection...");
                            const reloaded = await client_registry_1.default.reloadModbusConfig(newConfig, node);
                            if (reloaded && modbusPollerService) {
                                // Get updated client and update service
                                modbusClient = client_registry_1.default.getModbusClient(newConfig, node);
                                modbusPollerService.modbusClient = modbusClient;
                                currentModbusConfig = Object.assign({}, newConfig);
                                logger.log(`[HOT-RELOAD] Modbus reloaded: ${newConfig.host}:${newConfig.tcpPort}`);
                                // Show brief reload notification
                                node.status({ fill: "green", shape: "dot", text: `Reloaded: ${newConfig.host}` });
                                setTimeout(() => {
                                    node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
                                }, 3000);
                            }
                        }
                    }
                    catch (error) {
                        logger.error(`[HOT-RELOAD] Config check error: ${error.message}`);
                    }
                }, 30000); // Check every 30 seconds
                logger.log("[HOT-RELOAD] Config monitoring enabled (30s interval)");
            }
            catch (error) {
                const errorMessage = `Initialization failed: ${error.message}`;
                if (logger) {
                    logger.errorWithStack(errorMessage, error);
                }
                else {
                    node.error(errorMessage);
                }
                node.status({ fill: "red", shape: "ring", text: constants_1.STATUS_MESSAGES.ERROR });
            }
        })();
        // Handle node close
        node.on("close", (done) => {
            try {
                if (logger) {
                    logger.log("Closing VIIS Modbus Poller Node");
                }
                // Stop config check interval
                if (configCheckInterval) {
                    clearInterval(configCheckInterval);
                    configCheckInterval = null;
                    if (logger) {
                        logger.log("[CLEANUP] Config check interval stopped");
                    }
                }
                // Stop polling service
                if (modbusPollerService) {
                    modbusPollerService.stopPolling();
                }
                // Release shared clients
                client_registry_1.default.releaseClient("modbus", node);
                client_registry_1.default.releaseClient("thingsboard", node);
                client_registry_1.default.releaseClient("local", node);
                if (logger) {
                    logger.log("VIIS Modbus Poller Node closed successfully");
                }
                done();
            }
            catch (error) {
                if (logger) {
                    logger.errorWithStack("Error during node close", error);
                }
                else {
                    node.error(`Error during close: ${error.message}`);
                }
                done();
            }
        });
    }
    /**
     * Get environment configuration from global context
     */
    function getEnvironmentConfig(globalHelper) {
        const deviceId = globalHelper.getEnvVar(constants_1.ENV_KEYS.DEVICE_ID, "");
        if (!deviceId) {
            throw new Error("DEVICE_ID environment variable is required");
        }
        const modbusCoils = parseJsonEnvVar(globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_COILS, "{}"));
        const modbusInputRegisters = parseJsonEnvVar(globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_INPUT_REGISTERS, "{}"));
        const modbusHoldingRegisters = parseJsonEnvVar(globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_HOLDING_REGISTERS, "{}"));
        return {
            deviceId,
            modbusCoils,
            modbusInputRegisters,
            modbusHoldingRegisters
        };
    }
    /**
     * Parse JSON environment variable
     */
    function parseJsonEnvVar(value) {
        try {
            return JSON.parse(value) || {};
        }
        catch (_a) {
            return {};
        }
    }
    /**
     * Parse threshold configuration from string
     */
    function parseThresholdConfig(thresholdConfigStr, logger) {
        try {
            if (!thresholdConfigStr || thresholdConfigStr.trim() === "") {
                return {};
            }
            const parsed = JSON.parse(thresholdConfigStr);
            if (!thresholdChecker_1.ThresholdChecker.validateThresholdConfig(parsed)) {
                logger.warn("Invalid threshold configuration, using empty config");
                return {};
            }
            return parsed;
        }
        catch (error) {
            logger.warn(`Failed to parse threshold configuration: ${error.message}`);
            return {};
        }
    }
    /**
     * Create Modbus client configuration
     */
    function createModbusConfig(globalHelper) {
        return {
            type: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_TYPE, "TCP"),
            host: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_HOST, "localhost"),
            tcpPort: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TCP_PORT, 502),
            serialPort: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_SERIAL_PORT, "/dev/ttyUSB0"),
            baudRate: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_BAUD_RATE, 9600),
            parity: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_PARITY, "none"),
            unitId: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_UNIT_ID, 1),
            timeout: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TIMEOUT, 5000),
            reconnectInterval: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_RECONNECT_INTERVAL, 5000)
        };
    }
    /**
     * Create Thingsboard MQTT configuration
     */
    function createThingsboardMqttConfig(globalHelper) {
        const host = globalHelper.getEnvVar(constants_1.ENV_KEYS.THINGSBOARD_HOST, "mqtt.viis.tech");
        const port = globalHelper.getEnvVar(constants_1.ENV_KEYS.THINGSBOARD_PORT, "1883");
        const deviceToken = globalHelper.getEnvVar(constants_1.ENV_KEYS.DEVICE_ACCESS_TOKEN, "");
        const password = globalHelper.getEnvVar(constants_1.ENV_KEYS.THINGSBOARD_PASSWORD, "");
        return {
            broker: `mqtt://${host}:${port}`,
            clientId: `node-red-thingsboard-poller-${Math.random().toString(16).substring(2, 10)}`,
            username: deviceToken,
            password: password,
            qos: 1
        };
    }
    /**
     * Create EMQX MQTT configuration
     */
    function createEmqxMqttConfig(globalHelper) {
        const host = globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_HOST, "emqx");
        const port = globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_PORT, "1883");
        const username = globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_USERNAME, "");
        const password = globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_PASSWORD, "");
        return {
            broker: `mqtt://${host}:${port}`,
            clientId: `node-red-emqx-poller-${Math.random().toString(16).substring(2, 10)}`,
            username: username,
            password: password,
            qos: 1
        };
    }
    // Register the node
    RED.nodes.registerType("viis-modbus-poller", ViisModbusPollerNode);
};

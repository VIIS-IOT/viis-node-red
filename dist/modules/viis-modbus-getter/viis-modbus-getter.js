"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const modbusGetterService_1 = require("./services/modbusGetterService");
const logger_1 = require("./utils/logger");
const constants_1 = require("./constants");
/**
 * VIIS Modbus Getter Node
 * A custom Node-RED node for reading data from Modbus devices using shared connection resources
 */
module.exports = function (RED) {
    function ViisModbusGetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let modbusGetterService = null;
        let logger;
        let configCheckInterval = null;
        let currentModbusConfig = null;
        try {
            // Initialize logger with enableLogging flag from config
            logger = new logger_1.Logger(node, node.id, config.enableLogging);
            logger.log("Initializing VIIS Modbus Getter Node...");
            // Set initial status
            node.status({ fill: "yellow", shape: "ring", text: constants_1.STATUS_MESSAGES.INITIALIZING });
            // Initialize GlobalContextHelper for environment variables
            const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
            // Helper function to read fresh Modbus config from global context
            const readModbusConfig = () => {
                return {
                    type: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_TYPE, constants_1.DEFAULT_CONFIG.MODBUS_TYPE),
                    host: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_HOST, constants_1.DEFAULT_CONFIG.MODBUS_HOST),
                    tcpPort: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TCP_PORT, constants_1.DEFAULT_CONFIG.MODBUS_TCP_PORT),
                    serialPort: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_SERIAL_PORT, constants_1.DEFAULT_CONFIG.MODBUS_SERIAL_PORT),
                    baudRate: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_BAUD_RATE, constants_1.DEFAULT_CONFIG.MODBUS_BAUD_RATE),
                    parity: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_PARITY, constants_1.DEFAULT_CONFIG.MODBUS_PARITY),
                    unitId: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_UNIT_ID, constants_1.DEFAULT_CONFIG.MODBUS_UNIT_ID),
                    timeout: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TIMEOUT, constants_1.DEFAULT_CONFIG.MODBUS_TIMEOUT),
                    reconnectInterval: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_RECONNECT_INTERVAL, constants_1.DEFAULT_CONFIG.MODBUS_RECONNECT_INTERVAL)
                };
            };
            // Build modbus configuration from environment variables
            const modbusConfig = readModbusConfig();
            currentModbusConfig = Object.assign({}, modbusConfig); // Store for hot-reload detection
            logger.log(`Modbus config: ${modbusConfig.type} ${modbusConfig.host}:${modbusConfig.tcpPort}`);
            // Get or create shared Modbus client
            logger.log("Getting shared Modbus client from ClientRegistry...");
            client_registry_1.default.logConnectionCounts(node);
            let modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
            if (!modbusClient) {
                throw new Error("Failed to initialize Modbus client");
            }
            logger.log("Modbus client initialized successfully");
            client_registry_1.default.logConnectionCounts(node);
            // Create service options with enableLogging flag
            const serviceOptions = {
                node: node,
                nodeId: node.id,
                enableLogging: config.enableLogging
            };
            // Initialize modbus getter service
            modbusGetterService = new modbusGetterService_1.ModbusGetterService(serviceOptions, modbusClient);
            logger.log("ModbusGetterService initialized successfully");
            // Log configuration status
            if (config.enableLogging) {
                logger.log("Detailed logging is ENABLED");
            }
            else {
                logger.log("Detailed logging is DISABLED");
            }
            // Set ready status
            node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
            // Auto-detect config changes every 30 seconds
            configCheckInterval = setInterval(async () => {
                try {
                    const newConfig = readModbusConfig();
                    // Check if critical Modbus config has changed
                    const hasChanged = currentModbusConfig.host !== newConfig.host ||
                        currentModbusConfig.tcpPort !== newConfig.tcpPort ||
                        currentModbusConfig.serialPort !== newConfig.serialPort ||
                        currentModbusConfig.type !== newConfig.type;
                    if (hasChanged) {
                        logger.log("[HOT-RELOAD] Config change detected, triggering Modbus reconnection...");
                        const reloaded = await client_registry_1.default.reloadModbusConfig(newConfig, node);
                        if (reloaded) {
                            // Get updated client and update service
                            modbusClient = client_registry_1.default.getModbusClient(newConfig, node);
                            if (modbusGetterService) {
                                modbusGetterService.modbusClient = modbusClient;
                            }
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
            // Handle incoming messages
            node.on("input", async (msg, send, done) => {
                try {
                    if (!modbusGetterService) {
                        throw new Error("ModbusGetterService not initialized");
                    }
                    // Set reading status
                    node.status({ fill: "blue", shape: "dot", text: constants_1.STATUS_MESSAGES.READING });
                    // Log incoming request if logging is enabled
                    if (config.enableLogging) {
                        logger.debug(`Processing request: ${JSON.stringify(msg.payload)}`);
                    }
                    // Process the modbus request
                    const response = await modbusGetterService.processRequest(msg.payload);
                    // Update message payload with response
                    msg.payload = response;
                    // Log successful response if logging is enabled
                    if (config.enableLogging) {
                        logger.debug(`Response: ${JSON.stringify(response)}`);
                    }
                    // Send the message
                    send(msg);
                    // Set ready status
                    node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
                    // Call done to indicate completion
                    if (done) {
                        done();
                    }
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    // Always log errors regardless of enableLogging setting
                    logger.error(`Error processing request: ${errorMessage}`);
                    // Set error status
                    node.status({ fill: "red", shape: "ring", text: constants_1.STATUS_MESSAGES.ERROR });
                    // Send error response
                    msg.payload = {
                        error: errorMessage,
                        timestamp: Date.now()
                    };
                    send(msg);
                    // Call done with error
                    if (done) {
                        done(error);
                    }
                }
            });
            logger.log("VIIS Modbus Getter Node initialized successfully");
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
            if (logger) {
                logger.error(`Initialization failed: ${errorMessage}`);
            }
            else {
                node.error(`[MODBUS-GETTER-${node.id}] Initialization failed: ${errorMessage}`);
            }
            node.status({ fill: "red", shape: "ring", text: constants_1.STATUS_MESSAGES.ERROR });
            return;
        }
        // Cleanup when node is closed
        node.on("close", (done) => {
            try {
                logger.log("Closing VIIS Modbus Getter Node...");
                // Stop config check interval
                if (configCheckInterval) {
                    clearInterval(configCheckInterval);
                    configCheckInterval = null;
                    logger.log("[CLEANUP] Config check interval stopped");
                }
                // Release shared modbus client
                client_registry_1.default.releaseClient("modbus", node);
                logger.log("Modbus client released");
                // Clear service reference
                modbusGetterService = null;
                logger.log("VIIS Modbus Getter Node closed successfully");
                if (done) {
                    done();
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown cleanup error';
                logger.error(`Error during cleanup: ${errorMessage}`);
                if (done) {
                    done(error);
                }
            }
        });
    }
    // Register the node type
    RED.nodes.registerType("viis-modbus-getter", ViisModbusGetterNode);
};

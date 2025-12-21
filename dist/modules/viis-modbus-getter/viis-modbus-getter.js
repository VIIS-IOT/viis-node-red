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
        let currentBoardId = config.boardId;
        let isMultiBoardMode = false;
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
                // Check for multi-board configuration
                const boardsConfig = globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_BOARDS, null);
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
                            logger.error(`Invalid MODBUS_BOARDS type: ${typeof boardsConfig}`);
                            boards = null;
                        }
                        if (Array.isArray(boards) && boards.length > 0) {
                            // Multi-board mode
                            return {
                                mode: 'multi',
                                boards: boards,
                                defaultBoard: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_DEFAULT_BOARD, boards[0].id)
                            };
                        }
                    }
                    catch (e) {
                        logger.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                    }
                }
                // Single-board mode (backward compatible)
                return {
                    mode: 'single',
                    config: {
                        type: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_TYPE, constants_1.DEFAULT_CONFIG.MODBUS_TYPE),
                        host: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_HOST, constants_1.DEFAULT_CONFIG.MODBUS_HOST),
                        tcpPort: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TCP_PORT, constants_1.DEFAULT_CONFIG.MODBUS_TCP_PORT),
                        serialPort: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_SERIAL_PORT, constants_1.DEFAULT_CONFIG.MODBUS_SERIAL_PORT),
                        baudRate: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_BAUD_RATE, constants_1.DEFAULT_CONFIG.MODBUS_BAUD_RATE),
                        parity: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_PARITY, constants_1.DEFAULT_CONFIG.MODBUS_PARITY),
                        unitId: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_UNIT_ID, constants_1.DEFAULT_CONFIG.MODBUS_UNIT_ID),
                        timeout: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TIMEOUT, constants_1.DEFAULT_CONFIG.MODBUS_TIMEOUT),
                        reconnectInterval: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_RECONNECT_INTERVAL, constants_1.DEFAULT_CONFIG.MODBUS_RECONNECT_INTERVAL)
                    }
                };
            };
            // Build modbus configuration from environment variables
            const configData = readModbusConfig();
            currentModbusConfig = Object.assign({}, configData); // Store for hot-reload detection
            // Auto-detect mode
            if (configData.mode === 'multi') {
                isMultiBoardMode = true;
                logger.log(`Multi-board mode detected with ${configData.boards.length} boards`);
                // Initialize multi-board configuration
                const multiConfig = {
                    mode: 'multi',
                    defaultBoard: configData.defaultBoard,
                    boards: configData.boards
                };
                client_registry_1.default.initializeMultiBoardConfig(multiConfig, node);
            }
            else {
                isMultiBoardMode = false;
                logger.log(`Single-board mode: ${configData.config.type} ${configData.config.host}:${configData.config.tcpPort}`);
            }
            // Get or create shared Modbus client
            logger.log("Getting shared Modbus client from ClientRegistry...");
            client_registry_1.default.logConnectionCounts(node);
            // Determine which client to get based on mode and configuration
            let modbusClient;
            // Wrap async initialization in IIFE
            (async () => {
                try {
                    if (isMultiBoardMode) {
                        const boardToUse = currentBoardId || configData.defaultBoard;
                        logger.log(`Getting client for board: ${boardToUse}`);
                        modbusClient = await client_registry_1.default.getModbusClientV2(boardToUse, node);
                    }
                    else {
                        modbusClient = await client_registry_1.default.getModbusClientV2(configData.config, node);
                    }
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
                            // Check if mode has changed or if critical config has changed
                            let hasChanged = false;
                            let changeDescription = "";
                            if (currentModbusConfig.mode !== newConfig.mode) {
                                hasChanged = true;
                                changeDescription = `mode changed from ${currentModbusConfig.mode} to ${newConfig.mode}`;
                            }
                            else if (newConfig.mode === 'single' && currentModbusConfig.mode === 'single') {
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
                            }
                            else if (newConfig.mode === 'multi' && currentModbusConfig.mode === 'multi') {
                                // Check multi mode config changes
                                const oldBoards = JSON.stringify(currentModbusConfig.boards);
                                const newBoards = JSON.stringify(newConfig.boards);
                                hasChanged = oldBoards !== newBoards;
                                if (hasChanged) {
                                    changeDescription = `board configuration updated`;
                                }
                            }
                            if (hasChanged) {
                                logger.log(`[HOT-RELOAD] Config change detected: ${changeDescription}`);
                                // Reinitialize based on new mode
                                if (newConfig.mode === 'multi') {
                                    const multiConfig = {
                                        mode: 'multi',
                                        defaultBoard: newConfig.defaultBoard,
                                        boards: newConfig.boards
                                    };
                                    client_registry_1.default.initializeMultiBoardConfig(multiConfig, node);
                                    // Get new client for current board
                                    const boardToUse = currentBoardId || newConfig.defaultBoard;
                                    modbusClient = await client_registry_1.default.getModbusClientV2(boardToUse, node);
                                }
                                else {
                                    // Single mode reload
                                    const reloaded = await client_registry_1.default.reloadModbusConfig(newConfig.config, node);
                                    if (reloaded) {
                                        modbusClient = await client_registry_1.default.getModbusClientV2(newConfig.config, node);
                                    }
                                }
                                // Update service with new client
                                if (modbusGetterService && modbusClient) {
                                    modbusGetterService.modbusClient = modbusClient;
                                }
                                currentModbusConfig = Object.assign({}, newConfig);
                                isMultiBoardMode = newConfig.mode === 'multi';
                                logger.log(`[HOT-RELOAD] Modbus reloaded: ${changeDescription}`);
                                // Show brief reload notification
                                node.status({ fill: "green", shape: "dot", text: `Reloaded: ${changeDescription}` });
                                setTimeout(() => {
                                    node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
                                }, 3000);
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
                            // Check if a different board is requested in the payload (multi-board mode)
                            // Priority: msg.payload.boardId > config.boardId > defaultBoard
                            const targetBoardId = (msg.payload && msg.payload.boardId) || currentBoardId;
                            if (isMultiBoardMode && targetBoardId && targetBoardId !== currentBoardId) {
                                const requestedBoardId = targetBoardId;
                                logger.log(`Switching to board: ${requestedBoardId}`);
                                // Release current board connection
                                if (currentBoardId) {
                                    client_registry_1.default.releaseClientV2("modbus-board", node, currentBoardId);
                                }
                                // Get client for requested board
                                try {
                                    modbusClient = await client_registry_1.default.getModbusClientV2(requestedBoardId, node);
                                    currentBoardId = requestedBoardId;
                                    // Update service with new client
                                    if (modbusGetterService) {
                                        modbusGetterService.modbusClient = modbusClient;
                                    }
                                    logger.log(`Switched to board: ${requestedBoardId}`);
                                }
                                catch (error) {
                                    throw new Error(`Failed to switch to board ${requestedBoardId}: ${error.message}`);
                                }
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
                catch (initError) {
                    const errorMessage = initError instanceof Error ? initError.message : 'Unknown async initialization error';
                    logger.error(`Async initialization failed: ${errorMessage}`);
                    node.status({ fill: "red", shape: "ring", text: constants_1.STATUS_MESSAGES.ERROR });
                }
            })();
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
                if (isMultiBoardMode && currentBoardId) {
                    client_registry_1.default.releaseClientV2("modbus-board", node, currentBoardId);
                    logger.log(`Modbus board ${currentBoardId} client released`);
                }
                else {
                    client_registry_1.default.releaseClientV2("modbus", node);
                    logger.log("Modbus client released");
                }
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

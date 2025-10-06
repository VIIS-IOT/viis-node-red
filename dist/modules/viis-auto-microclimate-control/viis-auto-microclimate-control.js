"use strict";
/**
 * VIIS Auto Microclimate Control Node
 * Automatic control for fans, water pump, and curtains based on sensor data
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const autoControlHandler_1 = require("./handlers/autoControlHandler");
const configService_1 = require("./services/configService");
const sensorService_1 = require("./services/sensorService");
const modbusService_1 = require("./services/modbusService");
const waterPumpControlService_1 = require("./services/waterPumpControlService");
const curtainControlService_1 = require("./services/curtainControlService");
const logger_1 = require("./utils/logger");
const constants_1 = require("./constants");
const fanControlService_1 = require("./services/fanControlService");
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    function ViisAutoMicroclimateControlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Initialize logger
        const logger = new logger_1.Logger(node, node.id);
        // Set initial status
        node.status({ fill: "yellow", shape: "ring", text: constants_1.STATUS_MESSAGES.INITIALIZING });
        // Wrap initialization in async IIFE
        (async () => {
            try {
                // Add delay to ensure RPC control initializes first (it needs MQTT priority)
                const initDelay = 3000 + Math.random() * 1000; // 3-4 seconds delay
                logger.log(`[AUTO-INIT] Node ${node.id} waiting ${Math.round(initDelay)}ms to let RPC control initialize first`);
                await new Promise(resolve => setTimeout(resolve, initDelay));
                logger.log("Initializing VIIS Auto Microclimate Control Node");
                // Get context references
                const flowContext = node.context().flow;
                const globalContext = node.context().global;
                // Initialize GlobalContextHelper for environment variables
                const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
                // Helper function to read fresh config from global context (for hot-reload)
                const readEnvironmentConfig = () => {
                    return {
                        deviceId: globalHelper.getEnvVar(constants_1.ENV_KEYS.DEVICE_ID, "unknown"),
                        modbusCoils: globalHelper.getJsonEnvVar(constants_1.ENV_KEYS.MODBUS_COILS, {}),
                        modbusInputRegisters: globalHelper.getJsonEnvVar(constants_1.ENV_KEYS.MODBUS_INPUT_REGISTERS, {}),
                        modbusHoldingRegisters: globalHelper.getJsonEnvVar(constants_1.ENV_KEYS.MODBUS_HOLDING_REGISTERS, {})
                    };
                };
                const readModbusConfig = () => {
                    return {
                        type: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_TYPE, constants_1.MODBUS_CONFIG.DEFAULT_TYPE),
                        host: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_HOST, constants_1.MODBUS_CONFIG.DEFAULT_HOST),
                        tcpPort: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TCP_PORT, constants_1.MODBUS_CONFIG.DEFAULT_TCP_PORT),
                        serialPort: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_SERIAL_PORT, constants_1.MODBUS_CONFIG.DEFAULT_SERIAL_PORT),
                        baudRate: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_BAUD_RATE, constants_1.MODBUS_CONFIG.DEFAULT_BAUD_RATE),
                        parity: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_PARITY, constants_1.MODBUS_CONFIG.DEFAULT_PARITY),
                        unitId: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_UNIT_ID, constants_1.MODBUS_CONFIG.DEFAULT_UNIT_ID),
                        timeout: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TIMEOUT, constants_1.MODBUS_CONFIG.DEFAULT_TIMEOUT),
                        reconnectInterval: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_RECONNECT_INTERVAL, constants_1.MODBUS_CONFIG.DEFAULT_RECONNECT_INTERVAL)
                    };
                };
                // Read initial configuration
                let environmentConfig = readEnvironmentConfig();
                let currentModbusConfig = readModbusConfig();
                logger.log(`Environment config loaded: device=${environmentConfig.deviceId}`);
                // Get or create Modbus client
                logger.log(`[AUTO-CONTROL-INIT] Node ID: ${node.id} - Initializing Modbus client...`);
                // Log current client registry state before getting Modbus client
                client_registry_1.default.logConnectionCounts(node);
                let modbusClient = client_registry_1.default.getModbusClient(currentModbusConfig, node);
                if (!modbusClient) {
                    throw new Error("Failed to initialize Modbus client");
                }
                logger.log(`[AUTO-CONTROL-INIT] Modbus client initialized: ${currentModbusConfig.type} ${currentModbusConfig.host}:${currentModbusConfig.tcpPort}`);
                // Log final client registry state after getting Modbus client
                client_registry_1.default.logConnectionCounts(node);
                // Create service options
                const serviceOptions = {
                    node: node,
                    flowContext: flowContext,
                    globalContext: globalContext,
                    nodeId: node.id,
                    environmentConfig: environmentConfig
                };
                // Initialize services
                const configService = new configService_1.ConfigService(serviceOptions);
                const sensorService = new sensorService_1.SensorService(serviceOptions);
                const modbusService = new modbusService_1.ModbusService(serviceOptions, modbusClient);
                const fanControlService = new fanControlService_1.FanControlService(serviceOptions);
                const waterPumpControlService = new waterPumpControlService_1.WaterPumpControlService(serviceOptions);
                const curtainControlService = new curtainControlService_1.CurtainControlService(serviceOptions);
                // Initialize auto control handler
                const pollingInterval = config.pollingInterval || constants_1.CONTROL_CONFIG.POLLING_INTERVAL_MS;
                const autoControlHandler = new autoControlHandler_1.AutoControlHandler(serviceOptions, configService, sensorService, modbusService, fanControlService, waterPumpControlService, curtainControlService, pollingInterval);
                logger.log("All services initialized successfully");
                // Start control loop
                autoControlHandler.startControlLoop();
                logger.log("Auto control loop started");
                // Hot-reload: Check for config changes every 30 seconds
                const configCheckInterval = setInterval(async () => {
                    try {
                        const newEnvConfig = readEnvironmentConfig();
                        const newModbusConfig = readModbusConfig();
                        // Check if Modbus config changed
                        const modbusChanged = currentModbusConfig.host !== newModbusConfig.host ||
                            currentModbusConfig.tcpPort !== newModbusConfig.tcpPort ||
                            currentModbusConfig.serialPort !== newModbusConfig.serialPort ||
                            currentModbusConfig.type !== newModbusConfig.type;
                        if (modbusChanged) {
                            logger.warn(`[HOT-RELOAD] Modbus config changed: ${currentModbusConfig.host}:${currentModbusConfig.tcpPort} -> ${newModbusConfig.host}:${newModbusConfig.tcpPort}`);
                            const reloaded = await client_registry_1.default.reloadModbusConfig(newModbusConfig, node);
                            if (reloaded) {
                                // Get updated client and update service
                                modbusClient = client_registry_1.default.getModbusClient(newModbusConfig, node);
                                modbusService.modbusClient = modbusClient;
                                currentModbusConfig = Object.assign({}, newModbusConfig);
                                logger.warn(`[HOT-RELOAD] Modbus reloaded successfully: ${newModbusConfig.host}:${newModbusConfig.tcpPort}`);
                                node.status({ fill: "green", shape: "dot", text: `Reloaded: ${newModbusConfig.host}` });
                                setTimeout(() => {
                                    node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
                                }, 3000);
                            }
                        }
                        // Update environment config (mapping changes etc)
                        if (environmentConfig.deviceId !== newEnvConfig.deviceId) {
                            logger.warn(`[HOT-RELOAD] Device ID changed: ${environmentConfig.deviceId} -> ${newEnvConfig.deviceId}`);
                        }
                        environmentConfig = newEnvConfig;
                    }
                    catch (error) {
                        logger.error(`[HOT-RELOAD] Config check error: ${error.message}`);
                    }
                }, 30000); // Check every 30 seconds
                logger.log("[HOT-RELOAD] Config monitoring enabled (30s interval)");
                // Handle input messages for manual control or configuration updates
                node.on('input', (msg) => {
                    try {
                        logger.debug('Input message received');
                        if (msg.payload && typeof msg.payload === 'object') {
                            // Handle control commands
                            if (msg.payload.command) {
                                handleControlCommand(msg.payload.command, msg.payload.params);
                            }
                            // Handle configuration updates
                            if (msg.payload.updateConfig) {
                                configService.invalidateCache();
                                sensorService.invalidateCache();
                                logger.log("Configuration cache invalidated");
                            }
                        }
                    }
                    catch (error) {
                        logger.error(`Input message processing error: ${error.message}`);
                    }
                });
                // Handle control commands
                function handleControlCommand(command, params) {
                    try {
                        switch (command) {
                            case 'start':
                                if (!autoControlHandler.isControlActive()) {
                                    autoControlHandler.startControlLoop();
                                    logger.log("Control loop started via command");
                                }
                                break;
                            case 'stop':
                                if (autoControlHandler.isControlActive()) {
                                    autoControlHandler.stopControlLoop();
                                    logger.log("Control loop stopped via command");
                                }
                                break;
                            case 'execute':
                                autoControlHandler.executeControlCycle();
                                logger.log("Manual control cycle executed");
                                break;
                            case 'status':
                                const status = autoControlHandler.getControlStatus();
                                node.send({
                                    payload: {
                                        command: 'status_response',
                                        status: status
                                    }
                                });
                                break;
                            case 'updateInterval':
                                if (params && typeof params.interval === 'number') {
                                    autoControlHandler.updatePollingInterval(params.interval);
                                    logger.log(`Polling interval updated to ${params.interval}ms`);
                                }
                                break;
                            default:
                                logger.warn(`Unknown control command: ${command}`);
                        }
                    }
                    catch (error) {
                        logger.error(`Control command error: ${error.message}`);
                    }
                }
                // Handle node close
                node.on('close', (done) => {
                    try {
                        logger.log("Shutting down auto control node");
                        // Stop config check interval
                        if (configCheckInterval) {
                            clearInterval(configCheckInterval);
                            logger.log("[CLEANUP] Config check interval stopped");
                        }
                        // Stop control loop
                        if (autoControlHandler.isControlActive()) {
                            autoControlHandler.stopControlLoop();
                        }
                        // Release Modbus client
                        client_registry_1.default.releaseClient("modbus", node);
                        logger.log("Auto control node shutdown complete");
                        done();
                    }
                    catch (error) {
                        logger.error(`Shutdown error: ${error.message}`);
                        done();
                    }
                });
                // Set ready status
                node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
                logger.log("VIIS Auto Microclimate Control Node ready");
            }
            catch (error) {
                const errorMessage = `${constants_1.ERROR_MESSAGES.CONTROL_LOGIC_ERROR}: ${error.message}`;
                logger.error(errorMessage);
                node.status({ fill: "red", shape: "ring", text: constants_1.STATUS_MESSAGES.ERROR });
                node.error(errorMessage);
            }
        })().catch((error) => {
            logger.error(`Async initialization failed: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
    }
    // Register the node
    RED.nodes.registerType("viis-auto-microclimate-control", ViisAutoMicroclimateControlNode);
};

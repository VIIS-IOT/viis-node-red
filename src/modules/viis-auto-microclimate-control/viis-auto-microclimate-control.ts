/**
 * VIIS Auto Microclimate Control Node
 * Automatic control for fans, water pump, and curtains based on sensor data
 */

import { NodeAPI, Node } from "node-red";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
import {
    ViisAutoMicroclimateControlNodeDef,
    ServiceOptions,
    EnvironmentConfig
} from "./interfaces/types";
import { AutoControlHandler } from "./handlers/autoControlHandler";
import { ConfigService } from "./services/configService";
import { SensorService } from "./services/sensorService";
import { ModbusService } from "./services/modbusService";
import { EnhancedFanControlService } from "./services/enhancedFanControlService";
import { WaterPumpControlService } from "./services/waterPumpControlService";
import { CurtainControlService } from "./services/curtainControlService";
import { Logger } from "./utils/logger";
import {
    ENV_KEYS,
    MODBUS_CONFIG,
    CONTROL_CONFIG,
    STATUS_MESSAGES,
    ERROR_MESSAGES
} from "./constants";
import { FanControlService } from "./services/fanControlService";
import { GlobalContextHelper } from "../../ultils/global-context-helper";

module.exports = function (RED: NodeAPI) {
    function ViisAutoMicroclimateControlNode(this: Node, config: ViisAutoMicroclimateControlNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize logger
        const logger = new Logger(node, node.id);

        // Set initial status
        node.status({ fill: "yellow", shape: "ring", text: STATUS_MESSAGES.INITIALIZING });

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
                const globalHelper = new GlobalContextHelper(node.context());
                
                // Multi-board state variables
                let currentBoardId: string | undefined = config.boardId;
                let isMultiBoardMode: boolean = false;
                let currentModbusConfig: any;

                // Helper function to read fresh config from global context (for hot-reload)
                const readEnvironmentConfig = (): EnvironmentConfig => {
                    return {
                        deviceId: globalHelper.getEnvVar(ENV_KEYS.DEVICE_ID, "unknown"),
                        modbusCoils: globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_COILS, {}),
                        modbusInputRegisters: globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_INPUT_REGISTERS, {}),
                        modbusHoldingRegisters: globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_HOLDING_REGISTERS, {})
                    };
                };

                const readModbusConfig = () => {
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
                            reconnectInterval: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_RECONNECT_INTERVAL, MODBUS_CONFIG.DEFAULT_RECONNECT_INTERVAL)
                        }
                    };
                };

                // Read initial configuration
                let environmentConfig = readEnvironmentConfig();
                const configData = readModbusConfig();
                currentModbusConfig = { ...configData };
                
                // Auto-detect mode
                if (configData.mode === 'multi') {
                    isMultiBoardMode = true;
                    logger.log(`Multi-board mode detected with ${configData.boards.length} boards`);
                    
                    const multiConfig: MultiModbusConfig = {
                        mode: 'multi',
                        defaultBoard: configData.defaultBoard,
                        boards: configData.boards
                    };
                    ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
                } else {
                    isMultiBoardMode = false;
                    logger.log(`Single-board mode`);
                }

                logger.log(`Environment config loaded: device=${environmentConfig.deviceId}`);

                // Get or create Modbus client
                logger.log(`[AUTO-CONTROL-INIT] Node ID: ${node.id} - Initializing Modbus client...`);

                // Log current client registry state before getting Modbus client
                ClientRegistry.logConnectionCounts(node);

                // Get Modbus client
                let modbusClient;
                if (isMultiBoardMode) {
                    const boardToUse = currentBoardId || configData.defaultBoard;
                    logger.log(`Getting client for board: ${boardToUse}`);
                    modbusClient = await ClientRegistry.getModbusClientV2(boardToUse, node);
                } else {
                    modbusClient = await ClientRegistry.getModbusClientV2(configData.config, node);
                }

                if (!modbusClient) {
                    throw new Error("Failed to initialize Modbus client");
                }

                logger.log(`[AUTO-CONTROL-INIT] Modbus client initialized: ${currentModbusConfig.type} ${currentModbusConfig.host}:${currentModbusConfig.tcpPort}`);

                // Log final client registry state after getting Modbus client
                ClientRegistry.logConnectionCounts(node);

                // Create service options
                const serviceOptions: ServiceOptions = {
                    node: node,
                    flowContext: flowContext,
                    globalContext: globalContext,
                    nodeId: node.id,
                    environmentConfig: environmentConfig
                };

                // Initialize services
                const configService = new ConfigService(serviceOptions);
                const sensorService = new SensorService(serviceOptions);
                const modbusService = new ModbusService(serviceOptions, modbusClient);
                const fanControlService = new FanControlService(serviceOptions);
                const waterPumpControlService = new WaterPumpControlService(serviceOptions);
                const curtainControlService = new CurtainControlService(serviceOptions);

                // Initialize auto control handler
                const pollingInterval = config.pollingInterval || CONTROL_CONFIG.POLLING_INTERVAL_MS;
                const autoControlHandler = new AutoControlHandler(
                    serviceOptions,
                    configService,
                    sensorService,
                    modbusService,
                    fanControlService,
                    waterPumpControlService,
                    curtainControlService,
                    pollingInterval
                );

                logger.log("All services initialized successfully");

                // Start control loop
                autoControlHandler.startControlLoop();
                logger.log("Auto control loop started");

                // Hot-reload: Check for config changes every 30 seconds
                const configCheckInterval = setInterval(async () => {
                    try {
                        const newEnvConfig = readEnvironmentConfig();
                        const newConfig = readModbusConfig();
                        
                        // Check if mode has changed or if critical config has changed
                        let hasChanged = false;
                        let changeDescription = "";
                        
                        if (currentModbusConfig.mode !== newConfig.mode) {
                            hasChanged = true;
                            changeDescription = `mode changed`;
                        } else if (newConfig.mode === 'single' && currentModbusConfig.mode === 'single') {
                            const oldCfg = currentModbusConfig.config;
                            const newCfg = newConfig.config;
                            hasChanged = 
                                oldCfg.host !== newCfg.host ||
                                oldCfg.tcpPort !== newCfg.tcpPort ||
                                oldCfg.type !== newCfg.type;
                            if (hasChanged) {
                                changeDescription = `${newCfg.host}:${newCfg.tcpPort}`;
                            }
                        } else if (newConfig.mode === 'multi' && currentModbusConfig.mode === 'multi') {
                            hasChanged = JSON.stringify(currentModbusConfig.boards) !== JSON.stringify(newConfig.boards);
                            if (hasChanged) {
                                changeDescription = `boards updated`;
                            }
                        }
                        
                        if (hasChanged) {
                            logger.warn(`[HOT-RELOAD] Config change detected: ${changeDescription}`);
                            
                            if (newConfig.mode === 'multi') {
                                ClientRegistry.initializeMultiBoardConfig({
                                    mode: 'multi',
                                    defaultBoard: newConfig.defaultBoard,
                                    boards: newConfig.boards
                                }, node);
                                const boardToUse = currentBoardId || newConfig.defaultBoard;
                                modbusClient = await ClientRegistry.getModbusClientV2(boardToUse, node);
                            } else {
                                const reloaded = await ClientRegistry.reloadModbusConfig(newConfig.config, node);
                                if (reloaded) {
                                    modbusClient = await ClientRegistry.getModbusClientV2(newConfig.config, node);
                                }
                            }
                            
                            (modbusService as any).modbusClient = modbusClient;
                            currentModbusConfig = { ...newConfig };
                            isMultiBoardMode = newConfig.mode === 'multi';
                            logger.warn(`[HOT-RELOAD] Modbus reloaded: ${changeDescription}`);
                            
                            node.status({ fill: "green", shape: "dot", text: `Reloaded` });
                            setTimeout(() => {
                                node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });
                            }, 3000);
                        }
                        
                        // Update environment config (mapping changes etc)
                        if (environmentConfig.deviceId !== newEnvConfig.deviceId) {
                            logger.warn(`[HOT-RELOAD] Device ID changed: ${environmentConfig.deviceId} -> ${newEnvConfig.deviceId}`);
                        }
                        environmentConfig = newEnvConfig;
                        
                    } catch (error) {
                        logger.error(`[HOT-RELOAD] Config check error: ${(error as Error).message}`);
                    }
                }, 30000); // Check every 30 seconds

                logger.log("[HOT-RELOAD] Config monitoring enabled (30s interval)");

                // Handle input messages for manual control or configuration updates
                node.on('input', (msg: any) => {
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

                    } catch (error) {
                        logger.error(`Input message processing error: ${(error as Error).message}`);
                    }
                });

                // Handle control commands
                function handleControlCommand(command: string, params: any) {
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
                    } catch (error) {
                        logger.error(`Control command error: ${(error as Error).message}`);
                    }
                }

                // Handle node close
                node.on('close', (done: () => void) => {
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

                        // Release Modbus client (multi-board aware)
                        if (isMultiBoardMode && currentBoardId) {
                            ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
                        } else {
                            ClientRegistry.releaseClientV2("modbus", node);
                        }

                        logger.log("Auto control node shutdown complete");
                        done();

                    } catch (error) {
                        logger.error(`Shutdown error: ${(error as Error).message}`);
                        done();
                    }
                });

                // Set ready status
                node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });
                logger.log("VIIS Auto Microclimate Control Node ready");

            } catch (error) {
                const errorMessage = `${ERROR_MESSAGES.CONTROL_LOGIC_ERROR}: ${(error as Error).message}`;
                logger.error(errorMessage);
                node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });
                node.error(errorMessage);
            }
        })().catch((error) => {
            logger.error(`Async initialization failed: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
    }

    // Register the node
    RED.nodes.registerType("viis-auto-microclimate-control", ViisAutoMicroclimateControlNode);
};

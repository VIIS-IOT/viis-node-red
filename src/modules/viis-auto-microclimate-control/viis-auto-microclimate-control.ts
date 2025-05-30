/**
 * VIIS Auto Microclimate Control Node
 * Automatic control for fans, water pump, and curtains based on sensor data
 */

import { NodeAPI, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";
import {
    ViisAutoMicroclimateControlNodeDef,
    ServiceOptions,
    EnvironmentConfig
} from "./interfaces/types";
import { AutoControlHandler } from "./handlers/autoControlHandler";
import { ConfigService } from "./services/configService";
import { SensorService } from "./services/sensorService";
import { ModbusService } from "./services/modbusService";
import { FanControlService } from "./services/fanControlService";
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

module.exports = function (RED: NodeAPI) {
    function ViisAutoMicroclimateControlNode(this: Node, config: ViisAutoMicroclimateControlNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize logger
        const logger = new Logger(node, node.id);

        // Set initial status
        node.status({ fill: "yellow", shape: "ring", text: STATUS_MESSAGES.INITIALIZING });

        try {
            logger.log("Initializing VIIS Auto Microclimate Control Node");

            // Get context references
            const flowContext = node.context().flow;
            const globalContext = node.context().global;

            // Read environment configuration
            const environmentConfig: EnvironmentConfig = {
                deviceId: process.env[ENV_KEYS.DEVICE_ID] || "unknown",
                modbusCoils: JSON.parse(process.env[ENV_KEYS.MODBUS_COILS] || "{}"),
                modbusInputRegisters: JSON.parse(process.env[ENV_KEYS.MODBUS_INPUT_REGISTERS] || "{}"),
                modbusHoldingRegisters: JSON.parse(process.env[ENV_KEYS.MODBUS_HOLDING_REGISTERS] || "{}")
            };

            logger.log(`Environment config loaded: device=${environmentConfig.deviceId}`);

            // Initialize Modbus client configuration
            const modbusConfig = {
                type: (process.env[ENV_KEYS.MODBUS_TYPE] as "TCP" | "RTU") || MODBUS_CONFIG.DEFAULT_TYPE,
                host: process.env[ENV_KEYS.MODBUS_HOST] || MODBUS_CONFIG.DEFAULT_HOST,
                tcpPort: parseInt(process.env[ENV_KEYS.MODBUS_TCP_PORT] || MODBUS_CONFIG.DEFAULT_TCP_PORT.toString(), 10),
                serialPort: process.env[ENV_KEYS.MODBUS_SERIAL_PORT] || MODBUS_CONFIG.DEFAULT_SERIAL_PORT,
                baudRate: parseInt(process.env[ENV_KEYS.MODBUS_BAUD_RATE] || MODBUS_CONFIG.DEFAULT_BAUD_RATE.toString(), 10),
                parity: (process.env[ENV_KEYS.MODBUS_PARITY] as "none" | "even" | "odd") || MODBUS_CONFIG.DEFAULT_PARITY,
                unitId: parseInt(process.env[ENV_KEYS.MODBUS_UNIT_ID] || MODBUS_CONFIG.DEFAULT_UNIT_ID.toString(), 10),
                timeout: parseInt(process.env[ENV_KEYS.MODBUS_TIMEOUT] || MODBUS_CONFIG.DEFAULT_TIMEOUT.toString(), 10),
                reconnectInterval: parseInt(process.env[ENV_KEYS.MODBUS_RECONNECT_INTERVAL] || MODBUS_CONFIG.DEFAULT_RECONNECT_INTERVAL.toString(), 10)
            };

            // Get or create Modbus client
            const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);

            if (!modbusClient) {
                throw new Error("Failed to initialize Modbus client");
            }

            logger.log(`Modbus client initialized: ${modbusConfig.type} ${modbusConfig.host}:${modbusConfig.tcpPort}`);

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

                    // Stop control loop
                    if (autoControlHandler.isControlActive()) {
                        autoControlHandler.stopControlLoop();
                    }

                    // Release Modbus client
                    ClientRegistry.releaseClient("modbus", node);

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
    }

    // Register the node
    RED.nodes.registerType("viis-auto-microclimate-control", ViisAutoMicroclimateControlNode);
};

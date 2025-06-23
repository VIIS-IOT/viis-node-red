import { NodeAPI, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { ViisModbusGetterNodeDef, ServiceOptions, NodeStatus } from "./interfaces/types";
import { ModbusGetterService } from "./services/modbusGetterService";
import { Logger } from "./utils/logger";
import { DEFAULT_CONFIG, ENV_KEYS, STATUS_MESSAGES } from "./constants";

/**
 * VIIS Modbus Getter Node
 * A custom Node-RED node for reading data from Modbus devices using shared connection resources
 */
module.exports = function (RED: NodeAPI) {
    function ViisModbusGetterNode(this: Node, config: ViisModbusGetterNodeDef) {
        RED.nodes.createNode(this, config as any);
        const node = this;
        let modbusGetterService: ModbusGetterService | null = null;
        let logger: Logger;

        try {
            // Initialize logger with enableLogging flag from config
            logger = new Logger(node, node.id, config.enableLogging);
            logger.log("Initializing VIIS Modbus Getter Node...");

            // Set initial status
            node.status({ fill: "yellow", shape: "ring", text: STATUS_MESSAGES.INITIALIZING });

            // Initialize GlobalContextHelper for environment variables
            const globalHelper = new GlobalContextHelper(node.context());

            // Build modbus configuration from environment variables
            const modbusConfig = {
                type: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_TYPE, DEFAULT_CONFIG.MODBUS_TYPE) as "TCP" | "RTU"),
                host: globalHelper.getEnvVar(ENV_KEYS.MODBUS_HOST, DEFAULT_CONFIG.MODBUS_HOST),
                tcpPort: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TCP_PORT, DEFAULT_CONFIG.MODBUS_TCP_PORT),
                serialPort: globalHelper.getEnvVar(ENV_KEYS.MODBUS_SERIAL_PORT, DEFAULT_CONFIG.MODBUS_SERIAL_PORT),
                baudRate: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_BAUD_RATE, DEFAULT_CONFIG.MODBUS_BAUD_RATE),
                parity: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_PARITY, DEFAULT_CONFIG.MODBUS_PARITY) as "none" | "even" | "odd"),
                unitId: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_UNIT_ID, DEFAULT_CONFIG.MODBUS_UNIT_ID),
                timeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TIMEOUT, DEFAULT_CONFIG.MODBUS_TIMEOUT),
                reconnectInterval: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_RECONNECT_INTERVAL, DEFAULT_CONFIG.MODBUS_RECONNECT_INTERVAL)
            };

            logger.log(`Modbus config: ${modbusConfig.type} ${modbusConfig.host}:${modbusConfig.tcpPort}`);

            // Get or create shared Modbus client
            logger.log("Getting shared Modbus client from ClientRegistry...");
            ClientRegistry.logConnectionCounts(node);

            const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
            if (!modbusClient) {
                throw new Error("Failed to initialize Modbus client");
            }

            logger.log("Modbus client initialized successfully");
            ClientRegistry.logConnectionCounts(node);

            // Create service options with enableLogging flag
            const serviceOptions: ServiceOptions = {
                node: node,
                nodeId: node.id,
                enableLogging: config.enableLogging
            };

            // Initialize modbus getter service
            modbusGetterService = new ModbusGetterService(serviceOptions, modbusClient);
            logger.log("ModbusGetterService initialized successfully");

            // Log configuration status
            if (config.enableLogging) {
                logger.log("Detailed logging is ENABLED");
            } else {
                logger.log("Detailed logging is DISABLED");
            }

            // Set ready status
            node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });

            // Handle incoming messages
            node.on("input", async (msg: any, send: any, done: any) => {
                try {
                    if (!modbusGetterService) {
                        throw new Error("ModbusGetterService not initialized");
                    }

                    // Set reading status
                    node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.READING });

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
                    node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });

                    // Call done to indicate completion
                    if (done) {
                        done();
                    }

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                    // Always log errors regardless of enableLogging setting
                    logger.error(`Error processing request: ${errorMessage}`);

                    // Set error status
                    node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });

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

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';

            if (logger) {
                logger.error(`Initialization failed: ${errorMessage}`);
            } else {
                node.error(`[MODBUS-GETTER-${node.id}] Initialization failed: ${errorMessage}`);
            }

            node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });
            return;
        }

        // Cleanup when node is closed
        node.on("close", (done: any) => {
            try {
                logger.log("Closing VIIS Modbus Getter Node...");

                // Release shared modbus client
                ClientRegistry.releaseClient("modbus", node);
                logger.log("Modbus client released");

                // Clear service reference
                modbusGetterService = null;

                logger.log("VIIS Modbus Getter Node closed successfully");

                if (done) {
                    done();
                }
            } catch (error) {
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
import { NodeAPI, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { MqttConfig } from "../../core/mqtt-client";
import { ModbusConfig } from "../../core/modbus-client";
import { ModbusPollerService } from "./services/modbusPollerService";
import { TelemetryService } from "./services/telemetryService";
import { DatabaseService } from "./services/databaseService";
import { ThresholdChecker } from "./utils/thresholdChecker";
import { Logger } from "./utils/logger";
import {
    ViisModbusPollerNodeDef,
    ThresholdConfig,
    EnvironmentConfig
} from "./interfaces/types";
import {
    DEFAULT_CONFIG,
    ENV_KEYS,
    STATUS_MESSAGES,
    ERROR_MESSAGES
} from "./constants";

export = function (RED: NodeAPI) {
    function ViisModbusPollerNode(this: Node, config: ViisModbusPollerNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        let modbusPollerService: ModbusPollerService | null = null;
        let logger: Logger | null = null;

        // Initialize node
        (async () => {
            try {
                node.status({ fill: "yellow", shape: "ring", text: STATUS_MESSAGES.INITIALIZING });

                // Initialize logger
                logger = new Logger(node, config.enableDebugLog);
                logger.log("Initializing VIIS Modbus Poller Node");

                // Initialize global context helper
                const globalHelper = new GlobalContextHelper(node.context());

                // Get environment configuration
                const environmentConfig = getEnvironmentConfig(globalHelper);
                logger.debug(`Environment config loaded: ${JSON.stringify(environmentConfig)}`);

                // Parse threshold configuration
                const thresholdConfig = parseThresholdConfig(config.thresholdConfig, logger);

                // Create Modbus client configuration
                const modbusConfig = createModbusConfig(globalHelper);
                logger.debug(`Modbus config: ${modbusConfig.type} ${modbusConfig.host}:${modbusConfig.tcpPort}`);

                // Create MQTT client configurations
                const thingsboardMqttConfig = createThingsboardMqttConfig(globalHelper);
                const emqxMqttConfig = createEmqxMqttConfig(globalHelper);

                // Get shared clients from registry
                logger.log("Getting shared clients from ClientRegistry...");
                ClientRegistry.logConnectionCounts(node);

                const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
                if (!modbusClient) {
                    throw new Error(ERROR_MESSAGES.MODBUS_CLIENT_INIT_FAILED);
                }

                const thingsboardMqttClient = await ClientRegistry.getThingsboardMqttClient(thingsboardMqttConfig, node);
                if (!thingsboardMqttClient) {
                    throw new Error(ERROR_MESSAGES.MQTT_CLIENT_INIT_FAILED);
                }

                const emqxMqttClient = await ClientRegistry.getLocalMqttClient(emqxMqttConfig, node);
                if (!emqxMqttClient) {
                    throw new Error(ERROR_MESSAGES.MQTT_CLIENT_INIT_FAILED);
                }

                logger.log("All clients initialized successfully");

                // Validate single modbus connection requirement
                const isValidConnection = ClientRegistry.validateSingleModbusConnection(node);
                if (!isValidConnection) {
                    throw new Error("CRITICAL: Multiple modbus connections detected! This violates system requirements.");
                }

                // Initialize database service
                const databaseService = new DatabaseService(logger);

                // Initialize services
                const telemetryService = new TelemetryService(
                    logger,
                    databaseService,
                    thingsboardMqttClient,
                    emqxMqttClient,
                    environmentConfig.deviceId
                );

                modbusPollerService = new ModbusPollerService(
                    node,
                    logger,
                    modbusClient,
                    telemetryService,
                    environmentConfig
                );

                // Initialize services
                await modbusPollerService.initialize();

                // Update configurations
                modbusPollerService.updateConfigurations(
                    {
                        interval: config.coilPollingInterval || DEFAULT_CONFIG.COIL_POLLING_INTERVAL,
                        quantity: config.coilQuantity || DEFAULT_CONFIG.COIL_QUANTITY
                    },
                    {
                        interval: config.inputPollingInterval || DEFAULT_CONFIG.INPUT_POLLING_INTERVAL,
                        quantity: config.inputQuantity || DEFAULT_CONFIG.INPUT_QUANTITY
                    },
                    {
                        interval: config.holdingPollingInterval || DEFAULT_CONFIG.HOLDING_POLLING_INTERVAL,
                        quantity: config.holdingQuantity || DEFAULT_CONFIG.HOLDING_QUANTITY
                    },
                    thresholdConfig,
                    config.periodicSnapshotInterval || DEFAULT_CONFIG.PERIODIC_SNAPSHOT_INTERVAL
                );

                // Start polling
                modbusPollerService.startPolling();

                logger.log("VIIS Modbus Poller Node initialized successfully");

            } catch (error) {
                const errorMessage = `Initialization failed: ${(error as Error).message}`;
                if (logger) {
                    logger.errorWithStack(errorMessage, error as Error);
                } else {
                    node.error(errorMessage);
                }
                node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });
            }
        })();

        // Handle node close
        node.on("close", (done: () => void) => {
            try {
                if (logger) {
                    logger.log("Closing VIIS Modbus Poller Node");
                }

                // Stop polling service
                if (modbusPollerService) {
                    modbusPollerService.stopPolling();
                }

                // Release shared clients
                ClientRegistry.releaseClient("modbus", node);
                ClientRegistry.releaseClient("thingsboard", node);
                ClientRegistry.releaseClient("local", node);

                if (logger) {
                    logger.log("VIIS Modbus Poller Node closed successfully");
                }

                done();
            } catch (error) {
                if (logger) {
                    logger.errorWithStack("Error during node close", error as Error);
                } else {
                    node.error(`Error during close: ${(error as Error).message}`);
                }
                done();
            }
        });
    }

    /**
     * Get environment configuration from global context
     */
    function getEnvironmentConfig(globalHelper: GlobalContextHelper): EnvironmentConfig {
        const deviceId = globalHelper.getEnvVar(ENV_KEYS.DEVICE_ID, "");
        if (!deviceId) {
            throw new Error("DEVICE_ID environment variable is required");
        }

        const modbusCoils = parseJsonEnvVar(globalHelper.getEnvVar(ENV_KEYS.MODBUS_COILS, "{}"));
        const modbusInputRegisters = parseJsonEnvVar(globalHelper.getEnvVar(ENV_KEYS.MODBUS_INPUT_REGISTERS, "{}"));
        const modbusHoldingRegisters = parseJsonEnvVar(globalHelper.getEnvVar(ENV_KEYS.MODBUS_HOLDING_REGISTERS, "{}"));

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
    function parseJsonEnvVar(value: string): Record<string, number> {
        try {
            return JSON.parse(value) || {};
        } catch {
            return {};
        }
    }

    /**
     * Parse threshold configuration from string
     */
    function parseThresholdConfig(thresholdConfigStr: string, logger: Logger): ThresholdConfig {
        try {
            if (!thresholdConfigStr || thresholdConfigStr.trim() === "") {
                return {};
            }

            const parsed = JSON.parse(thresholdConfigStr);
            if (!ThresholdChecker.validateThresholdConfig(parsed)) {
                logger.warn("Invalid threshold configuration, using empty config");
                return {};
            }

            return parsed;
        } catch (error) {
            logger.warn(`Failed to parse threshold configuration: ${(error as Error).message}`);
            return {};
        }
    }

    /**
     * Create Modbus client configuration
     */
    function createModbusConfig(globalHelper: GlobalContextHelper): ModbusConfig {
        return {
            type: globalHelper.getEnvVar(ENV_KEYS.MODBUS_TYPE, "TCP") as "TCP" | "RTU",
            host: globalHelper.getEnvVar(ENV_KEYS.MODBUS_HOST, "localhost"),
            tcpPort: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TCP_PORT, 502),
            serialPort: globalHelper.getEnvVar(ENV_KEYS.MODBUS_SERIAL_PORT, "/dev/ttyUSB0"),
            baudRate: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_BAUD_RATE, 9600),
            parity: globalHelper.getEnvVar(ENV_KEYS.MODBUS_PARITY, "none") as "none" | "even" | "odd",
            unitId: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_UNIT_ID, 1),
            timeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TIMEOUT, 5000),
            reconnectInterval: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_RECONNECT_INTERVAL, 5000)
        };
    }

    /**
     * Create Thingsboard MQTT configuration
     */
    function createThingsboardMqttConfig(globalHelper: GlobalContextHelper): MqttConfig {
        const host = globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_HOST, "mqtt.viis.tech");
        const port = globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_PORT, "1883");
        const deviceToken = globalHelper.getEnvVar(ENV_KEYS.DEVICE_ACCESS_TOKEN, "");
        const password = globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_PASSWORD, "");

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
    function createEmqxMqttConfig(globalHelper: GlobalContextHelper): MqttConfig {
        const host = globalHelper.getEnvVar(ENV_KEYS.EMQX_HOST, "emqx");
        const port = globalHelper.getEnvVar(ENV_KEYS.EMQX_PORT, "1883");
        const username = globalHelper.getEnvVar(ENV_KEYS.EMQX_USERNAME, "");
        const password = globalHelper.getEnvVar(ENV_KEYS.EMQX_PASSWORD, "");

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

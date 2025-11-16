/**
 * viis-marine-telemetry Node
 * Extends viis-telemetry with Marine IoT oil profile tracking
 */

import { NodeAPI, Node, NodeContext } from "node-red";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
import { MySqlConfig } from "../../core/mysql-client";
import { MqttConfig, MqttClientCore } from "../../core/mqtt-client";
import {
    ViisTelemetryConfigManager,
    PollingConfig,
    EnvironmentConfig
} from '../viis-telemetry/viis-telemetry-config';
import { ViisTelemetryConnectionManager } from '../viis-telemetry/viis-telemetry-connection-manager';
import { ViisTelemetryPollingService } from '../viis-telemetry/viis-telemetry-polling-service';
import {
    ViisTelemetryProcessor,
    TelemetryDataEvent,
    TelemetryProcessorConfig,
    PeriodicSnapshotConfig
} from '../viis-telemetry/viis-telemetry-processor';
import { CONTEXT_KEYS, REGISTER_TYPES } from '../viis-telemetry/viis-telemetry-constants';
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { ViisMarinetTelemetryNodeDef, MarineIoTConfig } from './viis-marine-telemetry-config';
import { ViisMarinetTelemetryProcessor } from './viis-marine-telemetry-processor';
import { createDataSource } from '../../orm/dataSource';
import { DH6400PollingService, DH6400PollingConfig, DH6400TelemetryEvent } from '../../services/MarineIoT/DH6400PollingService';

module.exports = function (RED: NodeAPI) {
    /**
     * Main viis-marine-telemetry node implementation
     */
    function ViisMarinetTelemetryNode(this: Node, config: ViisMarinetTelemetryNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext: NodeContext = this.context();
        const flowContext = this.context().flow as NodeContext;

        // Initialize GlobalContextHelper
        const globalHelper = new GlobalContextHelper(this.context());

        // Multi-board state variables
        let currentBoardId: string | undefined = config.boardId;
        let isMultiBoardMode: boolean = false;
        let currentModbusConfig: any;

        // Variables to store clients for cleanup
        let thingsboardMqttClient: MqttClientCore | null = null;
        let marineProcessor: ViisMarinetTelemetryProcessor | null = null;
        let dh6400PollingService: DH6400PollingService | null = null;

        // Marine IoT configuration
        const marineConfig: MarineIoTConfig = {
            enabled: config.enableMarineIoT !== false, // Default: true
            flowSensorKeys: (config.flowSensorKeys || 'fs01,fs02,fs03,fs04,fs05,fs06').split(',').map(k => k.trim()),
            profileCacheDuration: config.profileCacheDuration || 300000 // 5 minutes
        };

        // Wrap async initialization
        (async () => {
            try {
                // Initialize configuration manager
                const configManager = new ViisTelemetryConfigManager(config, nodeContext);
                const pollingConfig = configManager.getPollingConfig();

                // Detect board ID for multi-board mode
                // Check if multi-board mode is active
                let boardsConfig = globalHelper.getEnvVar('modbus_boards', null);
                if (!boardsConfig) {
                    boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);
                }

                let boardIdForConfig = config.boardId || undefined;
                if (!boardIdForConfig && boardsConfig) {
                    // Multi-board mode but no boardId in config, use default
                    let defaultBoard = globalHelper.getEnvVar('modbus_default_board', null);
                    if (!defaultBoard) {
                        defaultBoard = globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', null);
                    }
                    boardIdForConfig = defaultBoard || 'board1';
                    node.log(`[Marine] Auto-detected board ID: ${boardIdForConfig}`);
                }

                const envConfig = configManager.getEnvironmentConfig(boardIdForConfig);
                const mqttTopicConfig = configManager.getMqttTopicConfig(envConfig.deviceId);

                // Log register mapping for debugging
                const holdingRegCount = Object.keys(envConfig.modbusHoldingRegisters).length;
                node.log(`[Marine] Loaded ${holdingRegCount} holding register mappings${boardIdForConfig ? ` for board: ${boardIdForConfig}` : ''}`);

                // Log first few mappings to verify
                const firstFewMappings = Object.entries(envConfig.modbusHoldingRegisters).slice(0, 10);
                node.log(`[Marine] Sample mappings: ${JSON.stringify(Object.fromEntries(firstFewMappings))}`);

                // Initialize context
                nodeContext.set(CONTEXT_KEYS.PREVIOUS_STATE, {});
                nodeContext.set(CONTEXT_KEYS.LAST_SENT, 0);
                nodeContext.set(CONTEXT_KEYS.LAST_EC_UPDATE, nodeContext.get(CONTEXT_KEYS.LAST_EC_UPDATE) || 0);
                nodeContext.set(CONTEXT_KEYS.MAIN_PUMP_STATE, nodeContext.get(CONTEXT_KEYS.MAIN_PUMP_STATE) || false);

                // Setup flow context for debug and threshold config
                const debugLogKey = `${CONTEXT_KEYS.DEBUG_LOG}_${node.id}`;
                const thresholdConfigKey = `${CONTEXT_KEYS.THRESHOLD_CONFIG}_${node.id}`;

                flowContext.set(debugLogKey, configManager.getDebugLogEnabled());
                flowContext.set(thresholdConfigKey, configManager.getThresholdConfig());

                // Create client configurations
                const configData = readModbusConfig(globalHelper);
                currentModbusConfig = { ...configData };

                // Auto-detect mode
                if (configData.mode === 'multi') {
                    isMultiBoardMode = true;
                    const activeBoardId = currentBoardId || configData.defaultBoard;
                    node.log(`[Marine] Multi-board mode detected with ${configData.boards.length} boards, active: ${activeBoardId}`);

                    const multiConfig: MultiModbusConfig = {
                        mode: 'multi',
                        defaultBoard: configData.defaultBoard,
                        boards: configData.boards
                    };
                    ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
                } else {
                    isMultiBoardMode = false;
                    node.log(`[Marine] Single-board mode`);
                }

                const localMqttConfig = createLocalMqttConfig(globalHelper, envConfig.deviceId);
                const thingsboardMqttConfig = createThingsboardMqttConfig(globalHelper);
                const mysqlConfig = createMySqlConfig(globalHelper);

                // Get clients from registry
                let modbusClient;
                if (isMultiBoardMode) {
                    const boardToUse = currentBoardId || configData.defaultBoard;
                    node.log(`[Marine] Getting client for board: ${boardToUse}`);
                    modbusClient = ClientRegistry.getModbusClientV2(boardToUse, node);
                } else {
                    modbusClient = ClientRegistry.getModbusClientV2(configData.config, node);
                }

                const localMqttClient = await ClientRegistry.getLocalMqttClient(localMqttConfig, node);
                thingsboardMqttClient = await ClientRegistry.getThingsboardMqttClient(thingsboardMqttConfig, node);
                const mysqlClient = await ClientRegistry.getMySqlClient(mysqlConfig, node);

                if (!modbusClient || !localMqttClient || !thingsboardMqttClient || !mysqlClient) {
                    node.error("[Marine] Failed to retrieve clients from registry");
                    node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
                    return;
                }

                // Initialize TypeORM DataSource for Marine IoT
                // Add delay to ensure env-loader has time to load env variables
                node.log('[Marine] Waiting for env-loader to complete...');
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

                // Verify env variables are loaded
                const dbHost = globalHelper.getEnvVar('DATABASE_HOST', 'NOT_LOADED');
                node.log(`[Marine] DATABASE_HOST from global context: ${dbHost}`);

                // Load SCALE_CONFIGS from env and set to global context
                const scaleConfigsJson = globalHelper.getEnvVar('SCALE_CONFIGS', '[]');
                try {
                    const scaleConfigs = JSON.parse(scaleConfigsJson);
                    nodeContext.global.set('scaleConfigs', scaleConfigs);
                    node.log(`[Marine] Loaded ${scaleConfigs.length} scale configurations`);
                } catch (error) {
                    node.warn(`[Marine] Failed to parse SCALE_CONFIGS: ${(error as Error).message}`);
                    nodeContext.global.set('scaleConfigs', []);
                }

                const dataSource = await createDataSource(nodeContext);
                if (!dataSource.isInitialized) {
                    await dataSource.initialize();
                    node.log('[Marine] Database connection initialized');
                }

                // Initialize Marine IoT processor
                if (marineConfig.enabled) {
                    marineProcessor = new ViisMarinetTelemetryProcessor(
                        node,
                        nodeContext,
                        dataSource,
                        marineConfig,
                        envConfig.deviceId
                    );
                    node.log(`[Marine] Marine IoT enabled for sensors: ${marineConfig.flowSensorKeys.join(', ')}`);
                } else {
                    node.log('[Marine] Marine IoT disabled');
                }

                // Initialize DH6400 Polling Service (NEW)
                const dh6400Config = createDH6400Config(globalHelper, config);
                if (dh6400Config.enabled) {
                    dh6400PollingService = new DH6400PollingService(node, nodeContext, dh6400Config);
                    node.log(`[Marine] DH6400 serial polling enabled for ${dh6400Config.enabledChannels.length} channels`);
                } else {
                    node.log('[Marine] DH6400 serial polling disabled');
                }

                // Initialize connection manager
                const connectionManager = new ViisTelemetryConnectionManager(
                    node,
                    modbusClient,
                    localMqttClient,
                    thingsboardMqttClient,
                    mysqlClient
                );

                // Initialize polling service
                const pollingService = new ViisTelemetryPollingService(
                    node,
                    nodeContext,
                    modbusClient
                );

                // Initialize telemetry processor
                const processorConfig: TelemetryProcessorConfig = {
                    emqxTopic: mqttTopicConfig.emqx,
                    thingsboardTopic: mqttTopicConfig.thingsboard,
                    debugLogKey,
                    thresholdConfigKey,
                };

                const periodicSnapshotConfig: PeriodicSnapshotConfig = {
                    coil: pollingConfig.coil.periodicSnapshotInterval,
                    input: pollingConfig.input.periodicSnapshotInterval,
                    holding: pollingConfig.holding.periodicSnapshotInterval,
                };

                const telemetryProcessor = new ViisTelemetryProcessor(
                    node,
                    nodeContext,
                    flowContext,
                    localMqttClient,
                    thingsboardMqttClient,
                    processorConfig,
                    periodicSnapshotConfig
                );

                // Setup event handlers with Marine IoT integration
                setupEventHandlers(
                    node,
                    connectionManager,
                    pollingService,
                    telemetryProcessor,
                    marineProcessor,
                    dh6400PollingService,
                    pollingConfig,
                    envConfig
                );

                // Setup input message handler
                setupInputHandler(node, telemetryProcessor, marineProcessor, flowContext, debugLogKey, thresholdConfigKey);

                // Setup cleanup handler
                setupCleanupHandler(
                    node,
                    pollingService,
                    connectionManager,
                    thingsboardMqttClient,
                    dh6400PollingService,
                    flowContext,
                    debugLogKey,
                    thresholdConfigKey,
                    isMultiBoardMode,
                    currentBoardId,
                    dataSource
                );

                // Start polling if all clients are connected
                if (connectionManager.areAllClientsConnected()) {
                    startPolling(pollingService, pollingConfig, envConfig);

                    // Start DH6400 polling if enabled
                    if (dh6400PollingService) {
                        dh6400PollingService.startPolling();
                        node.log('[Marine] DH6400 polling started');
                    }

                    node.status({ fill: "green", shape: "dot", text: "Marine IoT polling active" });
                } else {
                    node.status({ fill: "red", shape: "ring", text: "Waiting for connections" });
                }

            } catch (error) {
                node.error(`[Marine] Node initialization failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            node.error(`[Marine] Async initialization failed: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
    }

    // Helper functions (reuse from viis-telemetry)
    function readModbusConfig(globalHelper: GlobalContextHelper) {
        // Try lowercase first (env-loader uses lowercase), then uppercase
        let boardsConfig = globalHelper.getEnvVar('modbus_boards', null);
        if (!boardsConfig) {
            boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);
        }

        if (boardsConfig) {
            try {
                let boards;

                if (Array.isArray(boardsConfig)) {
                    boards = boardsConfig;
                } else if (typeof boardsConfig === 'string') {
                    boards = JSON.parse(boardsConfig);
                } else {
                    boards = null;
                }

                if (Array.isArray(boards) && boards.length > 0) {
                    // Try lowercase first for default board
                    let defaultBoard = globalHelper.getEnvVar('modbus_default_board', null);
                    if (!defaultBoard) {
                        defaultBoard = globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id);
                    }

                    return {
                        mode: 'multi',
                        boards: boards,
                        defaultBoard: defaultBoard
                    };
                }
            } catch (e) {
                // Ignore parse errors, fall through to single mode
            }
        }

        return {
            mode: 'single',
            config: {
                type: (globalHelper.getEnvVar('MODBUS_TYPE', 'TCP') as "TCP" | "RTU"),
                host: globalHelper.getEnvVar('MODBUS_HOST', 'localhost'),
                tcpPort: globalHelper.getNumericEnvVar('MODBUS_TCP_PORT', 502),
                serialPort: globalHelper.getEnvVar('MODBUS_SERIAL_PORT', '/dev/ttyUSB0'),
                baudRate: globalHelper.getNumericEnvVar('MODBUS_BAUD_RATE', 9600),
                parity: (globalHelper.getEnvVar('MODBUS_PARITY', 'none') as "none" | "even" | "odd"),
                unitId: globalHelper.getNumericEnvVar('MODBUS_UNIT_ID', 1),
                timeout: globalHelper.getNumericEnvVar('MODBUS_TIMEOUT', 5000),
                reconnectInterval: globalHelper.getNumericEnvVar('MODBUS_RECONNECT_INTERVAL', 5000),
            }
        };
    }

    function createLocalMqttConfig(globalHelper: GlobalContextHelper, _deviceId: string): MqttConfig {
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

    function createThingsboardMqttConfig(globalHelper: GlobalContextHelper): MqttConfig {
        const host = globalHelper.getEnvVar('THINGSBOARD_HOST', 'mqtt.viis.tech');
        const port = globalHelper.getEnvVar('THINGSBOARD_PORT', '1883');
        const deviceToken = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
        const password = globalHelper.getEnvVar('THINGSBOARD_PASSWORD', '');

        if (!deviceToken || deviceToken.trim() === '') {
            throw new Error('DEVICE_ACCESS_TOKEN is required for ThingsBoard MQTT connection');
        }

        return {
            broker: `mqtt://${host}:${port}`,
            clientId: `node-red-marine-telemetry-${Math.random().toString(16).substring(2, 10)}`,
            username: deviceToken,
            password: password,
            qos: 1,
            connectTimeout: 30000,
            keepalive: 60,
            maxReconnectAttempts: 15,
            reconnectBackoffMultiplier: 1.5,
            maxReconnectDelay: 60000,
            enableCircuitBreaker: true
        };
    }

    function createMySqlConfig(globalHelper: GlobalContextHelper): MySqlConfig {
        return {
            host: globalHelper.getEnvVar('DATABASE_HOST', 'localhost'),
            port: globalHelper.getNumericEnvVar('DATABASE_PORT', 3306),
            user: globalHelper.getEnvVar('DATABASE_USER', 'root'),
            password: globalHelper.getEnvVar('DATABASE_PASSWORD', ''),
            database: globalHelper.getEnvVar('DATABASE_NAME', 'your_database'),
            connectionLimit: globalHelper.getNumericEnvVar('DATABASE_CONNECTION_LIMIT', 10),
        };
    }

    function createDH6400Config(globalHelper: GlobalContextHelper, nodeConfig: ViisMarinetTelemetryNodeDef): DH6400PollingConfig {
        const dh6400Enabled = globalHelper.getEnvVar('DH6400_ENABLED', 'false') === 'true';

        if (!dh6400Enabled) {
            return {
                enabled: false,
                pollingInterval: 1000,
                serialPort: '',
                baudRate: 9600,
                enabledChannels: []
            };
        }

        const serialPort = globalHelper.getEnvVar('DH6400_SERIAL_PORT', '/dev/ttyACM0');
        const enabledChannelsStr = globalHelper.getEnvVar('DH6400_ENABLED_CHANNELS', '1,2,3,4,5,6');
        const enabledChannels = enabledChannelsStr
            .split(',')
            .map(ch => parseInt(ch.trim()))
            .filter(ch => ch >= 1 && ch <= 6);

        return {
            enabled: serialPort.trim() !== '' && enabledChannels.length > 0,
            pollingInterval: globalHelper.getNumericEnvVar('DH6400_POLLING_INTERVAL', 1000),
            serialPort: serialPort.trim(),
            baudRate: globalHelper.getNumericEnvVar('DH6400_BAUD_RATE', 9600),
            enabledChannels: enabledChannels
        };
    }

    function setupEventHandlers(
        node: Node,
        connectionManager: ViisTelemetryConnectionManager,
        pollingService: ViisTelemetryPollingService,
        telemetryProcessor: ViisTelemetryProcessor,
        marineProcessor: ViisMarinetTelemetryProcessor | null,
        dh6400PollingService: DH6400PollingService | null,
        pollingConfig: PollingConfig,
        envConfig: EnvironmentConfig
    ): void {
        connectionManager.on('all-connected', () => {
            pollingService.resumePolling();
            startPolling(pollingService, pollingConfig, envConfig);

            // Resume DH6400 polling if enabled
            if (dh6400PollingService) {
                dh6400PollingService.resumePolling();
            }

            node.status({ fill: "green", shape: "dot", text: "Marine IoT polling active" });
        });

        connectionManager.on('any-disconnected', () => {
            pollingService.pausePolling();

            // Pause DH6400 polling if enabled
            if (dh6400PollingService) {
                dh6400PollingService.pausePolling();
            }

            node.status({ fill: "red", shape: "ring", text: "Client disconnected" });
        });

        // Handle telemetry data with Marine IoT integration
        pollingService.on('telemetry-data', async (event: TelemetryDataEvent) => {
            try {
                // Process standard telemetry
                await telemetryProcessor.processTelemetryData(event);

                // Process Marine IoT data if enabled
                if (marineProcessor && event.data) {
                    // Process flow sensor data (fs01-fs06)
                    const flowSensorData = await marineProcessor.processFlowSensorData(event.data);
                    if (flowSensorData.length > 0) {
                        await marineProcessor.saveFlowSensorData(flowSensorData);
                    }

                    // Process TFS data (tfs01-tfs06) from raw holding registers
                    if (event.rawData && event.source === REGISTER_TYPES.HOLDING_REGISTERS) {
                        const tfsData = await marineProcessor.processTfsData(event.rawData);
                        if (tfsData.length > 0) {
                            node.log(`[Marine] Processed ${tfsData.length} TFS sensors`);
                        }
                    }
                }
            } catch (error) {
                node.error(`[Marine] Failed to process telemetry: ${(error as Error).message}`);
            }
        });

        // Handle DH6400 telemetry data (NEW)
        if (dh6400PollingService && marineProcessor) {
            dh6400PollingService.on('telemetry-data', async (event: DH6400TelemetryEvent) => {
                try {
                    // Process DH6400 flow data (fs01-fs06)
                    await marineProcessor.processDH6400FlowData(event.rawData);

                    // Process DH6400 TFS data (tfs01-tfs06)
                    await marineProcessor.processDH6400Data(event.rawData);

                    node.log(`[Marine] DH6400 data processed: ${event.rawData.size} channels`);
                } catch (error) {
                    node.error(`[Marine] Failed to process DH6400 data: ${(error as Error).message}`);
                }
            });
        }
    }

    function startPolling(
        pollingService: ViisTelemetryPollingService,
        pollingConfig: PollingConfig,
        envConfig: EnvironmentConfig
    ): void {
        pollingService.startPolling(
            pollingConfig.coil,
            pollingConfig.input,
            pollingConfig.holding,
            {
                coils: envConfig.modbusCoils,
                inputRegisters: envConfig.modbusInputRegisters,
                holdingRegisters: envConfig.modbusHoldingRegisters,
            }
        );
    }

    function setupInputHandler(
        node: Node,
        telemetryProcessor: ViisTelemetryProcessor,
        marineProcessor: ViisMarinetTelemetryProcessor | null,
        _flowContext: NodeContext,
        _debugLogKey: string,
        _thresholdConfigKey: string
    ): void {
        node.on('input', (msg: any) => {
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

                // Handle Marine IoT specific commands
                if (marineProcessor) {
                    if (msg.clearProfileCache === true) {
                        marineProcessor.clearCache();
                        node.log('[Marine] Profile cache cleared via input message');
                    }

                    if (msg.getCacheStatus === true) {
                        const status = marineProcessor.getCacheStatus();
                        node.send({ payload: status, topic: 'marine-cache-status' });
                    }
                }
            } catch (error) {
                node.error(`[Marine] Failed to process input: ${(error as Error).message}`);
            }
        });
    }

    function setupCleanupHandler(
        node: Node,
        pollingService: ViisTelemetryPollingService,
        connectionManager: ViisTelemetryConnectionManager,
        thingsboardMqttClient: MqttClientCore,
        dh6400PollingService: DH6400PollingService | null,
        flowContext: NodeContext,
        debugLogKey: string,
        thresholdConfigKey: string,
        isMultiBoardMode: boolean,
        currentBoardId: string | undefined,
        dataSource: any
    ): void {
        node.on('close', async (done: () => void) => {
            try {
                pollingService.stopPolling();

                // Cleanup DH6400 polling service
                if (dh6400PollingService) {
                    await dh6400PollingService.cleanup();
                    node.log('[Marine] DH6400 polling service cleaned up');
                }

                connectionManager.cleanup();
                flowContext.set(debugLogKey, false);
                flowContext.set(thresholdConfigKey, {});

                if (isMultiBoardMode && currentBoardId) {
                    ClientRegistry.releaseClientV2('modbus-board', node, currentBoardId);
                } else {
                    ClientRegistry.releaseClientV2('modbus', node);
                }
                ClientRegistry.releaseClient('local', node);
                ClientRegistry.releaseClient('mysql', node);

                thingsboardMqttClient.disconnect();

                // Cleanup DataSource (singleton shared across nodes)
                // Only destroy if still initialized to avoid race conditions
                if (dataSource && dataSource.isInitialized) {
                    try {
                        await dataSource.destroy();
                        node.log('[Marine] Database connection closed');
                    } catch (dbError) {
                        // Ignore if already closed by another node
                        if (!(dbError as Error).message.includes('not yet established')) {
                            node.warn(`[Marine] Database cleanup warning: ${(dbError as Error).message}`);
                        }
                    }
                }

                node.log('[Marine] Node closed and cleaned up');
                done();
            } catch (error) {
                node.error(`[Marine] Cleanup error: ${(error as Error).message}`);
                done();
            }
        });
    }

    RED.nodes.registerType("viis-marine-telemetry", ViisMarinetTelemetryNode);
};

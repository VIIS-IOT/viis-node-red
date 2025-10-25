/**
 * Refactored viis-telemetry node with improved architecture
 * Clean, maintainable, and debuggable implementation following Google standards
 */

import { NodeAPI, Node, NodeContext } from "node-red";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
import { MySqlConfig } from "../../core/mysql-client";
import { MqttConfig, MqttClientCore } from "../../core/mqtt-client";
import {
  ViisTelemetryNodeDef,
  ViisTelemetryConfigManager,
  PollingConfig,
  EnvironmentConfig
} from './viis-telemetry-config';
import { ViisTelemetryConnectionManager } from './viis-telemetry-connection-manager';
import { ViisTelemetryPollingService } from './viis-telemetry-polling-service';
import {
  ViisTelemetryProcessor,
  TelemetryDataEvent,
  TelemetryProcessorConfig,
  PeriodicSnapshotConfig
} from './viis-telemetry-processor';
import { CONTEXT_KEYS } from './viis-telemetry-constants';
import { GlobalContextHelper } from "../../ultils/global-context-helper";

/**
 * Register viis-telemetry node with Node-RED
 */
module.exports = function (RED: NodeAPI) {
  /**
   * API endpoint to get Modbus keys from environment variables
   */
  RED.httpAdmin.get('/viis-telemetry/modbus-keys', (_req, res) => {
    try {
      // Create a temporary global context helper for the HTTP endpoint
      const tempNodeContext = {
        global: {
          get: (key: string) => RED.settings.functionGlobalContext?.[key]
        }
      } as NodeContext;

      const globalHelper = new GlobalContextHelper(tempNodeContext);

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
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message,
        keys: []
      });
    }
  });

  /**
   * Main viis-telemetry node implementation
   */
  function ViisTelemetryNode(this: Node, config: ViisTelemetryNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;
    const nodeContext: NodeContext = this.context();
    const flowContext = this.context().flow as NodeContext;

    // Initialize GlobalContextHelper
    const globalHelper = new GlobalContextHelper(this.context());
    
    // Multi-board state variables (declared at function scope for cleanup access)
    let currentBoardId: string | undefined = config.boardId;
    let isMultiBoardMode: boolean = false;
    let currentModbusConfig: any;
    
    // Variables to store clients for cleanup
    let thingsboardMqttClient: MqttClientCore | null = null;

    // Wrap async initialization in IIFE to avoid Node-RED registration issues
    (async () => {
      try {
        // Initialize configuration manager
        const configManager = new ViisTelemetryConfigManager(config, nodeContext);
        const pollingConfig = configManager.getPollingConfig();
        const envConfig = configManager.getEnvironmentConfig();
        const mqttTopicConfig = configManager.getMqttTopicConfig(envConfig.deviceId);

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
            node.log(`Multi-board mode detected with ${configData.boards.length} boards`);
            
            const multiConfig: MultiModbusConfig = {
                mode: 'multi',
                defaultBoard: configData.defaultBoard,
                boards: configData.boards
            };
            ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
        } else {
            isMultiBoardMode = false;
            node.log(`Single-board mode`);
        }
        const localMqttConfig = createLocalMqttConfig(globalHelper, envConfig.deviceId);
        const thingsboardMqttConfig = createThingsboardMqttConfig(globalHelper);
        const mysqlConfig = createMySqlConfig(globalHelper);

        // Get clients from registry
        let modbusClient;
        if (isMultiBoardMode) {
            const boardToUse = currentBoardId || configData.defaultBoard;
            node.log(`Getting client for board: ${boardToUse}`);
            modbusClient = ClientRegistry.getModbusClientV2(boardToUse, node);
        } else {
            modbusClient = ClientRegistry.getModbusClientV2(configData.config, node);
        }
        const localMqttClient = await ClientRegistry.getLocalMqttClient(localMqttConfig, node);
        thingsboardMqttClient = await ClientRegistry.getThingsboardMqttClient(thingsboardMqttConfig, node);
        const mysqlClient = await ClientRegistry.getMySqlClient(mysqlConfig, node);

        if (!modbusClient || !localMqttClient || !thingsboardMqttClient || !mysqlClient) {
          node.error("Failed to retrieve clients from registry");
          node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
          return;
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
          modbusClient,
          currentBoardId,
          envConfig.deviceId
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

        // Setup event handlers
        setupEventHandlers(
          node,
          connectionManager,
          pollingService,
          telemetryProcessor,
          pollingConfig,
          envConfig
        );

        // Setup input message handler
        setupInputHandler(node, telemetryProcessor, flowContext, debugLogKey, thresholdConfigKey);

        // Setup cleanup handler
        setupCleanupHandler(
          node,
          pollingService,
          connectionManager,
          thingsboardMqttClient,
          flowContext,
          debugLogKey,
          thresholdConfigKey,
          isMultiBoardMode,
          currentBoardId
        );

        // Start polling if all clients are connected
        if (connectionManager.areAllClientsConnected()) {
          startPolling(pollingService, pollingConfig, envConfig);
          node.status({ fill: "green", shape: "dot", text: "Polling started" });
        } else {
          node.status({ fill: "red", shape: "ring", text: "Waiting for all clients to connect" });
        }

      } catch (error) {
        node.error(`Node initialization failed: ${(error as Error).message}`);
        node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
      }
    })().catch((error) => {
      node.error(`Async initialization failed: ${(error as Error).message}`);
      node.status({ fill: "red", shape: "ring", text: "Async init failed" });
    });
  }

  /**
   * Read Modbus configuration with multi-board support
   */
  function readModbusConfig(globalHelper: GlobalContextHelper) {
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
          // Invalid type, fall through to single mode
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

  /**
   * Create local MQTT configuration
   */
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

  /**
   * Create ThingsBoard MQTT configuration with validation
   */
  function createThingsboardMqttConfig(globalHelper: GlobalContextHelper): MqttConfig {
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

  /**
   * Setup event handlers for connection and telemetry processing
   */
  function setupEventHandlers(
    node: Node,
    connectionManager: ViisTelemetryConnectionManager,
    pollingService: ViisTelemetryPollingService,
    telemetryProcessor: ViisTelemetryProcessor,
    pollingConfig: PollingConfig,
    envConfig: EnvironmentConfig
  ): void {
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
    pollingService.on('telemetry-data', async (event: TelemetryDataEvent) => {
      try {
        await telemetryProcessor.processTelemetryData(event);
      } catch (error) {
        node.error(`Failed to process telemetry data: ${(error as Error).message}`);
      }
    });
  }

  /**
   * Start polling for all register types
   */
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

  /**
   * Setup input message handler for dynamic configuration updates
   */
  function setupInputHandler(
    node: Node,
    telemetryProcessor: ViisTelemetryProcessor,
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
      } catch (error) {
        node.error(`Failed to process input message: ${(error as Error).message}`);
      }
    });
  }

  /**
   * Setup cleanup handler for node shutdown
   */
  function setupCleanupHandler(
    node: Node,
    pollingService: ViisTelemetryPollingService,
    connectionManager: ViisTelemetryConnectionManager,
    thingsboardMqttClient: MqttClientCore,
    flowContext: NodeContext,
    debugLogKey: string,
    thresholdConfigKey: string,
    isMultiBoardMode: boolean,
    currentBoardId: string | undefined
  ): void {
    node.on('close', async (done: () => void) => {
      try {
        // Stop polling
        pollingService.stopPolling();

        // Cleanup connection manager
        connectionManager.cleanup();

        // Clear flow context
        flowContext.set(debugLogKey, false);
        flowContext.set(thresholdConfigKey, {});

        // Release clients
        if (isMultiBoardMode && currentBoardId) {
            ClientRegistry.releaseClientV2('modbus-board', node, currentBoardId);
        } else {
            ClientRegistry.releaseClientV2('modbus', node);
        }
        ClientRegistry.releaseClient('local', node);
        ClientRegistry.releaseClient('mysql', node);

        // Disconnect ThingsBoard client
        thingsboardMqttClient.disconnect();

        node.log('[Node] Closed and cleaned up successfully');
        done();
      } catch (error) {
        node.error(`Cleanup error: ${(error as Error).message}`);
        done();
      }
    });
  }

  // Register the node type with Node-RED
  RED.nodes.registerType("viis-telemetry", ViisTelemetryNode);
};

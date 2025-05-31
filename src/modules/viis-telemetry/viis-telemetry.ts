/**
 * Refactored viis-telemetry node with improved architecture
 * Clean, maintainable, and debuggable implementation following Google standards
 */

import { NodeAPI, Node, NodeContext } from "node-red";
import ClientRegistry from "../../core/client-registry";
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

/**
 * Register viis-telemetry node with Node-RED
 */
module.exports = function (RED: NodeAPI) {
  /**
   * API endpoint to get Modbus keys from environment variables
   */
  RED.httpAdmin.get('/viis-telemetry/modbus-keys', (_req, res) => {
    try {
      // Try to get from global context first, fallback to process.env
      const globalContext = RED.settings.functionGlobalContext || {};

      const getJsonEnvVar = (envVarName: string, globalVarName: string, defaultValue: any = {}): any => {
        // Try global context first
        const globalValue = globalContext[globalVarName];
        if (globalValue !== undefined) {
          return typeof globalValue === 'object' ? globalValue : defaultValue;
        }

        // Fallback to process.env
        const processValue = process.env[envVarName];
        if (processValue) {
          try {
            return JSON.parse(processValue);
          } catch (error) {
            console.warn(`Failed to parse JSON for ${envVarName}:`, error.message);
            return defaultValue;
          }
        }

        return defaultValue;
      };

      const modbusCoils = getJsonEnvVar('MODBUS_COILS', 'modbusCoils', {});
      const modbusInputRegisters = getJsonEnvVar('MODBUS_INPUT_REGISTERS', 'modbusInputRegisters', {});
      const modbusHoldingRegisters = getJsonEnvVar('MODBUS_HOLDING_REGISTERS', 'modbusHoldingRegisters', {});

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
        const modbusConfig = createModbusConfig();
        const localMqttConfig = createLocalMqttConfig(envConfig.deviceId);
        const thingsboardMqttConfig = createThingsboardMqttConfig(nodeContext);
        const mysqlConfig = createMySqlConfig();

        // Get clients from registry
        const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
        const localMqttClient = await ClientRegistry.getLocalMqttClient(localMqttConfig, node);
        const thingsboardMqttClient = await ClientRegistry.getThingsboardMqttClient(thingsboardMqttConfig, node);
        const mysqlClient = ClientRegistry.getMySqlClient(mysqlConfig, node);

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
          thresholdConfigKey
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
   * Create Modbus configuration from environment variables
   */
  function createModbusConfig() {
    return {
      type: (process.env.MODBUS_TYPE as "TCP" | "RTU") || "TCP",
      host: process.env.MODBUS_HOST || "localhost",
      tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "502", 10),
      serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
      baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
      parity: (process.env.MODBUS_PARITY as "none" | "even" | "odd") || "none",
      unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
      timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
      reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
    };
  }

  /**
   * Create local MQTT configuration
   */
  function createLocalMqttConfig(_deviceId: string): MqttConfig {
    const host = process.env.EMQX_HOST || "emqx";
    const port = parseInt(process.env.EMQX_PORT || "1883", 10);

    return {
      broker: `mqtt://${host}:${port}`,
      clientId: `node-red-local-${Math.random().toString(16).substring(2, 10)}`,
      username: process.env.EMQX_USERNAME || "",
      password: process.env.EMQX_PASSWORD || "",
      qos: 1,
    };
  }

  /**
   * Create ThingsBoard MQTT configuration
   */
  function createThingsboardMqttConfig(nodeContext: NodeContext): MqttConfig {
    // Try to get from global context first, fallback to process.env
    const globalContext = nodeContext.global;

    const getEnvVar = (envVarName: string, globalVarName: string, defaultValue: string): string => {
      // Try global context first
      const globalValue = globalContext.get(globalVarName);
      if (globalValue !== undefined) {
        return String(globalValue);
      }

      // Fallback to process.env
      return process.env[envVarName] || defaultValue;
    };

    const host = getEnvVar('THINGSBOARD_HOST', 'thingsboard_host', 'mqtt.viis.tech');
    const port = getEnvVar('THINGSBOARD_PORT', 'thingsboard_port', '1883');
    const deviceToken = getEnvVar('DEVICE_ACCESS_TOKEN', 'device_access_token', '');
    const password = getEnvVar('THINGSBOARD_PASSWORD', 'thingsboard_password', '');

    return {
      broker: `mqtt://${host}:${port}`,
      clientId: `node-red-thingsboard-telemetry-${Math.random().toString(16).substring(2, 10)}`,
      username: deviceToken,
      password: password,
      qos: 1,
    };
  }

  /**
   * Create MySQL configuration
   */
  function createMySqlConfig(): MySqlConfig {
    return {
      host: process.env.DATABASE_HOST || "localhost",
      port: parseInt(process.env.DATABASE_PORT || "3306", 10),
      user: process.env.DATABASE_USER || "root",
      password: process.env.DATABASE_PASSWORD || "",
      database: process.env.DATABASE_NAME || "your_database",
      connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || "10", 10),
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
    thresholdConfigKey: string
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
        ClientRegistry.releaseClient('modbus', node);
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

/**
 * viis-ais-telemetry Node (Refactored)
 * Connects to AIS Gateway, parses NMEA/AIS data, and outputs telemetry
 *
 * Refactored to follow Clean Code principles:
 * - Single Responsibility Principle (SRP)
 * - Dependency Injection for testability
 * - Strategy Pattern for NMEA parsing
 * - Repository Pattern for database operations
 * - Builder Pattern for payload construction
 */

import { NodeAPI, Node, NodeContext } from "node-red";
import { GlobalContextHelper } from "../../ultils/global-context-helper";

// Local imports
import { DEFAULT_CONFIG } from "./constants";
import { ViisAisTelemetryNodeDef } from "./viis-ais-telemetry-config";
import { NodeRedLogger, ConditionalLogger, ILogger } from "./utils/logger";
import { NmeaParser } from "./parsers/nmea-parser";
import { StateManager, StateManagerConfig } from "./state/state-manager";
import { TcpGatewayClient } from "./network/tcp-gateway-client";
import { DatabaseTelemetryRepository, ITelemetryRepository } from "./repository/telemetry-repository";
import { TelemetryPayloadBuilder } from "./builders/payload-builder";

module.exports = function (RED: NodeAPI) {

  function ViisAisTelemetryNode(this: Node, config: ViisAisTelemetryNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;
    const nodeContext: NodeContext = this.context();
    const globalHelper = new GlobalContextHelper(nodeContext);
    const deviceId = globalHelper.getEnvVar('DEVICE_ID', 'unknown-device');

    // ===== CONFIGURATION =====
    const aisHost = config.aisHost || DEFAULT_CONFIG.AIS_HOST;
    const aisPort = config.aisPort || DEFAULT_CONFIG.AIS_PORT;
    const outputInterval = config.outputInterval || DEFAULT_CONFIG.OUTPUT_INTERVAL_MS;
    const aisTtlSec = config.aisTtlSec || DEFAULT_CONFIG.AIS_TTL_SEC;
    const nearbyRadiusNm = config.nearbyRadiusNm || DEFAULT_CONFIG.NEARBY_RADIUS_NM;
    const nearbyMaxAgeSec = config.nearbyMaxAgeSec || DEFAULT_CONFIG.NEARBY_MAX_AGE_SEC;
    const useOwnShipFromAis = config.useOwnShipFromAis !== false;
    const enableLogging = config.enableLogging === true;

    // ===== DEPENDENCY INJECTION =====

    // Logger with conditional debug logging
    const baseLogger = new NodeRedLogger(
      (msg) => node.log(msg),
      (msg) => node.warn(msg),
      (msg) => node.error(msg)
    );
    const logger: ILogger = new ConditionalLogger(baseLogger, enableLogging);

    // NMEA Parser (Strategy Pattern)
    const nmeaParser = new NmeaParser();

    // State Manager
    const stateManagerConfig: StateManagerConfig = {
      aisTtlSec,
      nearbyRadiusNm,
      nearbyMaxAgeSec,
      useOwnShipFromAis
    };
    const stateManager = new StateManager(stateManagerConfig, logger);

    // Telemetry Repository (Repository Pattern)
    const telemetryRepo: ITelemetryRepository = new DatabaseTelemetryRepository(
      nodeContext,
      deviceId,
      logger
    );

    // Payload Builder (Builder Pattern)
    const payloadBuilder = new TelemetryPayloadBuilder({
      nearbyRadiusNm,
      nearbyMaxAgeSec
    });

    // TCP Gateway Client
    const tcpClient = new TcpGatewayClient(
      { host: aisHost, port: aisPort },
      logger
    );

    // ===== STATE =====
    let outputTimer: NodeJS.Timeout | null = null;
    let messageCount = 0;
    let isClosing = false;
    let isOutputting = false;

    node.log(`[AIS] Initializing - Host: ${aisHost}:${aisPort}, Output interval: ${outputInterval}ms`);

    // ===== EVENT HANDLERS =====

    tcpClient.on("connect", () => {
      node.status({ fill: "green", shape: "dot", text: "Connected" });
      messageCount = 0;
    });

    tcpClient.on("data", (line: string) => {
      try {
        const parsed = nmeaParser.parse(line);
        if (parsed) {
          stateManager.updateFromParsedData(parsed);
          messageCount++;
        }
      } catch (err) {
        node.warn(`[AIS] Parse error: ${(err as Error).message}`);
      }
    });

    tcpClient.on("error", (err: Error) => {
      node.status({ fill: "red", shape: "ring", text: `Error: ${err.message}` });
    });

    tcpClient.on("statusChange", (status) => {
      if (status === "connecting") {
        node.status({ fill: "yellow", shape: "ring", text: "Connecting..." });
      } else if (status === "disconnected" && !isClosing) {
        node.status({ fill: "yellow", shape: "ring", text: "Reconnecting..." });
      }
    });

    // ===== OUTPUT FUNCTION =====

    async function outputData(): Promise<void> {
      if (isOutputting) return;
      isOutputting = true;

      try {
        // Cleanup stale targets
        const removedCount = stateManager.cleanupOldTargets();
        if (removedCount > 0) {
          logger.debug(`[AIS] Cleaned up ${removedCount} stale targets`);
        }

        // Build payload using Builder Pattern
        const state = stateManager.getState();
        const payload = payloadBuilder.fromState(state).build();
        const targetCount = stateManager.getAisTargetCount();

        // Log output summary
        node.log(`[AIS] Output triggered @ ${new Date().toISOString()} - ${targetCount} AIS targets, ${messageCount} messages received`);

        if (enableLogging && targetCount > 0) {
          const mmsiList = Object.keys(state.ais).slice(0, 5).join(', ');
          logger.debug(`[AIS] Targets: ${mmsiList}${targetCount > 5 ? ` ... and ${targetCount - 5} more` : ''}`);
        }

        // Send output
        node.send({
          topic: "ais-telemetry",
          payload
        });

        // Save to database (Repository Pattern)
        void telemetryRepo.save(payload);

        // Update status
        node.status({
          fill: "green",
          shape: "dot",
          text: `${targetCount} targets @ ${new Date().toLocaleTimeString()}`
        });

      } catch (err) {
        node.warn(`[AIS] Output error: ${(err as Error).message}`);
      } finally {
        isOutputting = false;
      }
    }

    // ===== INITIALIZATION =====

    // Initialize database
    void telemetryRepo.initialize();

    // Start output timer
    outputTimer = setInterval(() => {
      void outputData();
    }, outputInterval);
    node.log(`[AIS] Output timer started: ${outputInterval}ms interval`);

    // Connect to gateway
    tcpClient.connect();

    // ===== INPUT HANDLER =====

    node.on("input", (msg: any) => {
      if (msg.getStatus === true) {
        const targetCount = stateManager.getAisTargetCount();
        const state = stateManager.getState();
        node.send({
          topic: "ais-status",
          payload: {
            connected: tcpClient.isConnected,
            targetCount,
            messageCount,
            lastUpdate: state.lastUpdate
          }
        });
      }

      if (msg.forceOutput === true) {
        void outputData();
      }

      if (msg.clearState === true) {
        stateManager.clearState();
        node.log("[AIS] State cleared");
      }
    });

    // ===== CLEANUP =====

    node.on("close", (done: () => void) => {
      isClosing = true;
      node.log("[AIS] Shutting down...");

      // Clear timers
      if (outputTimer) {
        clearInterval(outputTimer);
        outputTimer = null;
      }

      // Disconnect TCP client
      tcpClient.disconnect();

      // Close repository
      void telemetryRepo.close();

      const targetCount = stateManager.getAisTargetCount();
      node.log(`[AIS] Closed. Final stats: ${targetCount} targets, ${messageCount} messages`);

      done();
    });
  }

  RED.nodes.registerType("viis-ais-telemetry", ViisAisTelemetryNode);
};

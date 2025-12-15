"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const global_context_helper_1 = require("../../ultils/global-context-helper");
// Local imports
const constants_1 = require("./constants");
const logger_1 = require("./utils/logger");
const nmea_parser_1 = require("./parsers/nmea-parser");
const state_manager_1 = require("./state/state-manager");
const tcp_gateway_client_1 = require("./network/tcp-gateway-client");
const telemetry_repository_1 = require("./repository/telemetry-repository");
const payload_builder_1 = require("./builders/payload-builder");
module.exports = function (RED) {
    function ViisAisTelemetryNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext = this.context();
        const globalHelper = new global_context_helper_1.GlobalContextHelper(nodeContext);
        const deviceId = globalHelper.getEnvVar('DEVICE_ID', 'unknown-device');
        // ===== CONFIGURATION =====
        const aisHost = config.aisHost || constants_1.DEFAULT_CONFIG.AIS_HOST;
        const aisPort = config.aisPort || constants_1.DEFAULT_CONFIG.AIS_PORT;
        const outputInterval = config.outputInterval || constants_1.DEFAULT_CONFIG.OUTPUT_INTERVAL_MS;
        const aisTtlSec = config.aisTtlSec || constants_1.DEFAULT_CONFIG.AIS_TTL_SEC;
        const nearbyRadiusNm = config.nearbyRadiusNm || constants_1.DEFAULT_CONFIG.NEARBY_RADIUS_NM;
        const nearbyMaxAgeSec = config.nearbyMaxAgeSec || constants_1.DEFAULT_CONFIG.NEARBY_MAX_AGE_SEC;
        const useOwnShipFromAis = config.useOwnShipFromAis !== false;
        const enableLogging = config.enableLogging === true;
        // ===== DEPENDENCY INJECTION =====
        // Logger with conditional debug logging
        const baseLogger = new logger_1.NodeRedLogger((msg) => node.log(msg), (msg) => node.warn(msg), (msg) => node.error(msg));
        const logger = new logger_1.ConditionalLogger(baseLogger, enableLogging);
        // NMEA Parser (Strategy Pattern)
        const nmeaParser = new nmea_parser_1.NmeaParser();
        // State Manager
        const stateManagerConfig = {
            aisTtlSec,
            nearbyRadiusNm,
            nearbyMaxAgeSec,
            useOwnShipFromAis
        };
        const stateManager = new state_manager_1.StateManager(stateManagerConfig, logger);
        // Telemetry Repository (Repository Pattern)
        const telemetryRepo = new telemetry_repository_1.DatabaseTelemetryRepository(nodeContext, deviceId, logger);
        // Payload Builder (Builder Pattern)
        const payloadBuilder = new payload_builder_1.TelemetryPayloadBuilder({
            nearbyRadiusNm,
            nearbyMaxAgeSec
        });
        // TCP Gateway Client
        const tcpClient = new tcp_gateway_client_1.TcpGatewayClient({ host: aisHost, port: aisPort }, logger);
        // ===== STATE =====
        let outputTimer = null;
        let messageCount = 0;
        let isClosing = false;
        let isOutputting = false;
        node.log(`[AIS] Initializing - Host: ${aisHost}:${aisPort}, Output interval: ${outputInterval}ms`);
        // ===== EVENT HANDLERS =====
        tcpClient.on("connect", () => {
            node.status({ fill: "green", shape: "dot", text: "Connected" });
            messageCount = 0;
        });
        tcpClient.on("data", (line) => {
            try {
                const parsed = nmeaParser.parse(line);
                if (parsed) {
                    stateManager.updateFromParsedData(parsed);
                    messageCount++;
                }
            }
            catch (err) {
                node.warn(`[AIS] Parse error: ${err.message}`);
            }
        });
        tcpClient.on("error", (err) => {
            node.status({ fill: "red", shape: "ring", text: `Error: ${err.message}` });
        });
        tcpClient.on("statusChange", (status) => {
            if (status === "connecting") {
                node.status({ fill: "yellow", shape: "ring", text: "Connecting..." });
            }
            else if (status === "disconnected" && !isClosing) {
                node.status({ fill: "yellow", shape: "ring", text: "Reconnecting..." });
            }
        });
        // ===== OUTPUT FUNCTION =====
        async function outputData() {
            if (isOutputting)
                return;
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
            }
            catch (err) {
                node.warn(`[AIS] Output error: ${err.message}`);
            }
            finally {
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
        node.on("input", (msg) => {
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
        node.on("close", (done) => {
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

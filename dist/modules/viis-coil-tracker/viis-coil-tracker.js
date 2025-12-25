"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const coil_tracker_service_1 = require("./coil-tracker.service");
module.exports = function (RED) {
    function ViisCoilTrackerNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let trackerService = null;
        let mysqlClient;
        let mqttClient;
        // Initialize async components
        const initializeNode = async () => {
            try {
                node.status({ fill: "yellow", shape: "ring", text: "Initializing..." });
                // Initialize GlobalContextHelper
                const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
                // Initialize MySQL client if enabled
                if (config.storeToDatabase) {
                    try {
                        const mysqlConfig = {
                            host: globalHelper.getEnvVar('database_host', 'viis-local-mysql'),
                            port: globalHelper.getNumericEnvVar('database_port', 3306),
                            user: globalHelper.getEnvVar('database_username', 'root'),
                            password: globalHelper.getEnvVar('db_password', 'password'),
                            database: globalHelper.getEnvVar('db_database', 'viis_local')
                        };
                        mysqlClient = await client_registry_1.default.getMySqlClient(mysqlConfig, node);
                        node.log('MySQL client initialized for tracking storage');
                    }
                    catch (error) {
                        node.error(`Failed to initialize MySQL client: ${error.message}`);
                        node.warn('Database storage will be disabled');
                    }
                }
                // Initialize MQTT client if enabled
                if (config.publishMqtt) {
                    try {
                        const mqttConfig = {
                            broker: `mqtt://${globalHelper.getEnvVar('EMQX_HOST', 'emqx')}:${globalHelper.getEnvVar('EMQX_PORT', '1883')}`,
                            clientId: `coil-tracker-${node.id}`,
                            username: globalHelper.getEnvVar('EMQX_USERNAME', ''),
                            password: globalHelper.getEnvVar('EMQX_PASSWORD', ''),
                            qos: 1
                        };
                        mqttClient = await client_registry_1.default.getLocalMqttClient(mqttConfig, node);
                        node.log('MQTT client initialized for event publishing');
                    }
                    catch (error) {
                        node.error(`Failed to initialize MQTT client: ${error.message}`);
                        node.warn('MQTT publishing will be disabled');
                    }
                }
                // Initialize tracker service
                trackerService = new coil_tracker_service_1.CoilTrackerService(node, globalHelper, mysqlClient, mqttClient);
                // Initialize async components
                await trackerService.initialize();
                // Load tracking rules from config
                if (config.trackers && config.trackers.length > 0) {
                    trackerService.setTrackingRules(config.trackers);
                    node.log(`Loaded ${config.trackers.length} tracking rules`);
                }
                else {
                    node.warn('No tracking rules configured');
                }
                // Start monitoring
                trackerService.startMonitoring();
                // Update status
                const activeRules = trackerService.getTrackingRulesCount();
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `Tracking ${activeRules} rules`
                });
                node.log('Coil tracker node initialized successfully');
            }
            catch (error) {
                node.error(`Failed to initialize coil tracker: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Init failed" });
            }
        };
        // Initialize in background
        initializeNode().catch(err => {
            node.error(`Initialization error: ${err.message}`);
        });
        // Update status every 10 seconds
        const statusInterval = setInterval(() => {
            if (trackerService) {
                const activeRules = trackerService.getTrackingRulesCount();
                const activeSessions = trackerService.getActiveSessionsCount();
                const statusText = activeSessions > 0
                    ? `${activeRules} rules, ${activeSessions} active`
                    : `${activeRules} rules`;
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: statusText
                });
            }
        }, 10000);
        // Cleanup on node close
        node.on("close", async (done) => {
            try {
                // Clear status interval
                if (statusInterval) {
                    clearInterval(statusInterval);
                }
                // Stop tracker service
                if (trackerService) {
                    trackerService.stopMonitoring();
                    node.log('Tracker service stopped');
                }
                // Release MySQL client
                if (mysqlClient) {
                    client_registry_1.default.releaseClient('mysql', node);
                    node.log('MySQL client released');
                }
                // Release MQTT client
                if (mqttClient) {
                    client_registry_1.default.releaseClient('local', node);
                    node.log('MQTT client released');
                }
                node.status({});
                node.log('Coil tracker node closed');
                done();
            }
            catch (error) {
                node.error(`Cleanup error: ${error.message}`);
                done();
            }
        });
    }
    RED.nodes.registerType("viis-coil-tracker", ViisCoilTrackerNode);
};

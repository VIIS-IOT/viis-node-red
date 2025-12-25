import { NodeAPI, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { MySqlClientCore } from "../../core/mysql-client";
import { MqttClientCore } from "../../core/mqtt-client";
import { CoilTrackerService } from "./coil-tracker.service";
import { ViisCoilTrackerConfig } from "./types";

module.exports = function (RED: NodeAPI) {
    function ViisCoilTrackerNode(this: Node, config: ViisCoilTrackerConfig) {
        RED.nodes.createNode(this, config);
        const node = this;

        let trackerService: CoilTrackerService | null = null;
        let mysqlClient: MySqlClientCore | undefined;
        let mqttClient: MqttClientCore | undefined;

        // Initialize async components
        const initializeNode = async () => {
            try {
                node.status({ fill: "yellow", shape: "ring", text: "Initializing..." });

                // Initialize GlobalContextHelper
                const globalHelper = new GlobalContextHelper(node.context());

                // Initialize MySQL client if enabled
                if (config.storeToDatabase) {
                    try {
                        const mysqlConfig = {
                            host: globalHelper.getEnvVar('MYSQL_HOST', 'viis-local-mysql'),
                            port: globalHelper.getNumericEnvVar('MYSQL_PORT', 3306),
                            user: globalHelper.getEnvVar('MYSQL_USER', 'root'),
                            password: globalHelper.getEnvVar('MYSQL_PASSWORD', 'password'),
                            database: globalHelper.getEnvVar('MYSQL_DATABASE', 'viis_local')
                        };
                        mysqlClient = await ClientRegistry.getMySqlClient(mysqlConfig, node);
                        node.log('MySQL client initialized for tracking storage');
                    } catch (error) {
                        node.error(`Failed to initialize MySQL client: ${(error as Error).message}`);
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
                            qos: 1 as 0 | 1 | 2
                        };
                        mqttClient = await ClientRegistry.getLocalMqttClient(mqttConfig, node);
                        node.log('MQTT client initialized for event publishing');
                    } catch (error) {
                        node.error(`Failed to initialize MQTT client: ${(error as Error).message}`);
                        node.warn('MQTT publishing will be disabled');
                    }
                }

                // Initialize tracker service
                trackerService = new CoilTrackerService(
                    node,
                    globalHelper,
                    mysqlClient,
                    mqttClient
                );

                // Initialize async components
                await trackerService.initialize();

                // Load tracking rules from config
                if (config.trackers && config.trackers.length > 0) {
                    trackerService.setTrackingRules(config.trackers);
                    node.log(`Loaded ${config.trackers.length} tracking rules`);
                } else {
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

            } catch (error) {
                node.error(`Failed to initialize coil tracker: ${(error as Error).message}`);
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
        node.on("close", async (done: () => void) => {
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
                    ClientRegistry.releaseClient('mysql', node);
                    node.log('MySQL client released');
                }

                // Release MQTT client
                if (mqttClient) {
                    ClientRegistry.releaseClient('local', node);
                    node.log('MQTT client released');
                }

                node.status({});
                node.log('Coil tracker node closed');
                done();
            } catch (error) {
                node.error(`Cleanup error: ${(error as Error).message}`);
                done();
            }
        });
    }

    RED.nodes.registerType("viis-coil-tracker", ViisCoilTrackerNode);
};

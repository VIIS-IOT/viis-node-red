/**
 * VIIS ThingsBoard Telemetry Node
 * Sends telemetry data to ThingsBoard via HTTP API with batch support and retry mechanism
 */

import { NodeAPI, Node, NodeDef } from "node-red";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { ThingsboardHttpService, TelemetryData } from "../../services/thingsboard-http.service";
import { TelemetryQueueManager, QueueManagerConfig } from "../../services/telemetry-queue-manager";
import { AppDataSource } from "../../orm/dataSource";
import { TabiotThingsboardTelemetryQueue } from "../../orm/entities/device-telemetry/TabiotThingsboardTelemetryQueue";

/**
 * Node configuration interface
 */
interface ViisTbTelemetryNodeDef extends NodeDef {
    name: string;
    batchSize: number;
    flushInterval: number;
    maxRetries: number;
    retryInterval: number;
    enableRetry: boolean;
    enableLogging: boolean;
}


/**
 * Register the node with Node-RED
 */
module.exports = function (RED: NodeAPI) {
    
    function ViisTbTelemetryNode(this: Node, config: ViisTbTelemetryNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext = this.context();

        // Initialize GlobalContextHelper for hot-reload support
        const globalHelper = new GlobalContextHelper(nodeContext);
        
        // Variables for cleanup
        let httpService: ThingsboardHttpService | null = null;
        let queueManager: TelemetryQueueManager | null = null;
        let configCheckInterval: NodeJS.Timeout | undefined;

        // Read device configuration from global context
        let deviceId = globalHelper.getEnvVar('DEVICE_ID', '');
        let deviceToken = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
        let viisBackend = globalHelper.getEnvVar('VIIS_BACKEND', 'https://iot.viis.tech');

        // Validate critical configuration
        if (!deviceToken || deviceToken.trim() === '') {
            node.error('DEVICE_ACCESS_TOKEN is required. Please configure it in env file.');
            node.status({ fill: "red", shape: "ring", text: "Missing access token" });
            return;
        }

        // Wrap async initialization
        (async () => {
            try {
                // Initialize database connection
                if (!AppDataSource.isInitialized) {
                    await AppDataSource.initialize();
                    node.log('Database connection initialized');
                }

                const repository = AppDataSource.getRepository(TabiotThingsboardTelemetryQueue);

                // Initialize services
                httpService = new ThingsboardHttpService(nodeContext);
                
                const queueConfig: QueueManagerConfig = {
                    batchSize: config.batchSize || 10,
                    flushInterval: config.flushInterval || 5000,
                    maxRetries: config.maxRetries || 3,
                    retryInterval: config.retryInterval || 30000,
                    enableRetry: config.enableRetry !== false,
                    enableLogging: config.enableLogging || false
                };

                queueManager = new TelemetryQueueManager(
                    node,
                    httpService,
                    repository,
                    queueConfig
                );

                // Start retry job
                queueManager.startRetryJob();

                node.status({ fill: "green", shape: "dot", text: "Ready" });
                node.log(`Node initialized - Device: ${deviceId}, Backend: ${viisBackend}`);

                // Setup config hot-reload (30 second check)
                configCheckInterval = setInterval(() => {
                    const newDeviceToken = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
                    const newBackend = globalHelper.getEnvVar('VIIS_BACKEND', 'https://iot.viis.tech');

                    if (newDeviceToken !== deviceToken) {
                        deviceToken = newDeviceToken;
                        node.log(`Device token updated (hot-reload)`);
                    }

                    if (newBackend !== viisBackend) {
                        viisBackend = newBackend;
                        httpService?.updateBaseUrl(newBackend);
                        node.log(`Backend URL updated to: ${newBackend} (hot-reload)`);
                    }
                }, 30000);

            } catch (error) {
                node.error(`Initialization failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Init failed" });
            }
        })().catch((error) => {
            node.error(`Async initialization failed: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });

        /**
         * Handle input messages
         */
        node.on('input', (msg: any, send, done) => {
            (async () => {
                try {
                    if (!queueManager) {
                        node.error('Queue manager not initialized');
                        done(new Error('Queue manager not initialized'));
                        return;
                    }

                    const payload = msg.payload;

                    // Handle different payload formats
                    if (Array.isArray(payload)) {
                        // Batch array format
                        for (const item of payload) {
                            await processPayloadItem(item);
                        }
                    } else if (typeof payload === 'object' && payload !== null) {
                        await processPayloadItem(payload);
                    } else {
                        node.warn('Invalid payload format. Expected object or array.');
                        done();
                        return;
                    }

                    // Send success message
                    const stats = queueManager.getStats();
                    send({
                        payload: {
                            success: true,
                            stats: stats
                        }
                    });

                    done();
                } catch (error) {
                    node.error(`Error processing message: ${(error as Error).message}`);
                    done(error as Error);
                }
            })();
        });

        /**
         * Process individual payload item
         */
        async function processPayloadItem(item: any): Promise<void> {
            if (!queueManager) return;

            // Check if already in ThingsBoard format
            if (item.ts && item.values) {
                // Already formatted
                await queueManager.addFormattedTelemetry(
                    deviceId,
                    deviceToken,
                    item as TelemetryData
                );
            } else if (typeof item === 'object') {
                // Simple key-value object - convert to ThingsBoard format
                // Extract timestamp if present
                const timestamp = item.ts || item.timestamp || Date.now();
                const values = { ...item };
                delete values.ts;
                delete values.timestamp;

                await queueManager.addTelemetry(
                    deviceId,
                    deviceToken,
                    values,
                    timestamp
                );
            }
        }

        /**
         * Cleanup on node close
         */
        node.on('close', async (done: () => void) => {
            try {
                node.log('Closing node and cleaning up...');

                // Clear config check interval
                if (configCheckInterval) {
                    clearInterval(configCheckInterval);
                }

                // Cleanup queue manager
                if (queueManager) {
                    await queueManager.cleanup();
                }

                node.status({ fill: "grey", shape: "ring", text: "Closed" });
                node.log('Node closed successfully');
                done();
            } catch (error) {
                node.error(`Cleanup error: ${(error as Error).message}`);
                done();
            }
        });
    }

    // Register the node
    RED.nodes.registerType("viis-thingsboard-telemetry", ViisTbTelemetryNode);
};

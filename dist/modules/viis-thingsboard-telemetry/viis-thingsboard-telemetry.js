"use strict";
/**
 * VIIS ThingsBoard Telemetry Node
 * Sends telemetry data to ThingsBoard via HTTP API with batch support and retry mechanism
 */
Object.defineProperty(exports, "__esModule", { value: true });
const global_context_helper_1 = require("../../ultils/global-context-helper");
const thingsboard_http_service_1 = require("../../services/thingsboard-http.service");
const telemetry_queue_manager_1 = require("../../services/telemetry-queue-manager");
const dataSource_1 = require("../../orm/dataSource");
const TabiotThingsboardTelemetryQueue_1 = require("../../orm/entities/device-telemetry/TabiotThingsboardTelemetryQueue");
const viis_telemetry_utils_1 = require("../viis-telemetry/viis-telemetry-utils");
/**
 * Register the node with Node-RED
 */
module.exports = function (RED) {
    function ViisTbTelemetryNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext = this.context();
        // Initialize GlobalContextHelper for hot-reload support
        const globalHelper = new global_context_helper_1.GlobalContextHelper(nodeContext);
        // Variables for cleanup
        let httpService = null;
        let queueManager = null;
        let configCheckInterval;
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
            var _a;
            try {
                // Initialize database connection
                if (!dataSource_1.AppDataSource.isInitialized) {
                    await dataSource_1.AppDataSource.initialize();
                    node.log('Database connection initialized');
                }
                const repository = dataSource_1.AppDataSource.getRepository(TabiotThingsboardTelemetryQueue_1.TabiotThingsboardTelemetryQueue);
                // Initialize services
                httpService = new thingsboard_http_service_1.ThingsboardHttpService(nodeContext);
                const queueConfig = {
                    batchSize: config.batchSize || 10,
                    flushInterval: config.flushInterval || 5000,
                    maxRetries: config.maxRetries || 3,
                    retryInterval: config.retryInterval || 30000,
                    failedRetryInterval: config.failedRetryInterval || 300000, // 5 minutes
                    maxFailedRetries: (_a = config.maxFailedRetries) !== null && _a !== void 0 ? _a : 10, // 0 = unlimited
                    enableRetry: config.enableRetry !== false,
                    enableLogging: config.enableLogging || false
                };
                queueManager = new telemetry_queue_manager_1.TelemetryQueueManager(node, httpService, repository, queueConfig);
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
                        httpService === null || httpService === void 0 ? void 0 : httpService.updateBaseUrl(newBackend);
                        node.log(`Backend URL updated to: ${newBackend} (hot-reload)`);
                    }
                }, 30000);
            }
            catch (error) {
                node.error(`Initialization failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Init failed" });
            }
        })().catch((error) => {
            node.error(`Async initialization failed: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Async init failed" });
        });
        /**
         * Handle input messages
         */
        node.on('input', (msg, send, done) => {
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
                    }
                    else if (typeof payload === 'object' && payload !== null) {
                        await processPayloadItem(payload);
                    }
                    else {
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
                }
                catch (error) {
                    node.error(`Error processing message: ${error.message}`);
                    done(error);
                }
            })();
        });
        /**
         * Process individual payload item
         * Normalizes data types to ensure consistency (string numbers → numbers)
         */
        async function processPayloadItem(item) {
            if (!queueManager)
                return;
            // Check if already in ThingsBoard format
            if (item.ts && item.values) {
                // Already formatted - normalize the values
                const normalizedValues = (0, viis_telemetry_utils_1.normalizeTelemetryData)(item.values);
                const normalizedItem = {
                    ts: typeof item.ts === 'number' ? item.ts : Date.now(),
                    values: normalizedValues
                };
                await queueManager.addFormattedTelemetry(deviceId, deviceToken, normalizedItem);
            }
            else if (typeof item === 'object') {
                // Simple key-value object - normalize and convert to ThingsBoard format
                // First normalize to ensure consistent data types
                const normalized = (0, viis_telemetry_utils_1.normalizeTelemetryData)(item);
                // Extract timestamp if present
                const timestamp = typeof normalized.ts === 'number'
                    ? normalized.ts
                    : (typeof item.timestamp === 'number' ? item.timestamp : Date.now());
                // Remove timestamp fields from values
                const values = Object.assign({}, normalized);
                delete values.ts;
                delete values.timestamp;
                await queueManager.addTelemetry(deviceId, deviceToken, values, timestamp);
            }
        }
        /**
         * Cleanup on node close
         */
        node.on('close', async (done) => {
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
            }
            catch (error) {
                node.error(`Cleanup error: ${error.message}`);
                done();
            }
        });
    }
    // Register the node
    RED.nodes.registerType("viis-thingsboard-telemetry", ViisTbTelemetryNode);
};

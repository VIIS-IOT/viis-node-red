"use strict";
/**
 * viis-flow-accumulation Node
 * Calculates and publishes hourly flow accumulation data
 */
Object.defineProperty(exports, "__esModule", { value: true });
const cron_1 = require("cron");
const FlowAccumulationService_1 = require("../../services/MarineIoT/FlowAccumulationService");
const global_context_helper_1 = require("../../ultils/global-context-helper");
const demeter_mqtt_topics_1 = require("../../core/demeter-mqtt-topics");
const dataSource_1 = require("../../orm/dataSource");
module.exports = function (RED) {
    /**
     * Main viis-flow-accumulation node implementation
     */
    function ViisFlowAccumulationNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext = this.context();
        // State variables
        let cronJob = null;
        let accumulationService = null;
        let dataSource = null;
        let thingsboardMqttClient = null;
        let deviceId = '';
        // Statistics
        const stats = {
            lastCalculation: null,
            lastSuccess: false,
            totalCalculations: 0,
            failedCalculations: 0,
            nextScheduled: null,
        };
        // Wrap async initialization
        (async () => {
            try {
                // Initialize GlobalContextHelper
                const globalHelper = new global_context_helper_1.GlobalContextHelper(nodeContext);
                deviceId = globalHelper.getEnvVar('DEVICE_ID', 'unknown-device');
                // Initialize DataSource
                dataSource = await (0, dataSource_1.createDataSource)(nodeContext);
                if (!dataSource.isInitialized) {
                    await dataSource.initialize();
                    node.log('[FlowAccumulation] Database connection initialized');
                }
                // Initialize service
                accumulationService = new FlowAccumulationService_1.FlowAccumulationService(dataSource);
                node.log('[FlowAccumulation] Accumulation service initialized');
                // MQTT direct publishing disabled - use viis-thingsboard-telemetry node for retry support
                // if (config.publishToMqtt) {
                //     const thingsboardConfig = createThingsboardMqttConfig(globalHelper);
                //     thingsboardMqttClient = await ClientRegistry.getThingsboardMqttClient(thingsboardConfig, node);
                //
                //     if (!thingsboardMqttClient) {
                //         node.warn('[FlowAccumulation] MQTT client not available, publishing disabled');
                //     } else {
                //         node.log('[FlowAccumulation] MQTT client connected');
                //     }
                // }
                // Setup scheduled calculation
                if (config.enableAutoCalculation && config.cronSchedule) {
                    setupScheduledCalculation(config.cronSchedule);
                    node.log(`[FlowAccumulation] Scheduled calculation enabled: ${config.cronSchedule}`);
                }
                else {
                    node.log('[FlowAccumulation] Manual mode (no scheduled calculation)');
                }
                // Setup input message handler
                setupInputHandler();
                // Setup cleanup
                setupCleanupHandler();
                node.status({ fill: "green", shape: "dot", text: "Ready" });
            }
            catch (error) {
                node.error(`[FlowAccumulation] Initialization failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            node.error(`[FlowAccumulation] Async initialization error: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Startup error" });
        });
        /**
         * Setup scheduled calculation using cron
         */
        function setupScheduledCalculation(schedule) {
            try {
                cronJob = new cron_1.CronJob(schedule, async () => {
                    await executeCalculation();
                }, null, true, 'UTC');
                // Calculate next run time
                const nextRun = cronJob.nextDate();
                if (nextRun) {
                    stats.nextScheduled = nextRun.toMillis();
                    node.log(`[FlowAccumulation] Next calculation: ${nextRun.toISO()}`);
                }
            }
            catch (error) {
                node.error(`[FlowAccumulation] Cron setup failed: ${error.message}`);
                throw error;
            }
        }
        /**
         * Execute accumulation calculation
         */
        async function executeCalculation() {
            if (!accumulationService) {
                node.error('[FlowAccumulation] Service not initialized');
                return;
            }
            try {
                node.status({ fill: "yellow", shape: "ring", text: "Calculating..." });
                stats.lastCalculation = Date.now();
                // Calculate previous hour
                const results = await accumulationService.calculatePreviousHour(deviceId);
                if (results.length === 0) {
                    node.warn('[FlowAccumulation] No data available for previous hour');
                    node.status({ fill: "yellow", shape: "dot", text: "No data" });
                    stats.lastSuccess = false;
                    stats.failedCalculations++;
                    return;
                }
                // Format payload for output (compatible with viis-thingsboard-telemetry)
                const formattedPayload = formatAccumulationPayload(results);
                // Direct MQTT publishing disabled - data will be sent via viis-thingsboard-telemetry node
                // if (config.publishToMqtt && thingsboardMqttClient) {
                //     const topic = config.mqttTopic || buildDeviceTelemetryTopic(deviceId);
                //     thingsboardMqttClient.publish(topic, JSON.stringify(formattedPayload));
                //     node.log(`[FlowAccumulation] Published to ${topic}: ${results.length} sensors`);
                // }
                // Send formatted output (can be piped to viis-thingsboard-telemetry for retry support)
                node.send({ payload: formattedPayload });
                // Update stats
                stats.lastSuccess = true;
                stats.totalCalculations++;
                // Update next scheduled time
                if (cronJob) {
                    const nextRun = cronJob.nextDate();
                    if (nextRun) {
                        stats.nextScheduled = nextRun.toMillis();
                    }
                }
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `Calculated ${results.length} sensors`
                });
                node.log(`[FlowAccumulation] Calculation completed: ${results.length} sensors`);
            }
            catch (error) {
                stats.lastSuccess = false;
                stats.failedCalculations++;
                node.error(`[FlowAccumulation] Calculation failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Calculation failed" });
            }
        }
        /**
         * Setup input message handler
         */
        function setupInputHandler() {
            node.on('input', async (msg) => {
                try {
                    if (!accumulationService) {
                        node.error('[FlowAccumulation] Service not initialized');
                        return;
                    }
                    const topic = msg.topic || '';
                    switch (topic) {
                        case 'calculate':
                            await handleManualCalculation(msg.payload);
                            break;
                        case 'backfill':
                            await handleBackfill(msg.payload);
                            break;
                        case 'status':
                            node.send({ payload: stats });
                            break;
                        default:
                            node.warn(`[FlowAccumulation] Unknown topic: ${topic}`);
                            break;
                    }
                }
                catch (error) {
                    node.error(`[FlowAccumulation] Input handler error: ${error.message}`);
                }
            });
        }
        /**
         * Handle manual calculation request
         */
        async function handleManualCalculation(payload) {
            if (!accumulationService)
                return;
            try {
                node.status({ fill: "yellow", shape: "ring", text: "Manual calculation..." });
                let hourStart;
                if (payload.hourStart) {
                    hourStart = typeof payload.hourStart === 'string'
                        ? new Date(payload.hourStart)
                        : payload.hourStart;
                }
                else {
                    // Default to previous hour
                    const now = new Date();
                    hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1, 0, 0, 0);
                }
                const results = await accumulationService.calculateHourlyAccumulation(deviceId, hourStart);
                // Format payload for output
                const formattedPayload = results.length > 0
                    ? formatAccumulationPayload(results)
                    : null;
                // Direct MQTT publishing disabled - data will be sent via viis-thingsboard-telemetry node
                // if (config.publishToMqtt && thingsboardMqttClient && formattedPayload) {
                //     const topic = config.mqttTopic || buildDeviceTelemetryTopic(deviceId);
                //     thingsboardMqttClient.publish(topic, JSON.stringify(formattedPayload));
                // }
                // Send formatted output
                if (formattedPayload) {
                    node.send({ payload: formattedPayload });
                }
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `Manual: ${results.length} sensors`
                });
                node.log(`[FlowAccumulation] Manual calculation completed: ${results.length} sensors`);
            }
            catch (error) {
                node.error(`[FlowAccumulation] Manual calculation failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Manual calculation failed" });
            }
        }
        /**
         * Handle backfill request
         */
        async function handleBackfill(payload) {
            if (!accumulationService)
                return;
            try {
                node.status({ fill: "yellow", shape: "ring", text: "Backfilling..." });
                const startDate = typeof payload.startDate === 'string'
                    ? new Date(payload.startDate)
                    : payload.startDate;
                const endDate = typeof payload.endDate === 'string'
                    ? new Date(payload.endDate)
                    : payload.endDate;
                const processedHours = await accumulationService.backfillAccumulation(deviceId, startDate, endDate);
                node.send({
                    payload: {
                        backfilled: processedHours,
                        startDate: startDate.toISOString(),
                        endDate: endDate.toISOString(),
                    }
                });
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `Backfilled ${processedHours} hours`
                });
                node.log(`[FlowAccumulation] Backfill completed: ${processedHours} hours`);
            }
            catch (error) {
                node.error(`[FlowAccumulation] Backfill failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Backfill failed" });
            }
        }
        /**
         * Format accumulation results for MQTT publishing (ThingsBoard format)
         * Creates flat structure with ts field and sensor-prefixed keys
         *
         * Example output (default format):
         * {
         *   ts: 1737453600000,
         *   hour_start: "2025-01-20T14:00:00Z",
         *   hour_end: "2025-01-20T15:00:00Z",
         *   fs01_avg_flow_m3h: 25.5,
         *   fs01_accumulated_m3: 25.5,
         *   fs01_accumulated_tons: 24.225,
         *   fs01_oil_profile: "BO_Generator",
         *   fs01_density: 950,
         *   fs01_samples: 60,
         *   fs02_avg_flow_m3h: 30.2,
         *   ...
         * }
         *
         * Example output (TFS format - useTfsKeyFormat=true):
         * {
         *   ts: 1737453600000,
         *   hour_start: "2025-01-20T14:00:00Z",
         *   hour_end: "2025-01-20T15:00:00Z",
         *   tfs01_hourly_m3: 25.5,
         *   tfs01_hourly_tons: 24.225,
         *   tfs01_avg_flow_m3h: 25.5,
         *   tfs01_oil_profile: "BO_Generator",
         *   tfs01_density: 950,
         *   ...
         * }
         */
        function formatAccumulationPayload(results) {
            if (results.length === 0) {
                throw new Error('No results to format');
            }
            const firstResult = results[0];
            // Start with base fields
            // Use hour_start timestamp for ThingsBoard timeseries (not current time)
            const payload = {
                ts: firstResult.hour_start.getTime(),
                hour_start: firstResult.hour_start.toISOString(),
                hour_end: firstResult.hour_end.toISOString(),
            };
            // Determine key format based on config
            const useTfsFormat = config.useTfsKeyFormat === true;
            // Add sensor data with flat structure
            results.forEach((result) => {
                if (useTfsFormat) {
                    // TFS format: tfs01_hourly_m3, tfs01_hourly_tons
                    const tfsKey = result.sensor_key.replace('fs', 'tfs'); // fs01 -> tfs01
                    payload[`${tfsKey}_hourly_m3`] = result.accumulated_m3;
                    payload[`${tfsKey}_hourly_tons`] = result.accumulated_tons;
                    payload[`${tfsKey}_avg_flow_m3h`] = result.avg_flow_m3h;
                    payload[`${tfsKey}_oil_profile`] = result.oil_profile_id || 'unknown';
                    payload[`${tfsKey}_density`] = result.density_used;
                    payload[`${tfsKey}_samples`] = result.sample_count;
                }
                else {
                    // Default format: fs01_accumulated_m3, fs01_accumulated_tons
                    const prefix = result.sensor_key; // fs01, fs02, etc.
                    payload[`${prefix}_avg_flow_m3h`] = result.avg_flow_m3h;
                    payload[`${prefix}_accumulated_m3`] = result.accumulated_m3;
                    payload[`${prefix}_accumulated_tons`] = result.accumulated_tons;
                    payload[`${prefix}_oil_profile`] = result.oil_profile_id || 'unknown';
                    payload[`${prefix}_density`] = result.density_used;
                    payload[`${prefix}_samples`] = result.sample_count;
                }
            });
            return payload;
        }
        /**
         * Create ThingsBoard MQTT configuration
         */
        function createThingsboardMqttConfig(globalHelper, deviceId) {
            const broker = (0, demeter_mqtt_topics_1.resolveThingsboardMqttBroker)(globalHelper);
            const deviceToken = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
            const password = globalHelper.getEnvVar('THINGSBOARD_PASSWORD', '');
            if (!deviceToken || deviceToken.trim() === '') {
                throw new Error('DEVICE_ACCESS_TOKEN is required for ThingsBoard MQTT connection');
            }
            if (!broker) {
                throw new Error('THINGSBOARD_HOST / THINGSBOARD_MQTT_BROKER is required. Load common.json via env-loader.');
            }
            return {
                broker,
                deviceId,
                clientId: `node-red-flow-accumulation-${Math.random().toString(16).substring(2, 10)}`,
                username: deviceToken,
                password: password,
                qos: 1,
                connectTimeout: 30000,
                keepalive: 60,
            };
        }
        /**
         * Setup cleanup handler
         */
        function setupCleanupHandler() {
            node.on('close', async (done) => {
                try {
                    // Stop cron job
                    if (cronJob) {
                        cronJob.stop();
                        node.log('[FlowAccumulation] Cron job stopped');
                    }
                    // NOTE: DataSource cleanup is handled by viis-marine-telemetry node
                    // to avoid race condition when multiple nodes share the same singleton DataSource
                    // Do NOT destroy DataSource here
                    // Disconnect MQTT
                    if (thingsboardMqttClient) {
                        thingsboardMqttClient.disconnect();
                        node.log('[FlowAccumulation] MQTT disconnected');
                    }
                    node.log('[FlowAccumulation] Node closed and cleaned up');
                    done();
                }
                catch (error) {
                    node.error(`[FlowAccumulation] Cleanup error: ${error.message}`);
                    done();
                }
            });
        }
    }
    RED.nodes.registerType("viis-flow-accumulation", ViisFlowAccumulationNode);
};

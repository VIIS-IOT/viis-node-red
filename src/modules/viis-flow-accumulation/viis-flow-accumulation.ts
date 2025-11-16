/**
 * viis-flow-accumulation Node
 * Calculates and publishes hourly flow accumulation data
 */

import { NodeAPI, Node, NodeContext } from "node-red";
import { CronJob } from "cron";
import { DataSource } from "typeorm";
import { FlowAccumulationService } from "../../services/MarineIoT/FlowAccumulationService";
import { TabiotFlowAccumulation } from "../../orm/entities/flow-accumulation/TabiotFlowAccumulation";
import { MqttClientCore } from "../../core/mqtt-client";
import ClientRegistry from "../../core/client-registry";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { createDataSource } from "../../orm/dataSource";
import {
    ViisFlowAccumulationNodeDef,
    ManualCalculationRequest,
    BackfillRequest,
    AccumulationPayload,
    AccumulationStatus,
} from "./viis-flow-accumulation-config";

module.exports = function (RED: NodeAPI) {
    /**
     * Main viis-flow-accumulation node implementation
     */
    function ViisFlowAccumulationNode(this: Node, config: ViisFlowAccumulationNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext: NodeContext = this.context();

        // State variables
        let cronJob: CronJob | null = null;
        let accumulationService: FlowAccumulationService | null = null;
        let dataSource: DataSource | null = null;
        let thingsboardMqttClient: MqttClientCore | null = null;
        let deviceId: string = '';
        
        // Statistics
        const stats: AccumulationStatus = {
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
                const globalHelper = new GlobalContextHelper(nodeContext);
                deviceId = globalHelper.getEnvVar('DEVICE_ID', 'unknown-device');

                // Initialize DataSource
                dataSource = await createDataSource(nodeContext);
                if (!dataSource.isInitialized) {
                    await dataSource.initialize();
                    node.log('[FlowAccumulation] Database connection initialized');
                }

                // Initialize service
                accumulationService = new FlowAccumulationService(dataSource);
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
                } else {
                    node.log('[FlowAccumulation] Manual mode (no scheduled calculation)');
                }

                // Setup input message handler
                setupInputHandler();

                // Setup cleanup
                setupCleanupHandler();

                node.status({ fill: "green", shape: "dot", text: "Ready" });

            } catch (error) {
                node.error(`[FlowAccumulation] Initialization failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            node.error(`[FlowAccumulation] Async initialization error: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Startup error" });
        });

        /**
         * Setup scheduled calculation using cron
         */
        function setupScheduledCalculation(schedule: string): void {
            try {
                cronJob = new CronJob(
                    schedule,
                    async () => {
                        await executeCalculation();
                    },
                    null,
                    true,
                    'UTC'
                );

                // Calculate next run time
                const nextRun = cronJob.nextDate();
                if (nextRun) {
                    stats.nextScheduled = nextRun.toMillis();
                    node.log(`[FlowAccumulation] Next calculation: ${nextRun.toISO()}`);
                }

            } catch (error) {
                node.error(`[FlowAccumulation] Cron setup failed: ${(error as Error).message}`);
                throw error;
            }
        }

        /**
         * Execute accumulation calculation
         */
        async function executeCalculation(): Promise<void> {
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
                //     const topic = config.mqttTopic || 'v1/devices/me/telemetry';
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

            } catch (error) {
                stats.lastSuccess = false;
                stats.failedCalculations++;
                node.error(`[FlowAccumulation] Calculation failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Calculation failed" });
            }
        }

        /**
         * Setup input message handler
         */
        function setupInputHandler(): void {
            node.on('input', async (msg: any) => {
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

                } catch (error) {
                    node.error(`[FlowAccumulation] Input handler error: ${(error as Error).message}`);
                }
            });
        }

        /**
         * Handle manual calculation request
         */
        async function handleManualCalculation(payload: ManualCalculationRequest): Promise<void> {
            if (!accumulationService) return;

            try {
                node.status({ fill: "yellow", shape: "ring", text: "Manual calculation..." });

                let hourStart: Date;
                if (payload.hourStart) {
                    hourStart = typeof payload.hourStart === 'string' 
                        ? new Date(payload.hourStart) 
                        : payload.hourStart;
                } else {
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
                //     const topic = config.mqttTopic || 'v1/devices/me/telemetry';
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

            } catch (error) {
                node.error(`[FlowAccumulation] Manual calculation failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Manual calculation failed" });
            }
        }

        /**
         * Handle backfill request
         */
        async function handleBackfill(payload: BackfillRequest): Promise<void> {
            if (!accumulationService) return;

            try {
                node.status({ fill: "yellow", shape: "ring", text: "Backfilling..." });

                const startDate = typeof payload.startDate === 'string' 
                    ? new Date(payload.startDate) 
                    : payload.startDate;
                    
                const endDate = typeof payload.endDate === 'string' 
                    ? new Date(payload.endDate) 
                    : payload.endDate;

                const processedHours = await accumulationService.backfillAccumulation(
                    deviceId,
                    startDate,
                    endDate
                );

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

            } catch (error) {
                node.error(`[FlowAccumulation] Backfill failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Backfill failed" });
            }
        }

        /**
         * Format accumulation results for MQTT publishing (ThingsBoard format)
         * Creates flat structure with ts field and sensor-prefixed keys
         * 
         * Example output:
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
         */
        function formatAccumulationPayload(results: TabiotFlowAccumulation[]): AccumulationPayload {
            if (results.length === 0) {
                throw new Error('No results to format');
            }

            const firstResult = results[0];
            
            // Start with base fields
            // Use hour_start timestamp for ThingsBoard timeseries (not current time)
            const payload: AccumulationPayload = {
                ts: firstResult.hour_start.getTime(),
                hour_start: firstResult.hour_start.toISOString(),
                hour_end: firstResult.hour_end.toISOString(),
            };

            // Add sensor data with flat structure
            results.forEach((result) => {
                const prefix = result.sensor_key; // fs01, fs02, etc.
                
                payload[`${prefix}_avg_flow_m3h`] = result.avg_flow_m3h;
                payload[`${prefix}_accumulated_m3`] = result.accumulated_m3;
                payload[`${prefix}_accumulated_tons`] = result.accumulated_tons;
                payload[`${prefix}_oil_profile`] = result.oil_profile_id || 'unknown';
                payload[`${prefix}_density`] = result.density_used;
                payload[`${prefix}_samples`] = result.sample_count;
            });

            return payload;
        }

        /**
         * Create ThingsBoard MQTT configuration
         */
        function createThingsboardMqttConfig(globalHelper: GlobalContextHelper) {
            const host = globalHelper.getEnvVar('THINGSBOARD_HOST', 'mqtt.viis.tech');
            const port = globalHelper.getEnvVar('THINGSBOARD_PORT', '1883');
            const deviceToken = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
            const password = globalHelper.getEnvVar('THINGSBOARD_PASSWORD', '');

            if (!deviceToken || deviceToken.trim() === '') {
                throw new Error('DEVICE_ACCESS_TOKEN is required for ThingsBoard MQTT connection');
            }

            return {
                broker: `mqtt://${host}:${port}`,
                clientId: `node-red-flow-accumulation-${Math.random().toString(16).substring(2, 10)}`,
                username: deviceToken,
                password: password,
                qos: 1 as 0 | 1 | 2,
                connectTimeout: 30000,
                keepalive: 60,
            };
        }

        /**
         * Setup cleanup handler
         */
        function setupCleanupHandler(): void {
            node.on('close', async (done: () => void) => {
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
                } catch (error) {
                    node.error(`[FlowAccumulation] Cleanup error: ${(error as Error).message}`);
                    done();
                }
            });
        }
    }

    RED.nodes.registerType("viis-flow-accumulation", ViisFlowAccumulationNode);
};

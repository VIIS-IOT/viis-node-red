"use strict";
/**
 * viis-trip-realtime-telemetry Node
 * Real-time trip accumulation monitoring with configurable update interval
 * Sends running totals for active trips to ThingsBoard dashboard
 */
Object.defineProperty(exports, "__esModule", { value: true });
const TripManagementService_1 = require("../../services/MarineIoT/TripManagementService");
const TripAccumulationService_1 = require("../../services/MarineIoT/TripAccumulationService");
const global_context_helper_1 = require("../../ultils/global-context-helper");
const dataSource_1 = require("../../orm/dataSource");
module.exports = function (RED) {
    /**
     * Main viis-trip-realtime-telemetry node implementation
     */
    function ViisTripRealtimeTelemetryNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext = this.context();
        // State variables
        let updateTimer = null;
        let tripManagementService = null;
        let tripAccumulationService = null;
        let dataSource = null;
        let deviceId = '';
        // Statistics
        const stats = {
            lastUpdate: null,
            tripActive: false,
            currentTripId: null,
            totalUpdates: 0,
            updateInterval: config.updateInterval || 300,
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
                    node.log('[TripRealtime] Database connection initialized');
                }
                // Initialize services
                tripManagementService = new TripManagementService_1.TripManagementService(dataSource);
                tripAccumulationService = new TripAccumulationService_1.TripAccumulationService(dataSource);
                node.log('[TripRealtime] Services initialized');
                // Start periodic updates
                startPeriodicUpdates();
                // Setup cleanup
                setupCleanupHandler();
                node.status({ fill: "green", shape: "dot", text: "Ready" });
            }
            catch (error) {
                node.error(`[TripRealtime] Initialization failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
            }
        })().catch((error) => {
            node.error(`[TripRealtime] Async initialization error: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Startup error" });
        });
        /**
         * Start periodic update timer
         */
        function startPeriodicUpdates() {
            const intervalMs = (config.updateInterval || 300) * 1000;
            updateTimer = setInterval(async () => {
                await publishTripTelemetry();
            }, intervalMs);
            node.log(`[TripRealtime] Update interval: ${config.updateInterval}s`);
        }
        /**
         * Publish trip telemetry data
         */
        async function publishTripTelemetry() {
            if (!tripManagementService || !tripAccumulationService) {
                return;
            }
            try {
                // Get active trip
                const activeTrip = await tripManagementService.getActiveTrip(deviceId);
                if (!activeTrip) {
                    // No active trip
                    if (stats.tripActive) {
                        node.log('[TripRealtime] No active trip - waiting...');
                        node.status({ fill: "yellow", shape: "ring", text: "No active trip" });
                    }
                    stats.tripActive = false;
                    stats.currentTripId = null;
                    return;
                }
                // Active trip exists
                stats.tripActive = true;
                stats.currentTripId = activeTrip.id;
                // Get trip accumulation data
                const tripAccumulations = await tripAccumulationService.getTripAccumulation(activeTrip.id);
                if (tripAccumulations.length === 0) {
                    node.warn('[TripRealtime] No accumulation data for active trip');
                    return;
                }
                // Format payload
                const payload = await formatTripTelemetryPayload(activeTrip, tripAccumulations);
                // Add machine consumption if enabled
                if (config.includeConsumption) {
                    await addMachineConsumption(payload, activeTrip.id);
                }
                // Send output
                node.send({ payload });
                // Update stats
                stats.lastUpdate = Date.now();
                stats.totalUpdates++;
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `Trip: ${activeTrip.trip_name || activeTrip.id.substring(0, 8)}`
                });
            }
            catch (error) {
                node.error(`[TripRealtime] Telemetry publish failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Publish failed" });
            }
        }
        /**
         * Format trip telemetry payload (ThingsBoard format)
         */
        async function formatTripTelemetryPayload(activeTrip, tripAccumulations) {
            const tripStartTime = new Date(activeTrip.start_time).getTime();
            const now = Date.now();
            const durationHours = (now - tripStartTime) / (1000 * 60 * 60);
            const payload = {
                ts: now,
                trip_id: activeTrip.id,
                trip_start: tripStartTime,
                trip_status: activeTrip.status,
                trip_duration_hours: Number(durationHours.toFixed(3)),
            };
            // Add sensor running totals (flat structure)
            tripAccumulations.forEach((tripAcc) => {
                const prefix = tripAcc.sensor_key; // fs01, fs02, etc.
                payload[`${prefix}_trip_total_m3`] = Number(tripAcc.total_volume_m3);
                payload[`${prefix}_trip_total_tons`] = Number(tripAcc.total_volume_tons);
                payload[`${prefix}_trip_samples`] = tripAcc.sample_count;
                payload[`${prefix}_last_update`] = tripAcc.last_update_time ? new Date(tripAcc.last_update_time).getTime() : now;
                // Add density and oil profile info
                if (tripAcc.current_density) {
                    payload[`${prefix}_density`] = Number(tripAcc.current_density);
                }
                if (tripAcc.oil_profile_id) {
                    payload[`${prefix}_oil_profile`] = tripAcc.oil_profile_id;
                }
            });
            return payload;
        }
        /**
         * Add machine consumption calculations (NEW 4-machine configuration)
         * Machine 1 (BOILER): fs01 (direct consumption, no return)
         * Machine 2 (MAIN_ENGINE): fs02 (in) - fs03 (return)
         * Machine 3 (GENERATOR_HFO): fs03 (in) - fs04 (return)
         * Machine 4 (GENERATOR_DO): fs05 (in) - fs06 (return)
         */
        async function addMachineConsumption(payload, tripId) {
            if (!tripAccumulationService)
                return;
            try {
                const machines = [];
                // Machine 1: BOILER (direct consumption, no return flow)
                const tripAccumulations = await tripAccumulationService.getTripAccumulation(tripId);
                const boilerAcc = tripAccumulations.find(a => a.sensor_key === 'fs01');
                if (boilerAcc) {
                    machines.push({
                        machine_name: 'BOILER',
                        flow_in_sensor: 'fs01',
                        flow_return_sensor: undefined,
                        consumption_m3: Number(boilerAcc.total_volume_m3), // Direct consumption
                        consumption_tons: Number(boilerAcc.total_volume_tons),
                    });
                }
                // Machine 2: MAIN_ENGINE (fs02 in - fs03 return)
                const machine2 = await tripAccumulationService.getMachineConsumption(tripId, 'fs02', 'fs03');
                if (machine2) {
                    machines.push({
                        machine_name: 'MAIN_ENGINE',
                        flow_in_sensor: 'fs02',
                        flow_return_sensor: 'fs03',
                        consumption_m3: machine2.m3,
                        consumption_tons: machine2.tons,
                    });
                }
                // Machine 3: GENERATOR_HFO (fs03 in - fs04 return)
                const machine3 = await tripAccumulationService.getMachineConsumption(tripId, 'fs03', 'fs04');
                if (machine3) {
                    machines.push({
                        machine_name: 'GENERATOR_HFO',
                        flow_in_sensor: 'fs03',
                        flow_return_sensor: 'fs04',
                        consumption_m3: machine3.m3,
                        consumption_tons: machine3.tons,
                    });
                }
                // Machine 4: GENERATOR_DO (fs05 in - fs06 return)
                const machine4 = await tripAccumulationService.getMachineConsumption(tripId, 'fs05', 'fs06');
                if (machine4) {
                    machines.push({
                        machine_name: 'GENERATOR_DO',
                        flow_in_sensor: 'fs05',
                        flow_return_sensor: 'fs06',
                        consumption_m3: machine4.m3,
                        consumption_tons: machine4.tons,
                    });
                }
                // Add to payload (flat structure for ThingsBoard)
                machines.forEach((machine, index) => {
                    const machineNum = index + 1;
                    payload[`machine${machineNum}_consumption_m3`] = machine.consumption_m3;
                    payload[`machine${machineNum}_consumption_tons`] = machine.consumption_tons;
                    payload[`machine${machineNum}_flow_in`] = machine.flow_in_sensor;
                    payload[`machine${machineNum}_flow_return`] = machine.flow_return_sensor;
                });
                // Total consumption
                const totalConsumption = await tripAccumulationService.getTotalConsumption(tripId);
                payload.total_consumption_m3 = totalConsumption.m3;
                payload.total_consumption_tons = totalConsumption.tons;
            }
            catch (error) {
                node.warn(`[TripRealtime] Failed to calculate machine consumption: ${error.message}`);
            }
        }
        /**
         * Setup cleanup handler
         */
        function setupCleanupHandler() {
            node.on('close', async (done) => {
                try {
                    // Stop timer
                    if (updateTimer) {
                        clearInterval(updateTimer);
                        node.log('[TripRealtime] Update timer stopped');
                    }
                    // NOTE: DataSource cleanup is handled by viis-marine-telemetry node
                    // to avoid race condition when multiple nodes share the same singleton DataSource
                    // Do NOT destroy DataSource here
                    node.log('[TripRealtime] Node closed and cleaned up');
                    done();
                }
                catch (error) {
                    node.error(`[TripRealtime] Cleanup error: ${error.message}`);
                    done();
                }
            });
        }
        /**
         * Setup input message handler (for manual trigger or status)
         */
        node.on('input', async (msg) => {
            try {
                const topic = msg.topic || '';
                if (topic === 'trigger') {
                    // Manual trigger
                    await publishTripTelemetry();
                }
                else if (topic === 'status') {
                    // Send status
                    node.send({ payload: stats });
                }
            }
            catch (error) {
                node.error(`[TripRealtime] Input handler error: ${error.message}`);
            }
        });
    }
    RED.nodes.registerType("viis-trip-realtime-telemetry", ViisTripRealtimeTelemetryNode);
};

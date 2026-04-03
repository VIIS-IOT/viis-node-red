/**
 * @fileoverview Trip Accumulation Background Worker
 * 
 * Runs every 2 seconds to update trip accumulation based on real-time flow rates
 * IMPORTANT: This worker is independent of hourly accumulation (FlowAccumulationService)
 * 
 * Architecture:
 * - Reads latest telemetry from tabiot_device_telemetry_latest
 * - Updates running totals in tabiot_trip_accumulation
 * - Only processes ACTIVE trips
 */

import { Service } from 'typedi';
import { DataSource, Repository } from 'typeorm';
import { Node } from 'node-red';
import { TabiotTrip } from '../../orm/entities/trip/TabiotTrip';
import { TabiotDeviceTelemetryLatest } from '../../orm/entities/device-telemetry/TabiotDeviceTelemetryLatest';
import { TripAccumulationService, AccumulationUpdate } from './TripAccumulationService';
import { FlowCheckpointService, CheckpointUpdate } from './FlowCheckpointService';
import { logger } from '../../modules/viis-rest-api/utils/logger';

@Service()
export class TripAccumulationWorker {
    private tripRepo: Repository<TabiotTrip>;
    private telemetryLatestRepo: Repository<TabiotDeviceTelemetryLatest>;
    private interval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;

    private readonly UPDATE_INTERVAL = 2000; // 2 seconds
    private readonly FLOW_SENSORS = ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];
    private readonly TFS_SENSORS = ['tfs01', 'tfs02', 'tfs03', 'tfs04', 'tfs05', 'tfs06'];

    constructor(
        private dataSource: DataSource,
        private tripAccumulationService: TripAccumulationService,
        private checkpointService: FlowCheckpointService,
        private node: Node
    ) {
        this.tripRepo = dataSource.getRepository(TabiotTrip);
        this.telemetryLatestRepo = dataSource.getRepository(TabiotDeviceTelemetryLatest);
    }

    /**
     * Start the background worker
     */
    start(): void {
        if (this.isRunning) {
            logger.warn(this.node, '[TRIP-WORKER] Already running');
            return;
        }

        this.isRunning = true;
        
        this.interval = setInterval(async () => {
            await this.processActiveTrips();
        }, this.UPDATE_INTERVAL);

        logger.info(this.node, `[TRIP-WORKER] ✅ Started (interval: ${this.UPDATE_INTERVAL}ms)`);
    }

    /**
     * Stop the background worker
     */
    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger.info(this.node, '[TRIP-WORKER] Stopped');
    }

    /**
     * Check if worker is running
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Process all active trips
     * Main worker loop
     */
    private async processActiveTrips(): Promise<void> {
        try {
            // Get all active trips
            const activeTrips = await this.tripRepo.find({
                where: { status: 'ACTIVE' }
            });

            if (activeTrips.length === 0) {
                return; // No active trips
            }

            logger.debug(this.node, `[TRIP-WORKER] Processing ${activeTrips.length} active trips`);

            // Process each trip
            for (const trip of activeTrips) {
                await this.processSingleTrip(trip);
            }

        } catch (error) {
            logger.error(this.node, `[TRIP-WORKER] Error processing trips: ${(error as Error).message}`);
        }
    }

    /**
     * Process a single trip using TFS delta-based accumulation
     */
    private async processSingleTrip(trip: TabiotTrip): Promise<void> {
        try {
            // Get latest telemetry for all TFS sensors
            const latestData = await this.telemetryLatestRepo
                .createQueryBuilder('t')
                .where('t.device_id = :deviceId', { deviceId: trip.device_id })
                .andWhere('t.key_name IN (:...sensors)', { sensors: this.TFS_SENSORS })
                .getMany();

            if (latestData.length === 0) {
                logger.debug(this.node, `[TRIP-WORKER] No TFS telemetry data for trip ${trip.id}`);
                return;
            }

            // Build checkpoint updates and calculate deltas
            const checkpointUpdates: CheckpointUpdate[] = latestData.map(sensor => ({
                deviceId: trip.device_id,
                sensorKey: sensor.key_name,
                tfsValue: sensor.float_value || 0,
                checkpointType: 'trip' as const,
                metadata: {
                    trip_id: trip.id,
                    oil_profile_id: sensor.oil_profile_id,
                    density: sensor.density_snapshot
                }
            }));

            // Batch update checkpoints and get deltas
            const { deltas, resets } = await this.checkpointService.batchUpdateCheckpoints(checkpointUpdates);

            if (resets.size > 0) {
                logger.warn(this.node, `[TRIP-WORKER] TFS reset detected for trip ${trip.id}: ${Array.from(resets).join(', ')}`);
            }

            // Build accumulation updates from deltas
            const accumulationUpdates: AccumulationUpdate[] = [];
            for (const sensor of latestData) {
                const delta = deltas.get(sensor.key_name);
                if (delta !== undefined && delta > 0) {
                    const density = sensor.density_snapshot || 1000;
                    const deltaTons = this.calculateTons(delta, density);

                    accumulationUpdates.push({
                        sensorKey: sensor.key_name,
                        flowRate: {
                            m3h: delta, // Delta volume (not flow rate, but reusing structure)
                            th: deltaTons
                        },
                        density: density,
                        oilProfileId: sensor.oil_profile_id || null
                    });
                }
            }

            if (accumulationUpdates.length > 0) {
                // Use direct delta update method instead of batch update
                await this.tripAccumulationService.batchUpdateAccumulationWithDelta(trip.id, accumulationUpdates);
                logger.debug(this.node, `[TRIP-WORKER] Updated trip ${trip.id} with ${accumulationUpdates.length} deltas`);
            }

        } catch (error) {
            logger.error(this.node, `[TRIP-WORKER] Error processing trip ${trip.id}: ${(error as Error).message}`);
        }
    }

    /**
     * Calculate tons from m³ and density
     * @param m3 - Volume in cubic meters
     * @param density - Density in kg/m³
     * @returns Volume in tons
     */
    private calculateTons(m3: number, density: number): number {
        return Number(((m3 * density) / 1000).toFixed(4));
    }

    /**
     * Manual trigger for testing
     */
    async triggerUpdate(): Promise<void> {
        logger.info(this.node, '[TRIP-WORKER] Manual trigger');
        await this.processActiveTrips();
    }

    /**
     * Get worker statistics
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            updateInterval: this.UPDATE_INTERVAL,
            sensors: this.FLOW_SENSORS
        };
    }
}

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
import { logger } from '../../modules/viis-rest-api/utils/logger';

@Service()
export class TripAccumulationWorker {
    private tripRepo: Repository<TabiotTrip>;
    private telemetryLatestRepo: Repository<TabiotDeviceTelemetryLatest>;
    private interval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;

    private readonly UPDATE_INTERVAL = 2000; // 2 seconds
    private readonly FLOW_SENSORS = ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];

    constructor(
        private dataSource: DataSource,
        private tripAccumulationService: TripAccumulationService,
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
     * Process a single trip
     */
    private async processSingleTrip(trip: TabiotTrip): Promise<void> {
        try {
            // Get latest telemetry for all flow sensors
            const latestData = await this.telemetryLatestRepo
                .createQueryBuilder('t')
                .where('t.device_id = :deviceId', { deviceId: trip.device_id })
                .andWhere('t.key_name IN (:...sensors)', { sensors: this.FLOW_SENSORS })
                .getMany();

            if (latestData.length === 0) {
                logger.debug(this.node, `[TRIP-WORKER] No telemetry data for trip ${trip.id}`);
                return;
            }

            // Build batch update
            const updates: AccumulationUpdate[] = latestData.map(sensor => {
                const flowRateM3h = sensor.float_value || 0;
                const density = sensor.density_snapshot || 1000;
                const flowRateTons = this.calculateTons(flowRateM3h, density);

                return {
                    sensorKey: sensor.key_name,
                    flowRate: {
                        m3h: flowRateM3h,
                        th: flowRateTons
                    },
                    density: density,
                    oilProfileId: sensor.oil_profile_id || null
                };
            });

            // Batch update accumulation
            await this.tripAccumulationService.batchUpdateAccumulation(trip.id, updates);

            logger.debug(this.node, `[TRIP-WORKER] Updated trip ${trip.id} (${updates.length} sensors)`);

        } catch (error) {
            logger.error(this.node, `[TRIP-WORKER] Error processing trip ${trip.id}: ${(error as Error).message}`);
        }
    }

    /**
     * Calculate tons from m³/h and density
     */
    private calculateTons(m3h: number, density: number): number {
        return Number(((m3h * density) / 1000).toFixed(2));
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

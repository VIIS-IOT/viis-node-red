/**
 * @fileoverview Trip Accumulation Service
 *
 * Handles running total accumulation for active trips
 * Updates total volume based on real-time flow rates
 *
 * Formula: total += (flow_rate × time_interval)
 * Interval: 2 seconds (configurable)
 */

import { Service } from 'typedi';
import { DataSource, Repository } from 'typeorm';
import { TabiotTripAccumulation } from '../../orm/entities/trip/TabiotTripAccumulation';

export interface FlowRateData {
    m3h: number;  // Flow rate in m³/h
    th: number;   // Flow rate in T/h
}

export interface AccumulationUpdate {
    sensorKey: string;
    flowRate: FlowRateData;
    density: number;
    oilProfileId: string | null;
}

@Service()
export class TripAccumulationService {
    private accumulationRepo: Repository<TabiotTripAccumulation>;

    // Configuration
    private readonly UPDATE_INTERVAL_MS = 2000; // 2 seconds

    constructor(private dataSource: DataSource) {
        this.accumulationRepo = dataSource.getRepository(TabiotTripAccumulation);
    }

    /**
     * Update accumulation for a single sensor
     * Called every 2 seconds with current flow rate
     */
    async updateAccumulation(
        tripId: string,
        update: AccumulationUpdate
    ): Promise<void> {
        const { sensorKey, flowRate, density, oilProfileId } = update;

        // Calculate increment for this interval
        // Formula: volume = flow_rate × time
        const intervalHours = this.UPDATE_INTERVAL_MS / (1000 * 60 * 60);
        const incrementM3 = flowRate.m3h * intervalHours;
        const incrementTons = flowRate.th * intervalHours;

        // Update running total using SQL increment
        await this.accumulationRepo
            .createQueryBuilder()
            .update(TabiotTripAccumulation)
            .set({
                total_volume_m3: () => `total_volume_m3 + ${incrementM3}`,
                total_volume_tons: () => `total_volume_tons + ${incrementTons}`,
                current_density: density,
                oil_profile_id: oilProfileId,
                last_update_time: Date.now(),
                sample_count: () => 'sample_count + 1',
            })
            .where('trip_id = :tripId', { tripId })
            .andWhere('sensor_key = :sensorKey', { sensorKey })
            .execute();
    }

    /**
     * Batch update accumulation for multiple sensors
     * More efficient than individual updates
     */
    async batchUpdateAccumulation(
        tripId: string,
        updates: AccumulationUpdate[]
    ): Promise<void> {
        const intervalHours = this.UPDATE_INTERVAL_MS / (1000 * 60 * 60);
        const timestamp = Date.now();

        // Build batch update using transaction
        await this.dataSource.transaction(async (manager) => {
            for (const update of updates) {
                const incrementM3 = update.flowRate.m3h * intervalHours;
                const incrementTons = update.flowRate.th * intervalHours;

                await manager
                    .createQueryBuilder()
                    .update(TabiotTripAccumulation)
                    .set({
                        total_volume_m3: () => `total_volume_m3 + ${incrementM3}`,
                        total_volume_tons: () => `total_volume_tons + ${incrementTons}`,
                        current_density: update.density,
                        oil_profile_id: update.oilProfileId,
                        last_update_time: timestamp,
                        sample_count: () => 'sample_count + 1',
                    })
                    .where('trip_id = :tripId', { tripId })
                    .andWhere('sensor_key = :sensorKey', { sensorKey: update.sensorKey })
                    .execute();
            }
        });
    }

    /**
     * Batch update accumulation using direct delta values (TFS-based)
     * Used when accumulation comes from TFS delta instead of flow rate × time
     */
    async batchUpdateAccumulationWithDelta(
        tripId: string,
        updates: AccumulationUpdate[]
    ): Promise<void> {
        const timestamp = Date.now();

        // Build batch update using transaction
        await this.dataSource.transaction(async (manager) => {
            for (const update of updates) {
                // flowRate.m3h and flowRate.th now contain delta values directly
                const deltaM3 = update.flowRate.m3h;
                const deltaTons = update.flowRate.th;

                await manager
                    .createQueryBuilder()
                    .update(TabiotTripAccumulation)
                    .set({
                        total_volume_m3: () => `total_volume_m3 + ${deltaM3}`,
                        total_volume_tons: () => `total_volume_tons + ${deltaTons}`,
                        current_density: update.density,
                        oil_profile_id: update.oilProfileId,
                        last_update_time: timestamp,
                        sample_count: () => 'sample_count + 1',
                    })
                    .where('trip_id = :tripId', { tripId })
                    .andWhere('sensor_key = :sensorKey', { sensorKey: update.sensorKey })
                    .execute();
            }
        });
    }

    /**
     * Get accumulation data for a trip
     */
    async getTripAccumulation(tripId: string): Promise<TabiotTripAccumulation[]> {
        return await this.accumulationRepo.find({
            where: { trip_id: tripId },
            order: { sensor_key: 'ASC' }
        });
    }

    /**
     * Get accumulation data for a specific sensor in a trip
     */
    async getSensorAccumulation(
        tripId: string,
        sensorKey: string
    ): Promise<TabiotTripAccumulation | null> {
        return await this.accumulationRepo.findOne({
            where: { trip_id: tripId, sensor_key: sensorKey }
        });
    }

    /**
     * Reset accumulation for a trip (use with caution)
     */
    async resetTripAccumulation(tripId: string): Promise<void> {
        await this.accumulationRepo
            .createQueryBuilder()
            .update(TabiotTripAccumulation)
            .set({
                total_volume_m3: 0,
                total_volume_tons: 0,
                sample_count: 0,
                last_update_time: null,
            })
            .where('trip_id = :tripId', { tripId })
            .execute();
    }

    /**
     * Calculate consumption for a machine in a trip
     * For machines with return flow (MAIN_ENGINE, GENERATOR_HFO, GENERATOR_DO)
     */
    async getMachineConsumption(
        tripId: string,
        flowInSensor: string,
        flowReturnSensor: string
    ): Promise<{ m3: number; tons: number } | null> {
        const flowIn = await this.getSensorAccumulation(tripId, flowInSensor);
        const flowReturn = await this.getSensorAccumulation(tripId, flowReturnSensor);

        if (!flowIn || !flowReturn) {
            return null;
        }

        return {
            m3: Number((Number(flowIn.total_volume_m3) - Number(flowReturn.total_volume_m3)).toFixed(2)),
            tons: Number((Number(flowIn.total_volume_tons) - Number(flowReturn.total_volume_tons)).toFixed(2))
        };
    }

    /**
     * Get direct consumption for BOILER (fs01 only, no return flow)
     */
    async getBoilerConsumption(tripId: string): Promise<{ m3: number; tons: number } | null> {
        const flowIn = await this.getSensorAccumulation(tripId, 'fs01');

        if (!flowIn) {
            return null;
        }

        return {
            m3: Number(flowIn.total_volume_m3),
            tons: Number(flowIn.total_volume_tons)
        };
    }

    /**
     * Get total consumption across all machines (4-machine configuration)
     * NEW LOGIC:
     * - BOILER: fs01 (direct consumption, no return)
     * - MAIN_ENGINE: fs02 (in) - fs03 (return)
     * - GENERATOR_HFO: fs03 (in) - fs04 (return)
     * - GENERATOR_DO: fs05 (in) - fs06 (return)
     */
    async getTotalConsumption(tripId: string): Promise<{ m3: number; tons: number }> {
        const accumulations = await this.getTripAccumulation(tripId);

        // Create map for easy lookup
        const accMap = new Map<string, typeof accumulations[0]>();
        accumulations.forEach(a => accMap.set(a.sensor_key, a));

        // BOILER: fs01 direct consumption (no return)
        const boilerM3 = Number(accMap.get('fs01')?.total_volume_m3 || 0);
        const boilerTons = Number(accMap.get('fs01')?.total_volume_tons || 0);

        // MAIN_ENGINE: fs02 - fs03
        const mainEngineM3 = Number(accMap.get('fs02')?.total_volume_m3 || 0) - Number(accMap.get('fs03')?.total_volume_m3 || 0);
        const mainEngineTons = Number(accMap.get('fs02')?.total_volume_tons || 0) - Number(accMap.get('fs03')?.total_volume_tons || 0);

        // GENERATOR_HFO: fs03 - fs04
        const genHfoM3 = Number(accMap.get('fs03')?.total_volume_m3 || 0) - Number(accMap.get('fs04')?.total_volume_m3 || 0);
        const genHfoTons = Number(accMap.get('fs03')?.total_volume_tons || 0) - Number(accMap.get('fs04')?.total_volume_tons || 0);

        // GENERATOR_DO: fs05 - fs06
        const genDoM3 = Number(accMap.get('fs05')?.total_volume_m3 || 0) - Number(accMap.get('fs06')?.total_volume_m3 || 0);
        const genDoTons = Number(accMap.get('fs05')?.total_volume_tons || 0) - Number(accMap.get('fs06')?.total_volume_tons || 0);

        return {
            m3: Number((boilerM3 + mainEngineM3 + genHfoM3 + genDoM3).toFixed(2)),
            tons: Number((boilerTons + mainEngineTons + genHfoTons + genDoTons).toFixed(2))
        };
    }
}

import { DataSource, Repository, Between } from 'typeorm';
import { TabiotFlowAccumulation } from '../../orm/entities/flow-accumulation/TabiotFlowAccumulation';
import { TabiotDeviceTelemetry } from '../../orm/entities/device-telemetry/TabiotDeviceTelemetry';
import { TabiotOilProfile } from '../../orm/entities/oil-profile/TabiotOilProfile';
import { FlowCheckpointService } from './FlowCheckpointService';

/**
 * Flow Accumulation Service for Marine IoT System
 * Calculates hourly flow accumulation from flow sensor data
 */
export class FlowAccumulationService {
    private accumulationRepo: Repository<TabiotFlowAccumulation>;
    private telemetryRepo: Repository<TabiotDeviceTelemetry>;
    private oilProfileRepo: Repository<TabiotOilProfile>;
    private checkpointService: FlowCheckpointService;

    // Flow sensor keys
    private readonly FLOW_SENSORS = ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];
    private readonly TFS_SENSORS = ['tfs01', 'tfs02', 'tfs03', 'tfs04', 'tfs05', 'tfs06'];

    constructor(private dataSource: DataSource) {
        this.accumulationRepo = dataSource.getRepository(TabiotFlowAccumulation);
        this.telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
        this.oilProfileRepo = dataSource.getRepository(TabiotOilProfile);
        this.checkpointService = new FlowCheckpointService(dataSource);
    }

    /**
     * Get TFS value near a specific time boundary
     * @param deviceId - Device ID
     * @param sensorKey - TFS sensor key (tfs01-tfs06)
     * @param boundaryTime - Target time (e.g., hour boundary)
     * @param toleranceMs - Tolerance in milliseconds (default: 60000 = 1 minute)
     * @returns TFS telemetry nearest to boundary, or null if not found within tolerance
     */
    async getTFSValueNearBoundary(
        deviceId: string,
        sensorKey: string,
        boundaryTime: Date,
        toleranceMs: number = 60000
    ): Promise<{ timestamp: number; value: number; density: number; profileId: string } | null> {
        const boundaryTs = boundaryTime.getTime();
        const startTs = boundaryTs - toleranceMs;
        const endTs = boundaryTs + toleranceMs;

        // Query TFS values near the boundary
        const telemetryData = await this.telemetryRepo
            .createQueryBuilder('t')
            .where('t.device_id = :deviceId', { deviceId })
            .andWhere('t.key_name = :sensorKey', { sensorKey })
            .andWhere('t.timestamp >= :startTs', { startTs })
            .andWhere('t.timestamp <= :endTs', { endTs })
            .andWhere('t.value_type = :valueType', { valueType: 'float' })
            .orderBy('ABS(t.timestamp - :boundaryTs)', 'ASC')
            .setParameter('boundaryTs', boundaryTs)
            .limit(1)
            .getOne();

        if (!telemetryData || telemetryData.float_value === null) {
            return null;
        }

        return {
            timestamp: telemetryData.timestamp,
            value: telemetryData.float_value,
            density: telemetryData.density_snapshot || 1000,
            profileId: telemetryData.oil_profile_id || 'unknown'
        };
    }

    /**
     * Calculate hourly accumulation for a specific hour using boundary-based approach
     * @param deviceId - Device ID
     * @param hourStart - Start of the hour (e.g., 2025-01-01 00:00:00)
     */
    async calculateHourlyAccumulation(deviceId: string, hourStart: Date): Promise<TabiotFlowAccumulation[]> {
        const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000); // +1 hour

        const results: TabiotFlowAccumulation[] = [];

        // Process each flow sensor
        for (const sensorKey of this.FLOW_SENSORS) {
            try {
                const accumulation = await this.calculateSensorAccumulationBoundary(
                    deviceId,
                    sensorKey,
                    hourStart,
                    hourEnd
                );

                if (accumulation) {
                    results.push(accumulation);
                }
            } catch (error) {
                console.error(`Error calculating accumulation for ${sensorKey}:`, error);
            }
        }

        return results;
    }

    /**
     * Calculate accumulation for a single sensor using boundary-based TFS delta
     * More accurate than first/last sample approach
     */
    private async calculateSensorAccumulationBoundary(
        deviceId: string,
        sensorKey: string,
        hourStart: Date,
        hourEnd: Date
    ): Promise<TabiotFlowAccumulation | null> {
        // Map fs to tfs sensor key
        const tfsKey = sensorKey.replace('fs', 'tfs');

        // Get TFS values near hour boundaries (within 1 minute tolerance)
        const tfsAtStart = await this.getTFSValueNearBoundary(deviceId, tfsKey, hourStart, 60000);
        const tfsAtEnd = await this.getTFSValueNearBoundary(deviceId, tfsKey, hourEnd, 60000);

        if (!tfsAtStart || !tfsAtEnd) {
            console.log(`Insufficient TFS boundary data for ${tfsKey} in hour ${hourStart.toISOString()}`);
            return null;
        }

        // Validate time coverage (should be close to 1 hour)
        const actualDurationMs = tfsAtEnd.timestamp - tfsAtStart.timestamp;
        const actualHours = actualDurationMs / (1000 * 60 * 60);
        const coveragePercent = (actualDurationMs / 3600000) * 100;

        // Warn if coverage is less than 95%
        if (coveragePercent < 95) {
            console.warn(`Low data coverage for ${tfsKey}: ${coveragePercent.toFixed(1)}% (${actualDurationMs/1000}s)`);
        }

        // Calculate accumulated volume from TFS delta
        let accumulatedM3 = tfsAtEnd.value - tfsAtStart.value;

        // Handle TFS reset (negative delta)
        if (accumulatedM3 < 0) {
            console.warn(`TFS reset detected for ${tfsKey} in hour ${hourStart.toISOString()}, cannot calculate accurately`);
            // For now, return null when reset detected in boundary approach
            // Future: implement segment-based calculation for resets
            return null;
        }

        // Use density from end sample (most recent)
        let finalDensity = tfsAtEnd.density;
        let finalProfileId = tfsAtEnd.profileId;
        
        // If no density, try to get from active profile
        if (!finalDensity || finalDensity === 1000) {
            const activeProfile = await this.oilProfileRepo.findOne({
                where: { device_id: deviceId, is_active: true }
            });
            
            if (activeProfile) {
                finalDensity = activeProfile.density;
                finalProfileId = activeProfile.name;
            } else {
                console.warn(`No density available for ${tfsKey} at ${hourStart.toISOString()}`);
                finalDensity = 1000; // Default fallback
            }
        }

        // Calculate accumulated tons
        const accumulatedTons = accumulatedM3 * (finalDensity / 1000);

        // Calculate average flow rate based on actual time coverage
        const avgFlowM3h = actualHours > 0 ? accumulatedM3 / actualHours : 0;

        // Check if record already exists
        const existing = await this.accumulationRepo.findOne({
            where: {
                device_id: deviceId,
                sensor_key: sensorKey,
                hour_start: hourStart
            }
        });

        const accumulationData = {
            device_id: deviceId,
            sensor_key: sensorKey,
            hour_start: hourStart,
            hour_end: hourEnd,
            avg_flow_m3h: avgFlowM3h,
            accumulated_m3: accumulatedM3,
            accumulated_tons: accumulatedTons,
            oil_profile_id: finalProfileId,
            density_used: finalDensity,
            sample_count: 2, // Boundary-based uses 2 samples (start + end)
            first_sample_ts: tfsAtStart.timestamp,
            last_sample_ts: tfsAtEnd.timestamp
        };

        if (existing) {
            // Update existing record
            Object.assign(existing, accumulationData);
            return await this.accumulationRepo.save(existing);
        } else {
            // Create new record
            const accumulation = this.accumulationRepo.create(accumulationData);
            return await this.accumulationRepo.save(accumulation);
        }
    }

    /**
     * Calculate accumulated volume when TFS was reset within the hour
     * Sum up deltas between consecutive readings, treating negative deltas as resets
     */
    private calculateWithResets(telemetryData: any[]): number {
        let totalAccumulated = 0;
        
        for (let i = 1; i < telemetryData.length; i++) {
            const prevValue = telemetryData[i - 1].float_value || 0;
            const currValue = telemetryData[i].float_value || 0;
            const delta = currValue - prevValue;
            
            if (delta >= 0) {
                // Normal accumulation
                totalAccumulated += delta;
            } else {
                // Reset detected, add current value (accumulated since reset)
                totalAccumulated += currValue;
            }
        }
        
        return totalAccumulated;
    }

    /**
     * Calculate accumulation for the previous hour (for scheduled job)
     */
    async calculatePreviousHour(deviceId: string): Promise<TabiotFlowAccumulation[]> {
        const now = new Date();
        const previousHourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1, 0, 0, 0);
        
        return await this.calculateHourlyAccumulation(deviceId, previousHourStart);
    }

    /**
     * Get accumulation data for a date range
     */
    async getAccumulationByDateRange(
        deviceId: string,
        sensorKey: string,
        startDate: Date,
        endDate: Date
    ): Promise<TabiotFlowAccumulation[]> {
        return await this.accumulationRepo.find({
            where: {
                device_id: deviceId,
                sensor_key: sensorKey,
                hour_start: Between(startDate, endDate)
            },
            order: {
                hour_start: 'ASC'
            }
        });
    }

    /**
     * Get total accumulation for a sensor in a date range
     */
    async getTotalAccumulation(
        deviceId: string,
        sensorKey: string,
        startDate: Date,
        endDate: Date
    ): Promise<{ total_m3: number; total_tons: number }> {
        const result = await this.accumulationRepo
            .createQueryBuilder('a')
            .select('SUM(a.accumulated_m3)', 'total_m3')
            .addSelect('SUM(a.accumulated_tons)', 'total_tons')
            .where('a.device_id = :deviceId', { deviceId })
            .andWhere('a.sensor_key = :sensorKey', { sensorKey })
            .andWhere('a.hour_start >= :startDate', { startDate })
            .andWhere('a.hour_start < :endDate', { endDate })
            .getRawOne();

        return {
            total_m3: parseFloat(result?.total_m3 || '0'),
            total_tons: parseFloat(result?.total_tons || '0')
        };
    }

    /**
     * Backfill accumulation data for a date range
     * Use this to calculate historical data
     */
    async backfillAccumulation(
        deviceId: string,
        startDate: Date,
        endDate: Date
    ): Promise<number> {
        let processedHours = 0;
        const currentHour = new Date(startDate);

        while (currentHour < endDate) {
            try {
                await this.calculateHourlyAccumulation(deviceId, new Date(currentHour));
                processedHours++;
            } catch (error) {
                console.error(`Error processing hour ${currentHour.toISOString()}:`, error);
            }

            // Move to next hour
            currentHour.setHours(currentHour.getHours() + 1);
        }

        return processedHours;
    }
}

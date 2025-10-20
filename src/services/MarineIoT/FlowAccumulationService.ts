import { DataSource, Repository, Between } from 'typeorm';
import { TabiotFlowAccumulation } from '../../orm/entities/flow-accumulation/TabiotFlowAccumulation';
import { TabiotDeviceTelemetry } from '../../orm/entities/device-telemetry/TabiotDeviceTelemetry';
import { TabiotOilProfile } from '../../orm/entities/oil-profile/TabiotOilProfile';

/**
 * Flow Accumulation Service for Marine IoT System
 * Calculates hourly flow accumulation from flow sensor data
 */
export class FlowAccumulationService {
    private accumulationRepo: Repository<TabiotFlowAccumulation>;
    private telemetryRepo: Repository<TabiotDeviceTelemetry>;
    private oilProfileRepo: Repository<TabiotOilProfile>;

    // Flow sensor keys
    private readonly FLOW_SENSORS = ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];

    constructor(private dataSource: DataSource) {
        this.accumulationRepo = dataSource.getRepository(TabiotFlowAccumulation);
        this.telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry);
        this.oilProfileRepo = dataSource.getRepository(TabiotOilProfile);
    }

    /**
     * Calculate hourly accumulation for a specific hour
     * @param deviceId - Device ID
     * @param hourStart - Start of the hour (e.g., 2025-01-01 00:00:00)
     */
    async calculateHourlyAccumulation(deviceId: string, hourStart: Date): Promise<TabiotFlowAccumulation[]> {
        const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000); // +1 hour

        // Convert to timestamps for query
        const startTs = hourStart.getTime();
        const endTs = hourEnd.getTime();

        const results: TabiotFlowAccumulation[] = [];

        // Process each flow sensor
        for (const sensorKey of this.FLOW_SENSORS) {
            try {
                const accumulation = await this.calculateSensorAccumulation(
                    deviceId,
                    sensorKey,
                    hourStart,
                    hourEnd,
                    startTs,
                    endTs
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
     * Calculate accumulation for a single sensor
     */
    private async calculateSensorAccumulation(
        deviceId: string,
        sensorKey: string,
        hourStart: Date,
        hourEnd: Date,
        startTs: number,
        endTs: number
    ): Promise<TabiotFlowAccumulation | null> {
        // Query telemetry data for this sensor in this hour
        const telemetryData = await this.telemetryRepo
            .createQueryBuilder('t')
            .where('t.device_id = :deviceId', { deviceId })
            .andWhere('t.key_name = :sensorKey', { sensorKey })
            .andWhere('t.timestamp >= :startTs', { startTs })
            .andWhere('t.timestamp < :endTs', { endTs })
            .andWhere('t.value_type = :valueType', { valueType: 'float' })
            .orderBy('t.timestamp', 'ASC')
            .getMany();

        if (telemetryData.length === 0) {
            console.log(`No data for ${sensorKey} in hour ${hourStart.toISOString()}`);
            return null;
        }

        // Calculate average flow rate
        const flowValues = telemetryData.map(t => t.float_value || 0);
        const avgFlowM3h = flowValues.reduce((sum, val) => sum + val, 0) / flowValues.length;

        // Get density from first sample (assuming profile doesn't change mid-hour)
        const firstSample = telemetryData[0];
        const densityUsed = firstSample.density_snapshot || 0;
        const oilProfileId = firstSample.oil_profile_id || 'unknown';

        // If no density snapshot, try to get from active profile
        let finalDensity = densityUsed;
        let finalProfileId = oilProfileId;
        
        if (!densityUsed) {
            const activeProfile = await this.oilProfileRepo.findOne({
                where: { device_id: deviceId, is_active: true }
            });
            
            if (activeProfile) {
                finalDensity = activeProfile.density;
                finalProfileId = activeProfile.name;
            } else {
                console.warn(`No density available for ${sensorKey} at ${hourStart.toISOString()}`);
                finalDensity = 1000; // Default fallback (1000 kg/m³ = 1 ton/m³ for water)
            }
        }

        // Calculate accumulated volume
        // avg_flow_m3h is the average flow rate in m3/h
        // For 1 hour period: accumulated_m3 = avg_flow_m3h * 1
        const accumulatedM3 = avgFlowM3h * 1; // 1 hour
        // Convert kg/m³ to tons/m³ for tons calculation
        // tons = m3 * (kg/m³ / 1000)
        const accumulatedTons = accumulatedM3 * (finalDensity / 1000);

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
            sample_count: telemetryData.length,
            first_sample_ts: telemetryData[0].timestamp,
            last_sample_ts: telemetryData[telemetryData.length - 1].timestamp
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

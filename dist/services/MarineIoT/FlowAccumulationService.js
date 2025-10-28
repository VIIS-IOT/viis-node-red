"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowAccumulationService = void 0;
const typeorm_1 = require("typeorm");
const TabiotFlowAccumulation_1 = require("../../orm/entities/flow-accumulation/TabiotFlowAccumulation");
const TabiotDeviceTelemetry_1 = require("../../orm/entities/device-telemetry/TabiotDeviceTelemetry");
const TabiotOilProfile_1 = require("../../orm/entities/oil-profile/TabiotOilProfile");
const FlowCheckpointService_1 = require("./FlowCheckpointService");
/**
 * Flow Accumulation Service for Marine IoT System
 * Calculates hourly flow accumulation from flow sensor data
 */
class FlowAccumulationService {
    constructor(dataSource) {
        this.dataSource = dataSource;
        // Flow sensor keys
        this.FLOW_SENSORS = ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];
        this.TFS_SENSORS = ['tfs01', 'tfs02', 'tfs03', 'tfs04', 'tfs05', 'tfs06'];
        this.accumulationRepo = dataSource.getRepository(TabiotFlowAccumulation_1.TabiotFlowAccumulation);
        this.telemetryRepo = dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
        this.oilProfileRepo = dataSource.getRepository(TabiotOilProfile_1.TabiotOilProfile);
        this.checkpointService = new FlowCheckpointService_1.FlowCheckpointService(dataSource);
    }
    /**
     * Calculate hourly accumulation for a specific hour
     * @param deviceId - Device ID
     * @param hourStart - Start of the hour (e.g., 2025-01-01 00:00:00)
     */
    async calculateHourlyAccumulation(deviceId, hourStart) {
        const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000); // +1 hour
        // Convert to timestamps for query
        const startTs = hourStart.getTime();
        const endTs = hourEnd.getTime();
        const results = [];
        // Process each flow sensor
        for (const sensorKey of this.FLOW_SENSORS) {
            try {
                const accumulation = await this.calculateSensorAccumulation(deviceId, sensorKey, hourStart, hourEnd, startTs, endTs);
                if (accumulation) {
                    results.push(accumulation);
                }
            }
            catch (error) {
                console.error(`Error calculating accumulation for ${sensorKey}:`, error);
            }
        }
        return results;
    }
    /**
     * Calculate accumulation for a single sensor using TFS delta
     */
    async calculateSensorAccumulation(deviceId, sensorKey, hourStart, hourEnd, startTs, endTs) {
        // Map fs to tfs sensor key
        const tfsKey = sensorKey.replace('fs', 'tfs');
        // Query TFS telemetry data for this sensor in this hour
        const telemetryData = await this.telemetryRepo
            .createQueryBuilder('t')
            .where('t.device_id = :deviceId', { deviceId })
            .andWhere('t.key_name = :tfsKey', { tfsKey })
            .andWhere('t.timestamp >= :startTs', { startTs })
            .andWhere('t.timestamp < :endTs', { endTs })
            .andWhere('t.value_type = :valueType', { valueType: 'float' })
            .orderBy('t.timestamp', 'ASC')
            .getMany();
        if (telemetryData.length === 0) {
            console.log(`No TFS data for ${tfsKey} in hour ${hourStart.toISOString()}`);
            return null;
        }
        // Get first and last TFS values
        const firstSample = telemetryData[0];
        const lastSample = telemetryData[telemetryData.length - 1];
        const firstTfsValue = firstSample.float_value || 0;
        const lastTfsValue = lastSample.float_value || 0;
        // Calculate accumulated volume from TFS delta
        let accumulatedM3 = lastTfsValue - firstTfsValue;
        // Handle TFS reset within the hour (negative delta)
        if (accumulatedM3 < 0) {
            // Calculate accumulated volume in segments
            accumulatedM3 = this.calculateWithResets(telemetryData);
            console.warn(`TFS reset detected for ${tfsKey} in hour ${hourStart.toISOString()}, accumulated: ${accumulatedM3.toFixed(4)}`);
        }
        // Get density from last sample
        const densityUsed = lastSample.density_snapshot || 0;
        const oilProfileId = lastSample.oil_profile_id || 'unknown';
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
            }
            else {
                console.warn(`No density available for ${tfsKey} at ${hourStart.toISOString()}`);
                finalDensity = 1000; // Default fallback
            }
        }
        // Calculate accumulated tons
        const accumulatedTons = accumulatedM3 * (finalDensity / 1000);
        // Calculate average flow rate for compatibility
        const avgFlowM3h = accumulatedM3 / 1; // Accumulated / 1 hour
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
        }
        else {
            // Create new record
            const accumulation = this.accumulationRepo.create(accumulationData);
            return await this.accumulationRepo.save(accumulation);
        }
    }
    /**
     * Calculate accumulated volume when TFS was reset within the hour
     * Sum up deltas between consecutive readings, treating negative deltas as resets
     */
    calculateWithResets(telemetryData) {
        let totalAccumulated = 0;
        for (let i = 1; i < telemetryData.length; i++) {
            const prevValue = telemetryData[i - 1].float_value || 0;
            const currValue = telemetryData[i].float_value || 0;
            const delta = currValue - prevValue;
            if (delta >= 0) {
                // Normal accumulation
                totalAccumulated += delta;
            }
            else {
                // Reset detected, add current value (accumulated since reset)
                totalAccumulated += currValue;
            }
        }
        return totalAccumulated;
    }
    /**
     * Calculate accumulation for the previous hour (for scheduled job)
     */
    async calculatePreviousHour(deviceId) {
        const now = new Date();
        const previousHourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1, 0, 0, 0);
        return await this.calculateHourlyAccumulation(deviceId, previousHourStart);
    }
    /**
     * Get accumulation data for a date range
     */
    async getAccumulationByDateRange(deviceId, sensorKey, startDate, endDate) {
        return await this.accumulationRepo.find({
            where: {
                device_id: deviceId,
                sensor_key: sensorKey,
                hour_start: (0, typeorm_1.Between)(startDate, endDate)
            },
            order: {
                hour_start: 'ASC'
            }
        });
    }
    /**
     * Get total accumulation for a sensor in a date range
     */
    async getTotalAccumulation(deviceId, sensorKey, startDate, endDate) {
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
            total_m3: parseFloat((result === null || result === void 0 ? void 0 : result.total_m3) || '0'),
            total_tons: parseFloat((result === null || result === void 0 ? void 0 : result.total_tons) || '0')
        };
    }
    /**
     * Backfill accumulation data for a date range
     * Use this to calculate historical data
     */
    async backfillAccumulation(deviceId, startDate, endDate) {
        let processedHours = 0;
        const currentHour = new Date(startDate);
        while (currentHour < endDate) {
            try {
                await this.calculateHourlyAccumulation(deviceId, new Date(currentHour));
                processedHours++;
            }
            catch (error) {
                console.error(`Error processing hour ${currentHour.toISOString()}:`, error);
            }
            // Move to next hour
            currentHour.setHours(currentHour.getHours() + 1);
        }
        return processedHours;
    }
}
exports.FlowAccumulationService = FlowAccumulationService;

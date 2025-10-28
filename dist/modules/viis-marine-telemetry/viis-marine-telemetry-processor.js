"use strict";
/**
 * Marine IoT Telemetry Processor
 * Extends base telemetry processor with oil profile tracking
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViisMarinetTelemetryProcessor = void 0;
const OilProfileService_1 = require("../../services/MarineIoT/OilProfileService");
const TabiotDeviceTelemetry_1 = require("../../orm/entities/device-telemetry/TabiotDeviceTelemetry");
const FlowCheckpointService_1 = require("../../services/MarineIoT/FlowCheckpointService");
const TripAccumulationService_1 = require("../../services/MarineIoT/TripAccumulationService");
const TripManagementService_1 = require("../../services/MarineIoT/TripManagementService");
class ViisMarinetTelemetryProcessor {
    constructor(node, nodeContext, dataSource, marineConfig, deviceId) {
        this.node = node;
        this.nodeContext = nodeContext;
        this.dataSource = dataSource;
        this.marineConfig = marineConfig;
        this.oilProfileService = new OilProfileService_1.OilProfileService(dataSource);
        this.checkpointService = new FlowCheckpointService_1.FlowCheckpointService(dataSource);
        this.tripAccumulationService = new TripAccumulationService_1.TripAccumulationService(dataSource);
        this.tripManagementService = new TripManagementService_1.TripManagementService(dataSource);
        this.deviceId = deviceId;
        this.profileCache = {
            profile: null,
            timestamp: 0
        };
        this.profileCacheByMachine = new Map();
    }
    /**
     * Get active oil profile with caching
     */
    async getActiveProfile() {
        const now = Date.now();
        const cacheAge = now - this.profileCache.timestamp;
        // Return cached profile if still valid
        if (this.profileCache.profile && cacheAge < this.marineConfig.profileCacheDuration) {
            this.node.log(`[Marine] Using cached profile: ${this.profileCache.profile.name}`);
            return this.profileCache.profile;
        }
        // Query fresh profile from database
        try {
            const profile = await this.oilProfileService.getActiveProfile(this.deviceId);
            if (profile) {
                this.profileCache = {
                    profile: {
                        name: profile.name,
                        device_id: profile.device_id,
                        machine_type: profile.machine_type,
                        oil_type: profile.oil_type,
                        operating_temperature: profile.operating_temperature,
                        density: profile.density,
                        label: profile.label,
                        is_active: profile.is_active
                    },
                    timestamp: now
                };
                this.node.log(`[Marine] Loaded active profile: ${profile.name} (${profile.machine_type}, ${profile.oil_type}, density: ${profile.density})`);
            }
            else {
                this.node.warn('[Marine] No active oil profile found');
                this.profileCache = { profile: null, timestamp: now };
            }
            return this.profileCache.profile;
        }
        catch (error) {
            this.node.error(`[Marine] Failed to get active profile: ${error.message}`);
            return null;
        }
    }
    /**
     * Get active profile for a specific sensor (with caching)
     */
    async getProfileForSensor(sensorKey) {
        const machineType = OilProfileService_1.OilProfileService.getMachineTypeBySensor(sensorKey);
        if (!machineType) {
            this.node.warn(`[Marine] Unknown sensor key: ${sensorKey}`);
            return null;
        }
        const now = Date.now();
        const cachedProfile = this.profileCacheByMachine.get(machineType);
        // Return cached if valid
        if (cachedProfile && cachedProfile.profile && (now - cachedProfile.timestamp) < this.marineConfig.profileCacheDuration) {
            return cachedProfile.profile;
        }
        // Query fresh profile
        try {
            const profile = await this.oilProfileService.getActiveProfileForMachine(this.deviceId, machineType);
            if (profile) {
                const oilProfile = {
                    name: profile.name,
                    device_id: profile.device_id,
                    machine_type: profile.machine_type,
                    oil_type: profile.oil_type,
                    operating_temperature: profile.operating_temperature,
                    density: profile.density,
                    label: profile.label,
                    is_active: profile.is_active
                };
                this.profileCacheByMachine.set(machineType, {
                    profile: oilProfile,
                    timestamp: now
                });
                this.node.log(`[Marine] Loaded profile for ${machineType}: ${profile.name} (${profile.oil_type}, ${profile.density} kg/m³)`);
                return oilProfile;
            }
            else {
                this.profileCacheByMachine.set(machineType, { profile: null, timestamp: now });
                this.node.warn(`[Marine] No active profile for ${machineType}`);
                return null;
            }
        }
        catch (error) {
            this.node.error(`[Marine] Failed to get profile for ${machineType}: ${error.message}`);
            return null;
        }
    }
    /**
     * Process flow sensor data and enrich with oil profile information
     */
    async processFlowSensorData(telemetryData) {
        if (!this.marineConfig.enabled) {
            return [];
        }
        const timestamp = Date.now();
        const flowSensorData = [];
        // Extract flow sensor values with machine-specific profiles
        for (const sensorKey of this.marineConfig.flowSensorKeys) {
            if (telemetryData[sensorKey] !== undefined && telemetryData[sensorKey] !== null) {
                const value = parseFloat(telemetryData[sensorKey]);
                if (!isNaN(value)) {
                    // Get profile specific to this sensor's machine
                    const profile = await this.getProfileForSensor(sensorKey);
                    flowSensorData.push({
                        device_id: this.deviceId,
                        timestamp: timestamp,
                        key_name: sensorKey,
                        float_value: value,
                        oil_profile_id: (profile === null || profile === void 0 ? void 0 : profile.name) || null,
                        density_snapshot: (profile === null || profile === void 0 ? void 0 : profile.density) || null
                    });
                }
            }
        }
        if (flowSensorData.length > 0) {
            const profileSummary = [...new Set(flowSensorData.map(d => d.oil_profile_id))].join(', ');
            this.node.log(`[Marine] Processed ${flowSensorData.length} flow sensor readings with profiles: ${profileSummary || 'none'}`);
        }
        return flowSensorData;
    }
    /**
     * Save flow sensor data to database with profile information
     */
    async saveFlowSensorData(flowSensorData) {
        if (flowSensorData.length === 0) {
            return;
        }
        try {
            const telemetryRepo = this.dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
            const entities = flowSensorData.map(data => {
                const entity = new TabiotDeviceTelemetry_1.TabiotDeviceTelemetry();
                entity.device_id = data.device_id;
                entity.timestamp = data.timestamp;
                entity.key_name = data.key_name;
                entity.value_type = 'float';
                entity.float_value = data.float_value;
                entity.oil_profile_id = data.oil_profile_id;
                entity.density_snapshot = data.density_snapshot;
                return entity;
            });
            // Use upsert to handle duplicates
            await telemetryRepo.save(entities);
            this.node.log(`[Marine] Saved ${entities.length} flow sensor records to database`);
        }
        catch (error) {
            this.node.error(`[Marine] Failed to save flow sensor data: ${error.message}`);
            throw error;
        }
    }
    /**
     * Clear profile cache (useful for testing or manual refresh)
     */
    clearCache() {
        this.profileCache = { profile: null, timestamp: 0 };
        this.node.log('[Marine] Profile cache cleared');
    }
    /**
     * Get current cache status
     */
    getCacheStatus() {
        const age = Date.now() - this.profileCache.timestamp;
        return {
            hasCache: this.profileCache.profile !== null,
            age: age,
            profile: this.profileCache.profile
        };
    }
    /**
     * Parse TFS (Total Flow Sensor) values from holding registers
     * Each TFS sensor uses 2 consecutive registers: integer part + decimal part
     * Formula: tfs_value = integer_part + (decimal_part / 1000)
     *
     * Mapping:
     * - tfs01: registers 10-11
     * - tfs02: registers 12-13
     * - tfs03: registers 14-15
     * - tfs04: registers 16-17
     * - tfs05: registers 18-19
     * - tfs06: registers 20-21
     */
    parseTfsValues(holdingRegisterData) {
        const tfsSensorData = [];
        const timestamp = Date.now();
        // TFS register mapping: [sensor_key, integer_address, decimal_address]
        const tfsMapping = [
            ['tfs01', 10, 11],
            ['tfs02', 12, 13],
            ['tfs03', 14, 15],
            ['tfs04', 16, 17],
            ['tfs05', 18, 19],
            ['tfs06', 20, 21]
        ];
        for (const [sensorKey, intAddr, decAddr] of tfsMapping) {
            // Check if addresses are within bounds
            if (intAddr < holdingRegisterData.length && decAddr < holdingRegisterData.length) {
                const integerPart = holdingRegisterData[intAddr];
                const decimalPart = holdingRegisterData[decAddr];
                // Validate values
                if (integerPart !== undefined && integerPart !== null &&
                    decimalPart !== undefined && decimalPart !== null) {
                    // Parse: integer + decimal/1000
                    const tfsValue = integerPart + (decimalPart / 1000);
                    tfsSensorData.push({
                        device_id: this.deviceId,
                        timestamp: timestamp,
                        key_name: sensorKey,
                        tfs_value: tfsValue
                    });
                    this.node.log(`[Marine] Parsed ${sensorKey}: ${integerPart} + ${decimalPart}/1000 = ${tfsValue.toFixed(4)} m³`);
                }
            }
        }
        if (tfsSensorData.length > 0) {
            this.node.log(`[Marine] Parsed ${tfsSensorData.length} TFS values`);
        }
        return tfsSensorData;
    }
    /**
     * Process and save TFS values to database with profile information
     * Also updates checkpoints and trip accumulation
     * This method should be called after holding registers are read
     */
    async processTfsData(holdingRegisterData) {
        if (!this.marineConfig.enabled) {
            return [];
        }
        const tfsSensorData = this.parseTfsValues(holdingRegisterData);
        if (tfsSensorData.length > 0) {
            // Save TFS to database with profile/density
            await this.saveTfsData(tfsSensorData);
            // Update checkpoints and calculate deltas
            await this.updateCheckpointsAndAccumulation(tfsSensorData);
        }
        return tfsSensorData;
    }
    /**
     * Save TFS data to database with oil profile and density
     * TFS data needs profile/density for tons calculation in accumulation service
     */
    async saveTfsData(tfsSensorData) {
        if (tfsSensorData.length === 0) {
            return;
        }
        try {
            const telemetryRepo = this.dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
            const entities = [];
            // Get profile for each TFS sensor based on corresponding flow sensor
            for (const data of tfsSensorData) {
                // Map tfs01 -> fs01 to get machine type
                const fsSensorKey = data.key_name.replace('tfs', 'fs');
                const profile = await this.getProfileForSensor(fsSensorKey);
                const entity = new TabiotDeviceTelemetry_1.TabiotDeviceTelemetry();
                entity.device_id = data.device_id;
                entity.timestamp = data.timestamp;
                entity.key_name = data.key_name; // tfs01, tfs02, etc.
                entity.value_type = 'float';
                entity.float_value = data.tfs_value;
                entity.oil_profile_id = (profile === null || profile === void 0 ? void 0 : profile.name) || null;
                entity.density_snapshot = (profile === null || profile === void 0 ? void 0 : profile.density) || null;
                entities.push(entity);
            }
            // Save to database
            await telemetryRepo.save(entities);
            this.node.log(`[Marine] Saved ${entities.length} TFS records to database`);
        }
        catch (error) {
            this.node.error(`[Marine] Failed to save TFS data: ${error.message}`);
            throw error;
        }
    }
    /**
     * Update checkpoints and trip accumulation based on TFS delta
     * This is called after TFS data is saved to database
     */
    async updateCheckpointsAndAccumulation(tfsSensorData) {
        if (tfsSensorData.length === 0) {
            return;
        }
        try {
            // Check if there's an active trip
            const activeTrip = await this.tripManagementService.getActiveTrip(this.deviceId);
            // Prepare checkpoint updates
            const checkpointUpdates = [];
            const tripUpdates = [];
            for (const data of tfsSensorData) {
                // Update trip checkpoint (always)
                const tripCheckpoint = await this.checkpointService.updateCheckpoint({
                    deviceId: data.device_id,
                    sensorKey: data.key_name,
                    tfsValue: data.tfs_value,
                    checkpointType: 'trip'
                });
                // If we have a positive delta and an active trip, accumulate
                if (activeTrip && tripCheckpoint.delta !== null && tripCheckpoint.delta > 0) {
                    // Get profile for density/tons calculation
                    const fsSensorKey = data.key_name.replace('tfs', 'fs');
                    const profile = await this.getProfileForSensor(fsSensorKey);
                    const density = (profile === null || profile === void 0 ? void 0 : profile.density) || 1000; // Default to 1000 kg/m³
                    // Calculate delta in tons
                    const deltaM3 = tripCheckpoint.delta;
                    const deltaTons = deltaM3 * (density / 1000);
                    tripUpdates.push({
                        sensorKey: fsSensorKey, // Use fs01-fs06 for trip accumulation
                        flowRate: {
                            m3h: deltaM3, // Store delta in m3h field
                            th: deltaTons // Store delta in th field
                        },
                        density: density,
                        oilProfileId: (profile === null || profile === void 0 ? void 0 : profile.name) || null
                    });
                    this.node.log(`[Marine] ${data.key_name} delta: ${deltaM3.toFixed(4)} m³ (${deltaTons.toFixed(4)} tons)`);
                }
                if (tripCheckpoint.wasReset) {
                    this.node.warn(`[Marine] ${data.key_name} was reset, checkpoint updated to ${data.tfs_value.toFixed(4)} m³`);
                }
            }
            // Batch update trip accumulation if we have deltas
            if (activeTrip && tripUpdates.length > 0) {
                await this.tripAccumulationService.batchUpdateAccumulationWithDelta(activeTrip.id, tripUpdates);
                this.node.log(`[Marine] Updated trip accumulation for ${tripUpdates.length} sensors`);
            }
        }
        catch (error) {
            this.node.error(`[Marine] Failed to update checkpoints: ${error.message}`);
            // Don't throw - this is not critical, logging is enough
        }
    }
}
exports.ViisMarinetTelemetryProcessor = ViisMarinetTelemetryProcessor;

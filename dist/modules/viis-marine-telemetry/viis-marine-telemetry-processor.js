"use strict";
/**
 * Marine IoT Telemetry Processor
 * Extends base telemetry processor with oil profile tracking
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViisMarinetTelemetryProcessor = void 0;
const OilProfileService_1 = require("../../services/MarineIoT/OilProfileService");
const TabiotDeviceTelemetry_1 = require("../../orm/entities/device-telemetry/TabiotDeviceTelemetry");
class ViisMarinetTelemetryProcessor {
    constructor(node, nodeContext, dataSource, marineConfig, deviceId) {
        this.node = node;
        this.nodeContext = nodeContext;
        this.dataSource = dataSource;
        this.marineConfig = marineConfig;
        this.oilProfileService = new OilProfileService_1.OilProfileService(dataSource);
        this.deviceId = deviceId;
        this.profileCache = {
            profile: null,
            timestamp: 0
        };
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
                        oil_type: profile.oil_type,
                        operating_temperature: profile.operating_temperature,
                        density: profile.density,
                        label: profile.label,
                        is_active: profile.is_active
                    },
                    timestamp: now
                };
                this.node.log(`[Marine] Loaded active profile: ${profile.name} (${profile.oil_type}, density: ${profile.density})`);
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
     * Process flow sensor data and enrich with oil profile information
     */
    async processFlowSensorData(telemetryData) {
        if (!this.marineConfig.enabled) {
            return [];
        }
        const timestamp = Date.now();
        const activeProfile = await this.getActiveProfile();
        const flowSensorData = [];
        // Extract flow sensor values
        for (const sensorKey of this.marineConfig.flowSensorKeys) {
            if (telemetryData[sensorKey] !== undefined && telemetryData[sensorKey] !== null) {
                const value = parseFloat(telemetryData[sensorKey]);
                if (!isNaN(value)) {
                    flowSensorData.push({
                        device_id: this.deviceId,
                        timestamp: timestamp,
                        key_name: sensorKey,
                        float_value: value,
                        oil_profile_id: (activeProfile === null || activeProfile === void 0 ? void 0 : activeProfile.name) || null,
                        density_snapshot: (activeProfile === null || activeProfile === void 0 ? void 0 : activeProfile.density) || null
                    });
                }
            }
        }
        if (flowSensorData.length > 0) {
            this.node.log(`[Marine] Processed ${flowSensorData.length} flow sensor readings with profile: ${(activeProfile === null || activeProfile === void 0 ? void 0 : activeProfile.name) || 'none'}`);
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
}
exports.ViisMarinetTelemetryProcessor = ViisMarinetTelemetryProcessor;

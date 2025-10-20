/**
 * Marine IoT Telemetry Processor
 * Extends base telemetry processor with oil profile tracking
 */

import { Node, NodeContext } from 'node-red';
import { DataSource } from 'typeorm';
import { OilProfileService } from '../../services/MarineIoT/OilProfileService';
import { TabiotDeviceTelemetry } from '../../orm/entities/device-telemetry/TabiotDeviceTelemetry';
import { MarineIoTConfig, OilProfile, OilProfileCache } from './viis-marine-telemetry-config';

export interface FlowSensorData {
    device_id: string;
    timestamp: number;
    key_name: string;
    float_value: number;
    oil_profile_id: string | null;
    density_snapshot: number | null;
}

export class ViisMarinetTelemetryProcessor {
    private oilProfileService: OilProfileService;
    private profileCache: OilProfileCache;
    private deviceId: string;

    constructor(
        private node: Node,
        private nodeContext: NodeContext,
        private dataSource: DataSource,
        private marineConfig: MarineIoTConfig,
        deviceId: string
    ) {
        this.oilProfileService = new OilProfileService(dataSource);
        this.deviceId = deviceId;
        this.profileCache = {
            profile: null,
            timestamp: 0
        };
    }

    /**
     * Get active oil profile with caching
     */
    async getActiveProfile(): Promise<OilProfile | null> {
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
            } else {
                this.node.warn('[Marine] No active oil profile found');
                this.profileCache = { profile: null, timestamp: now };
            }

            return this.profileCache.profile;
        } catch (error) {
            this.node.error(`[Marine] Failed to get active profile: ${(error as Error).message}`);
            return null;
        }
    }

    /**
     * Process flow sensor data and enrich with oil profile information
     */
    async processFlowSensorData(telemetryData: Record<string, any>): Promise<FlowSensorData[]> {
        if (!this.marineConfig.enabled) {
            return [];
        }

        const timestamp = Date.now();
        const activeProfile = await this.getActiveProfile();
        const flowSensorData: FlowSensorData[] = [];

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
                        oil_profile_id: activeProfile?.name || null,
                        density_snapshot: activeProfile?.density || null
                    });
                }
            }
        }

        if (flowSensorData.length > 0) {
            this.node.log(`[Marine] Processed ${flowSensorData.length} flow sensor readings with profile: ${activeProfile?.name || 'none'}`);
        }

        return flowSensorData;
    }

    /**
     * Save flow sensor data to database with profile information
     */
    async saveFlowSensorData(flowSensorData: FlowSensorData[]): Promise<void> {
        if (flowSensorData.length === 0) {
            return;
        }

        try {
            const telemetryRepo = this.dataSource.getRepository(TabiotDeviceTelemetry);
            
            const entities = flowSensorData.map(data => {
                const entity = new TabiotDeviceTelemetry();
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
        } catch (error) {
            this.node.error(`[Marine] Failed to save flow sensor data: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Clear profile cache (useful for testing or manual refresh)
     */
    clearCache(): void {
        this.profileCache = { profile: null, timestamp: 0 };
        this.node.log('[Marine] Profile cache cleared');
    }

    /**
     * Get current cache status
     */
    getCacheStatus(): { hasCache: boolean; age: number; profile: OilProfile | null } {
        const age = Date.now() - this.profileCache.timestamp;
        return {
            hasCache: this.profileCache.profile !== null,
            age: age,
            profile: this.profileCache.profile
        };
    }
}

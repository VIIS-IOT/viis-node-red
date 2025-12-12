"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OilProfileService = void 0;
const TabiotOilProfile_1 = require("../../orm/entities/oil-profile/TabiotOilProfile");
const TabiotDevice_1 = require("../../orm/entities/device/TabiotDevice");
/**
 * Oil Profile Service for Marine IoT System
 * Handles CRUD operations and active profile management
 * Supports multi-machine profiles:
 * - BOILER: Nồi hơi (fs01 - direct consumption)
 * - MAIN_ENGINE: Máy chính (fs02 in - fs03 return)
 * - GENERATOR_HFO: Máy phát HFO (fs03 in - fs04 return)
 * - GENERATOR_DO: Máy phát DO (fs05 in - fs06 return)
 */
class OilProfileService {
    constructor(dataSource) {
        this.dataSource = dataSource;
        this.oilProfileRepo = dataSource.getRepository(TabiotOilProfile_1.TabiotOilProfile);
        this.deviceRepo = dataSource.getRepository(TabiotDevice_1.TabiotDevice);
    }
    /**
     * Get machine type from sensor key
     */
    static getMachineTypeBySensor(sensorKey) {
        return OilProfileService.SENSOR_MACHINE_MAP[sensorKey] || null;
    }
    /**
     * Create a new oil profile
     */
    async createProfile(data) {
        // Verify device exists
        const device = await this.deviceRepo.findOne({ where: { name: data.device_id } });
        if (!device) {
            throw new Error(`Device ${data.device_id} not found`);
        }
        // If this profile is set to active, deactivate all other profiles for this device & machine
        if (data.is_active) {
            await this.deactivateProfilesForMachine(data.device_id, data.machine_type);
        }
        const profile = this.oilProfileRepo.create(Object.assign(Object.assign({}, data), { creation: new Date(), modified: new Date() }));
        return await this.oilProfileRepo.save(profile);
    }
    /**
     * Set a profile as active (deactivates all others for the same device & machine)
     */
    async setActiveProfile(profileName) {
        const profile = await this.oilProfileRepo.findOne({
            where: {
                name: profileName,
                deleted_at: null
            }
        });
        if (!profile) {
            throw new Error(`Profile ${profileName} not found`);
        }
        // Deactivate all profiles for this device & machine
        await this.deactivateProfilesForMachine(profile.device_id, profile.machine_type);
        // Activate this profile
        profile.is_active = true;
        profile.modified = new Date();
        return await this.oilProfileRepo.save(profile);
    }
    /**
     * Deactivate all profiles for a device
     */
    async deactivateAllProfiles(deviceId) {
        await this.oilProfileRepo
            .createQueryBuilder()
            .update(TabiotOilProfile_1.TabiotOilProfile)
            .set({ is_active: false, modified: new Date() })
            .where('device_id = :deviceId AND deleted_at IS NULL', { deviceId })
            .execute();
    }
    /**
     * Deactivate all profiles for a specific machine on a device
     */
    async deactivateProfilesForMachine(deviceId, machineType) {
        await this.oilProfileRepo
            .createQueryBuilder()
            .update(TabiotOilProfile_1.TabiotOilProfile)
            .set({ is_active: false, modified: new Date() })
            .where('device_id = :deviceId AND machine_type = :machineType AND deleted_at IS NULL', { deviceId, machineType })
            .execute();
    }
    /**
     * Get active profile for a device (deprecated - use getActiveProfileForMachine)
     */
    async getActiveProfile(deviceId) {
        return await this.oilProfileRepo.findOne({
            where: {
                device_id: deviceId,
                is_active: true,
                deleted_at: null
            }
        });
    }
    /**
     * Get active profile for a specific machine on a device
     */
    async getActiveProfileForMachine(deviceId, machineType) {
        return await this.oilProfileRepo.findOne({
            where: {
                device_id: deviceId,
                machine_type: machineType,
                is_active: true,
                deleted_at: null
            }
        });
    }
    /**
     * Get all profiles for a device
     */
    async getProfilesByDevice(deviceId) {
        return await this.oilProfileRepo.find({
            where: {
                device_id: deviceId,
                deleted_at: null
            },
            order: { creation: 'DESC' }
        });
    }
    /**
     * Update profile
     */
    async updateProfile(profileName, updates) {
        const profile = await this.oilProfileRepo.findOne({
            where: {
                name: profileName,
                deleted_at: null
            }
        });
        if (!profile) {
            throw new Error(`Profile ${profileName} not found`);
        }
        // If setting this profile as active, deactivate others for the same machine
        if (updates.is_active && !profile.is_active) {
            await this.deactivateProfilesForMachine(profile.device_id, profile.machine_type);
        }
        Object.assign(profile, updates);
        profile.modified = new Date();
        return await this.oilProfileRepo.save(profile);
    }
    /**
     * Soft delete profile (cannot delete active profile)
     * Profile is marked as deleted but data is preserved for historical flow accumulation records
     */
    async deleteProfile(profileName) {
        const profile = await this.oilProfileRepo.findOne({
            where: {
                name: profileName,
                deleted_at: null
            }
        });
        if (!profile) {
            throw new Error(`Profile ${profileName} not found`);
        }
        if (profile.is_active) {
            throw new Error('Cannot delete active profile. Please activate another profile first.');
        }
        // Soft delete: just mark as deleted
        profile.deleted_at = new Date();
        profile.modified = new Date();
        await this.oilProfileRepo.save(profile);
    }
    /**
     * Restore a soft-deleted profile
     */
    async restoreProfile(profileName) {
        const profile = await this.oilProfileRepo.findOne({
            where: { name: profileName },
            withDeleted: true
        });
        if (!profile) {
            throw new Error(`Profile ${profileName} not found`);
        }
        if (!profile.deleted_at) {
            throw new Error(`Profile ${profileName} is not deleted`);
        }
        profile.deleted_at = undefined;
        profile.modified = new Date();
        return await this.oilProfileRepo.save(profile);
    }
    /**
     * Permanently delete a profile (hard delete)
     * WARNING: This will fail if profile is referenced in flow_accumulation table
     */
    async permanentlyDeleteProfile(profileName) {
        const profile = await this.oilProfileRepo.findOne({
            where: { name: profileName },
            withDeleted: true
        });
        if (!profile) {
            throw new Error(`Profile ${profileName} not found`);
        }
        await this.oilProfileRepo.remove(profile);
    }
}
exports.OilProfileService = OilProfileService;
// Sensor key to machine type mapping
// NEW MAPPING (4 machines):
// - fs01: BOILER (direct consumption)
// - fs02-fs03: MAIN_ENGINE (fs02 in - fs03 return)
// - fs03-fs04: GENERATOR_HFO (fs03 in - fs04 return) 
// - fs05-fs06: GENERATOR_DO (fs05 in - fs06 return)
// Note: fs03 is shared between MAIN_ENGINE (return) and GENERATOR_HFO (in)
OilProfileService.SENSOR_MACHINE_MAP = {
    'fs01': 'BOILER',
    'fs02': 'MAIN_ENGINE',
    'fs03': 'GENERATOR_HFO', // Primary mapping for fs03 is MAIN_ENGINE
    'fs04': 'GENERATOR_HFO',
    'fs05': 'GENERATOR_DO',
    'fs06': 'GENERATOR_DO',
};

import { DataSource, Repository } from 'typeorm';
import { TabiotOilProfile } from '../../orm/entities/oil-profile/TabiotOilProfile';
import { TabiotDevice } from '../../orm/entities/device/TabiotDevice';

export type MachineType = 'GENERATOR' | 'MAIN_ENGINE' | 'BOILER';

/**
 * Oil Profile Service for Marine IoT System
 * Handles CRUD operations and active profile management
 * Supports multi-machine profiles (Generator, Main Engine, Boiler)
 */
export class OilProfileService {
    private oilProfileRepo: Repository<TabiotOilProfile>;
    private deviceRepo: Repository<TabiotDevice>;

    // Sensor key to machine type mapping
    private static readonly SENSOR_MACHINE_MAP: Record<string, MachineType> = {
        'fs01': 'GENERATOR',
        'fs02': 'GENERATOR',
        'fs03': 'MAIN_ENGINE',
        'fs04': 'MAIN_ENGINE',
        'fs05': 'BOILER',
        'fs06': 'BOILER',
    };

    constructor(private dataSource: DataSource) {
        this.oilProfileRepo = dataSource.getRepository(TabiotOilProfile);
        this.deviceRepo = dataSource.getRepository(TabiotDevice);
    }

    /**
     * Get machine type from sensor key
     */
    static getMachineTypeBySensor(sensorKey: string): MachineType | null {
        return OilProfileService.SENSOR_MACHINE_MAP[sensorKey] || null;
    }

    /**
     * Create a new oil profile
     */
    async createProfile(data: {
        name: string;
        device_id: string;
        machine_type: MachineType;
        oil_type: 'DO' | 'FO';
        operating_temperature: number;
        density: number;
        label?: string;
        description?: string;
        is_active?: boolean;
    }): Promise<TabiotOilProfile> {
        // Verify device exists
        const device = await this.deviceRepo.findOne({ where: { name: data.device_id } });
        if (!device) {
            throw new Error(`Device ${data.device_id} not found`);
        }

        // If this profile is set to active, deactivate all other profiles for this device & machine
        if (data.is_active) {
            await this.deactivateProfilesForMachine(data.device_id, data.machine_type);
        }

        const profile = this.oilProfileRepo.create({
            ...data,
            creation: new Date(),
            modified: new Date()
        });

        return await this.oilProfileRepo.save(profile);
    }

    /**
     * Set a profile as active (deactivates all others for the same device & machine)
     */
    async setActiveProfile(profileName: string): Promise<TabiotOilProfile> {
        const profile = await this.oilProfileRepo.findOne({ where: { name: profileName } });
        
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
    async deactivateAllProfiles(deviceId: string): Promise<void> {
        await this.oilProfileRepo
            .createQueryBuilder()
            .update(TabiotOilProfile)
            .set({ is_active: false, modified: new Date() })
            .where('device_id = :deviceId', { deviceId })
            .execute();
    }

    /**
     * Deactivate all profiles for a specific machine on a device
     */
    async deactivateProfilesForMachine(deviceId: string, machineType: MachineType): Promise<void> {
        await this.oilProfileRepo
            .createQueryBuilder()
            .update(TabiotOilProfile)
            .set({ is_active: false, modified: new Date() })
            .where('device_id = :deviceId AND machine_type = :machineType', { deviceId, machineType })
            .execute();
    }

    /**
     * Get active profile for a device (deprecated - use getActiveProfileForMachine)
     */
    async getActiveProfile(deviceId: string): Promise<TabiotOilProfile | null> {
        return await this.oilProfileRepo.findOne({
            where: {
                device_id: deviceId,
                is_active: true
            }
        });
    }

    /**
     * Get active profile for a specific machine on a device
     */
    async getActiveProfileForMachine(deviceId: string, machineType: MachineType): Promise<TabiotOilProfile | null> {
        return await this.oilProfileRepo.findOne({
            where: {
                device_id: deviceId,
                machine_type: machineType,
                is_active: true
            }
        });
    }

    /**
     * Get all profiles for a device
     */
    async getProfilesByDevice(deviceId: string): Promise<TabiotOilProfile[]> {
        return await this.oilProfileRepo.find({
            where: { device_id: deviceId },
            order: { creation: 'DESC' }
        });
    }

    /**
     * Update profile
     */
    async updateProfile(
        profileName: string,
        updates: Partial<TabiotOilProfile>
    ): Promise<TabiotOilProfile> {
        const profile = await this.oilProfileRepo.findOne({ where: { name: profileName } });
        
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
     * Delete profile (cannot delete active profile)
     */
    async deleteProfile(profileName: string): Promise<void> {
        const profile = await this.oilProfileRepo.findOne({ where: { name: profileName } });
        
        if (!profile) {
            throw new Error(`Profile ${profileName} not found`);
        }

        if (profile.is_active) {
            throw new Error('Cannot delete active profile. Please activate another profile first.');
        }

        await this.oilProfileRepo.remove(profile);
    }
}

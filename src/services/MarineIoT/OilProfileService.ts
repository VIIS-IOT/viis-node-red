import { DataSource, Repository } from 'typeorm';
import { TabiotOilProfile } from '../../orm/entities/oil-profile/TabiotOilProfile';
import { TabiotDevice } from '../../orm/entities/device/TabiotDevice';

/**
 * Oil Profile Service for Marine IoT System
 * Handles CRUD operations and active profile management
 */
export class OilProfileService {
    private oilProfileRepo: Repository<TabiotOilProfile>;
    private deviceRepo: Repository<TabiotDevice>;

    constructor(private dataSource: DataSource) {
        this.oilProfileRepo = dataSource.getRepository(TabiotOilProfile);
        this.deviceRepo = dataSource.getRepository(TabiotDevice);
    }

    /**
     * Create a new oil profile
     */
    async createProfile(data: {
        name: string;
        device_id: string;
        oil_type: 'BO' | 'DO';
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

        // If this profile is set to active, deactivate all other profiles for this device
        if (data.is_active) {
            await this.deactivateAllProfiles(data.device_id);
        }

        const profile = this.oilProfileRepo.create({
            ...data,
            creation: new Date(),
            modified: new Date()
        });

        return await this.oilProfileRepo.save(profile);
    }

    /**
     * Set a profile as active (deactivates all others for the same device)
     */
    async setActiveProfile(profileName: string): Promise<TabiotOilProfile> {
        const profile = await this.oilProfileRepo.findOne({ where: { name: profileName } });
        
        if (!profile) {
            throw new Error(`Profile ${profileName} not found`);
        }

        // Deactivate all profiles for this device
        await this.deactivateAllProfiles(profile.device_id);

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
     * Get active profile for a device
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

        // If setting this profile as active, deactivate others
        if (updates.is_active && !profile.is_active) {
            await this.deactivateAllProfiles(profile.device_id);
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

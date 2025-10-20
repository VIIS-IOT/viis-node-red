import { DataSource } from 'typeorm';
import { OilProfileService } from '../OilProfileService';
import { TabiotOilProfile } from '../../../orm/entities/oil-profile/TabiotOilProfile';
import { TabiotDevice } from '../../../orm/entities/device/TabiotDevice';

describe('OilProfileService', () => {
    let dataSource: DataSource;
    let service: OilProfileService;
    let testDeviceId: string;

    beforeAll(async () => {
        // Initialize test database connection
        dataSource = new DataSource({
            type: 'mysql',
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3306'),
            username: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'viis_local_test',
            entities: [TabiotOilProfile, TabiotDevice],
            synchronize: true, // Auto-create tables for testing
            dropSchema: true, // Clean slate for each test run
        });

        await dataSource.initialize();
        service = new OilProfileService(dataSource);
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    beforeEach(async () => {
        // Create test device
        const deviceRepo = dataSource.getRepository(TabiotDevice);
        testDeviceId = `test_device_${Date.now()}`;
        
        const device = deviceRepo.create({
            name: testDeviceId,
            id: testDeviceId,
            label: 'Test Device',
            creation: new Date(),
            modified: new Date(),
        });
        
        await deviceRepo.save(device);
    });

    afterEach(async () => {
        // Cleanup
        await dataSource.getRepository(TabiotOilProfile).clear();
        await dataSource.getRepository(TabiotDevice).clear();
    });

    describe('createProfile', () => {
        it('should create a profile with valid data', async () => {
            const profileData = {
                name: 'test_profile_bo',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE' as const,
                oil_type: 'FO' as const,
                operating_temperature: 85,
                density: 950,
                label: 'Test BO Profile',
                is_active: false,
            };

            const profile = await service.createProfile(profileData);

            expect(profile).toBeDefined();
            expect(profile.name).toBe('test_profile_bo');
            expect(profile.oil_type).toBe('BO');
            expect(profile.density).toBe(0.95);
            expect(profile.is_active).toBe(false);
        });

        it('should create active profile and deactivate others', async () => {
            // Create first profile as active
            const profile1 = await service.createProfile({
                name: 'profile_1',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'FO' as const,
                operating_temperature: 85,
                density: 950,
                is_active: true,
            });

            expect(profile1.is_active).toBe(true);

            // Create second profile as active
            const profile2 = await service.createProfile({
                name: 'profile_2',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'DO' as const,
                operating_temperature: 40,
                density: 850,
                is_active: true,
            });

            // Refresh first profile
            const updatedProfile1 = await dataSource
                .getRepository(TabiotOilProfile)
                .findOne({ where: { name: 'profile_1' } });

            expect(profile2.is_active).toBe(true);
            expect(updatedProfile1?.is_active).toBe(false);
        });

        it('should throw error for non-existent device', async () => {
            await expect(
                service.createProfile({
                    name: 'test_profile',
                    device_id: 'non_existent_device',
                    machine_type: 'MAIN_ENGINE',
                    oil_type: 'FO' as const,
                    operating_temperature: 85,
                    density: 950,
                })
            ).rejects.toThrow('Device non_existent_device not found');
        });
    });

    describe('setActiveProfile', () => {
        it('should activate profile and deactivate others', async () => {
            // Create multiple profiles
            await service.createProfile({
                name: 'profile_1',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'FO' as const,
                operating_temperature: 85,
                density: 950,
                is_active: true,
            });

            await service.createProfile({
                name: 'profile_2',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'DO' as const,
                operating_temperature: 40,
                density: 850,
                is_active: false,
            });

            // Switch to profile_2
            await service.setActiveProfile('profile_2');

            const profile1 = await dataSource
                .getRepository(TabiotOilProfile)
                .findOne({ where: { name: 'profile_1' } });
            const profile2 = await dataSource
                .getRepository(TabiotOilProfile)
                .findOne({ where: { name: 'profile_2' } });

            expect(profile1?.is_active).toBe(false);
            expect(profile2?.is_active).toBe(true);
        });

        it('should throw error for non-existent profile', async () => {
            await expect(
                service.setActiveProfile('non_existent_profile')
            ).rejects.toThrow('Profile non_existent_profile not found');
        });
    });

    describe('getActiveProfile', () => {
        it('should return active profile', async () => {
            await service.createProfile({
                name: 'active_profile',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'FO' as const,
                operating_temperature: 85,
                density: 950,
                is_active: true,
            });

            const activeProfile = await service.getActiveProfile(testDeviceId);

            expect(activeProfile).toBeDefined();
            expect(activeProfile?.name).toBe('active_profile');
            expect(activeProfile?.is_active).toBe(true);
        });

        it('should return null when no active profile', async () => {
            const activeProfile = await service.getActiveProfile(testDeviceId);
            expect(activeProfile).toBeNull();
        });
    });

    describe('getProfilesByDevice', () => {
        it('should return all profiles for device', async () => {
            await service.createProfile({
                name: 'profile_1',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'FO' as const,
                operating_temperature: 85,
                density: 950,
            });

            await service.createProfile({
                name: 'profile_2',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'DO' as const,
                operating_temperature: 40,
                density: 850,
            });

            const profiles = await service.getProfilesByDevice(testDeviceId);

            expect(profiles).toHaveLength(2);
            expect(profiles.map(p => p.name)).toContain('profile_1');
            expect(profiles.map(p => p.name)).toContain('profile_2');
        });
    });

    describe('updateProfile', () => {
        it('should update profile fields', async () => {
            await service.createProfile({
                name: 'update_test',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'FO' as const,
                operating_temperature: 85,
                density: 950,
                label: 'Original Label',
            });

            const updated = await service.updateProfile('update_test', {
                label: 'Updated Label',
                density: 960,
            });

            expect(updated.label).toBe('Updated Label');
            expect(updated.density).toBe(0.96);
            expect(updated.oil_type).toBe('FO'); // Unchanged
        });

        it('should deactivate others when setting as active', async () => {
            await service.createProfile({
                name: 'profile_1',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'FO' as const,
                operating_temperature: 85,
                density: 950,
                is_active: true,
            });

            await service.createProfile({
                name: 'profile_2',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'DO' as const,
                operating_temperature: 40,
                density: 850,
                is_active: false,
            });

            await service.updateProfile('profile_2', { is_active: true });

            const profile1 = await dataSource
                .getRepository(TabiotOilProfile)
                .findOne({ where: { name: 'profile_1' } });

            expect(profile1?.is_active).toBe(false);
        });
    });

    describe('deleteProfile', () => {
        it('should delete inactive profile', async () => {
            await service.createProfile({
                name: 'to_delete',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'FO' as const,
                operating_temperature: 85,
                density: 950,
                is_active: false,
            });

            await service.deleteProfile('to_delete');

            const deleted = await dataSource
                .getRepository(TabiotOilProfile)
                .findOne({ where: { name: 'to_delete' } });

            expect(deleted).toBeNull();
        });

        it('should throw error when deleting active profile', async () => {
            await service.createProfile({
                name: 'active_profile',
                device_id: testDeviceId,
                machine_type: 'MAIN_ENGINE',
                oil_type: 'FO' as const,
                operating_temperature: 85,
                density: 950,
                is_active: true,
            });

            await expect(
                service.deleteProfile('active_profile')
            ).rejects.toThrow('Cannot delete active profile');
        });
    });
});

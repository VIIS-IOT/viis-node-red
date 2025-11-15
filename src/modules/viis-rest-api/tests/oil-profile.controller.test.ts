/**
 * @fileoverview Oil Profile Controller Tests
 *
 * Comprehensive test suite for Oil Profile API endpoints
 */

import 'reflect-metadata';
import { Container } from 'typedi';
import { OilProfileController } from '../controllers/oil-profile.controller';
import { OilProfileService } from '../../../services/MarineIoT/OilProfileService';
import { DatabaseService } from '../services/database.service';
import { NODE_TOKEN } from '../container/container.setup';
import {
    CreateOilProfileDto,
    UpdateOilProfileDto,
    ActivateProfileDto,
    QueryOilProfileDto,
    OilType,
    MachineType
} from '../dto/oil-profile.dto';
import {
    BadRequestError,
    NotFoundError,
    InternalServerError
} from 'routing-controllers';

// Mock Node
const mockNode = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    status: jest.fn()
} as any;

// Mock Oil Profile Service
const mockOilProfileService = {
    createProfile: jest.fn(),
    getProfilesByDevice: jest.fn(),
    getActiveProfile: jest.fn(),
    updateProfile: jest.fn(),
    setActiveProfile: jest.fn(),
    deleteProfile: jest.fn()
};

// Mock Database Service
const mockDataSource = {
    getRepository: jest.fn(() => ({}))
};

const mockDatabaseService = {
    getDataSource: jest.fn(() => mockDataSource as any),
    isInitialized: jest.fn(() => true),
    query: jest.fn()
};

describe('OilProfileController', () => {
    let controller: OilProfileController;

    beforeAll(() => {
        // Setup Container
        Container.set(NODE_TOKEN, mockNode);
        Container.set(DatabaseService, mockDatabaseService);
    });

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();

        // Create controller instance
        controller = new OilProfileController(
            mockDatabaseService as any,
            mockNode
        );

        // Replace service with mock
        (controller as any).oilProfileService = mockOilProfileService;
    });

    afterAll(() => {
        Container.reset();
    });

    describe('createProfile', () => {
        it('should create BO profile successfully', async () => {
            const createDto: CreateOilProfileDto = {
                device_id: 'device_001',
                machine_type: MachineType.MAIN_ENGINE,
                oil_type: OilType.FO,
                operating_temperature: 85,
                density: 0.95,
                label: 'Bunker Oil Standard',
                is_active: true
            };

            const mockProfile = {
                name: 'profile_bo_123',
                ...createDto,
                creation: new Date(),
                modified: new Date()
            };

            mockOilProfileService.createProfile.mockResolvedValue(mockProfile);

            const result = await controller.createProfile(createDto);

            expect(result).toBeDefined();
            expect(result.name).toContain('profile_bo_');
            expect(result.oil_type).toBe(OilType.FO);
            expect(result.density).toBe(0.95);
            expect(result.is_active).toBe(true);
            expect(mockOilProfileService.createProfile).toHaveBeenCalledWith(
                expect.objectContaining({
                    device_id: 'device_001',
                    oil_type: OilType.FO,
                    density: 0.95
                })
            );
        });

        it('should create DO profile successfully', async () => {
            const createDto: CreateOilProfileDto = {
                device_id: 'device_001',
                machine_type: MachineType.GENERATOR_DO,
                oil_type: OilType.DO,
                operating_temperature: 40,
                density: 0.85,
                label: 'Diesel Oil Standard'
            };

            const mockProfile = {
                name: 'profile_do_123',
                ...createDto,
                is_active: false,
                creation: new Date(),
                modified: new Date()
            };

            mockOilProfileService.createProfile.mockResolvedValue(mockProfile);

            const result = await controller.createProfile(createDto);

            expect(result.oil_type).toBe(OilType.DO);
            expect(result.density).toBe(0.85);
            expect(result.is_active).toBe(false);
        });

        it('should use provided name if specified', async () => {
            const createDto: CreateOilProfileDto = {
                name: 'custom_profile_name',
                device_id: 'device_001',
                machine_type: MachineType.BOILER,
                oil_type: OilType.FO,
                operating_temperature: 85,
                density: 0.95
            };

            const mockProfile = {
                ...createDto,
                is_active: false,
                creation: new Date(),
                modified: new Date()
            };

            mockOilProfileService.createProfile.mockResolvedValue(mockProfile);

            const result = await controller.createProfile(createDto);

            expect(result.name).toBe('custom_profile_name');
        });

        it('should throw NotFoundError if device not found', async () => {
            const createDto: CreateOilProfileDto = {
                device_id: 'non_existent_device',
                machine_type: MachineType.MAIN_ENGINE,
                oil_type: OilType.FO,
                operating_temperature: 85,
                density: 0.95
            };

            mockOilProfileService.createProfile.mockRejectedValue(
                new Error('Device non_existent_device not found')
            );

            await expect(controller.createProfile(createDto))
                .rejects.toThrow(NotFoundError);
        });

        it('should throw InternalServerError on other errors', async () => {
            const createDto: CreateOilProfileDto = {
                device_id: 'device_001',
                machine_type: MachineType.MAIN_ENGINE,
                oil_type: OilType.FO,
                operating_temperature: 85,
                density: 0.95
            };

            mockOilProfileService.createProfile.mockRejectedValue(
                new Error('Database connection failed')
            );

            await expect(controller.createProfile(createDto))
                .rejects.toThrow(InternalServerError);
        });
    });

    describe('getProfiles', () => {
        it('should get all profiles for a device', async () => {
            const query: QueryOilProfileDto = {
                device_id: 'device_001'
            };

            const mockProfiles = [
                {
                    name: 'profile_bo_1',
                    device_id: 'device_001',
                    oil_type: OilType.FO,
                    operating_temperature: 85,
                    density: 0.95,
                    is_active: true,
                    creation: new Date(),
                    modified: new Date()
                },
                {
                    name: 'profile_do_1',
                    device_id: 'device_001',
                    oil_type: OilType.DO,
                    operating_temperature: 40,
                    density: 0.85,
                    is_active: false,
                    creation: new Date(),
                    modified: new Date()
                }
            ];

            mockOilProfileService.getProfilesByDevice.mockResolvedValue(mockProfiles);

            const result = await controller.getProfiles(query);

            expect(result.profiles).toHaveLength(2);
            expect(result.total).toBe(2);
            expect(result.limit).toBe(20);
            expect(result.offset).toBe(0);
        });

        it('should filter profiles by oil type', async () => {
            const query: QueryOilProfileDto = {
                device_id: 'device_001',
                oil_type: OilType.FO
            };

            const mockProfiles = [
                {
                    name: 'profile_bo_1',
                    device_id: 'device_001',
                    oil_type: OilType.FO,
                    operating_temperature: 85,
                    density: 0.95,
                    is_active: true,
                    creation: new Date(),
                    modified: new Date()
                },
                {
                    name: 'profile_do_1',
                    device_id: 'device_001',
                    oil_type: OilType.DO,
                    operating_temperature: 40,
                    density: 0.85,
                    is_active: false,
                    creation: new Date(),
                    modified: new Date()
                }
            ];

            mockOilProfileService.getProfilesByDevice.mockResolvedValue(mockProfiles);

            const result = await controller.getProfiles(query);

            expect(result.profiles).toHaveLength(1);
            expect(result.profiles[0].oil_type).toBe(OilType.FO);
        });

        it('should filter profiles by active status', async () => {
            const query: QueryOilProfileDto = {
                device_id: 'device_001',
                is_active: true
            };

            const mockProfiles = [
                {
                    name: 'profile_bo_1',
                    device_id: 'device_001',
                    oil_type: OilType.FO,
                    operating_temperature: 85,
                    density: 0.95,
                    is_active: true,
                    creation: new Date(),
                    modified: new Date()
                },
                {
                    name: 'profile_do_1',
                    device_id: 'device_001',
                    oil_type: OilType.DO,
                    operating_temperature: 40,
                    density: 0.85,
                    is_active: false,
                    creation: new Date(),
                    modified: new Date()
                }
            ];

            mockOilProfileService.getProfilesByDevice.mockResolvedValue(mockProfiles);

            const result = await controller.getProfiles(query);

            expect(result.profiles).toHaveLength(1);
            expect(result.profiles[0].is_active).toBe(true);
        });

        it('should apply pagination', async () => {
            const query: QueryOilProfileDto = {
                device_id: 'device_001',
                limit: 1,
                offset: 1
            };

            const mockProfiles = [
                {
                    name: 'profile_1',
                    device_id: 'device_001',
                    oil_type: OilType.FO,
                    operating_temperature: 85,
                    density: 0.95,
                    is_active: false,
                    creation: new Date(),
                    modified: new Date()
                },
                {
                    name: 'profile_2',
                    device_id: 'device_001',
                    oil_type: OilType.DO,
                    operating_temperature: 40,
                    density: 0.85,
                    is_active: false,
                    creation: new Date(),
                    modified: new Date()
                }
            ];

            mockOilProfileService.getProfilesByDevice.mockResolvedValue(mockProfiles);

            const result = await controller.getProfiles(query);

            expect(result.profiles).toHaveLength(1);
            expect(result.profiles[0].name).toBe('profile_2');
            expect(result.total).toBe(2);
            expect(result.limit).toBe(1);
            expect(result.offset).toBe(1);
        });

        it('should throw BadRequestError if device_id not provided', async () => {
            const query: QueryOilProfileDto = {};

            await expect(controller.getProfiles(query))
                .rejects.toThrow(BadRequestError);
        });
    });

    describe('getActiveProfile', () => {
        it('should return active profile', async () => {
            const mockProfile = {
                name: 'profile_bo_1',
                device_id: 'device_001',
                oil_type: OilType.FO,
                operating_temperature: 85,
                density: 0.95,
                is_active: true,
                creation: new Date(),
                modified: new Date()
            };

            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile);

            const result = await controller.getActiveProfile('device_001');

            expect(result).toBeDefined();
            expect(result!.is_active).toBe(true);
            expect(result!.device_id).toBe('device_001');
        });

        it('should return null if no active profile', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(null);

            const result = await controller.getActiveProfile('device_001');

            expect(result).toBeNull();
        });

        it('should throw InternalServerError on error', async () => {
            mockOilProfileService.getActiveProfile.mockRejectedValue(
                new Error('Database error')
            );

            await expect(controller.getActiveProfile('device_001'))
                .rejects.toThrow(InternalServerError);
        });
    });

    describe('updateProfile', () => {
        it('should update profile successfully', async () => {
            const updateDto: UpdateOilProfileDto = {
                density: 0.96,
                label: 'Updated Label'
            };

            const mockProfile = {
                name: 'profile_bo_1',
                device_id: 'device_001',
                oil_type: OilType.FO,
                operating_temperature: 85,
                density: 0.96,
                label: 'Updated Label',
                is_active: true,
                creation: new Date(),
                modified: new Date()
            };

            mockOilProfileService.updateProfile.mockResolvedValue(mockProfile);

            const result = await controller.updateProfile('profile_bo_1', updateDto);

            expect(result.density).toBe(0.96);
            expect(result.label).toBe('Updated Label');
            expect(mockOilProfileService.updateProfile).toHaveBeenCalledWith(
                'profile_bo_1',
                updateDto
            );
        });

        it('should throw NotFoundError if profile not found', async () => {
            const updateDto: UpdateOilProfileDto = {
                density: 0.96
            };

            mockOilProfileService.updateProfile.mockRejectedValue(
                new Error('Profile not_exists not found')
            );

            await expect(controller.updateProfile('not_exists', updateDto))
                .rejects.toThrow(NotFoundError);
        });
    });

    describe('activateProfile', () => {
        it('should activate profile successfully', async () => {
            const activateDto: ActivateProfileDto = {
                profile_name: 'profile_do_1'
            };

            const mockProfile = {
                name: 'profile_do_1',
                device_id: 'device_001',
                oil_type: OilType.DO,
                operating_temperature: 40,
                density: 0.85,
                is_active: true,
                creation: new Date(),
                modified: new Date()
            };

            mockOilProfileService.setActiveProfile.mockResolvedValue(mockProfile);

            const result = await controller.activateProfile(activateDto);

            expect(result.is_active).toBe(true);
            expect(result.name).toBe('profile_do_1');
            expect(mockOilProfileService.setActiveProfile).toHaveBeenCalledWith('profile_do_1');
        });

        it('should throw NotFoundError if profile not found', async () => {
            const activateDto: ActivateProfileDto = {
                profile_name: 'not_exists'
            };

            mockOilProfileService.setActiveProfile.mockRejectedValue(
                new Error('Profile not_exists not found')
            );

            await expect(controller.activateProfile(activateDto))
                .rejects.toThrow(NotFoundError);
        });
    });

    describe('deleteProfile', () => {
        it('should delete inactive profile successfully', async () => {
            mockOilProfileService.deleteProfile.mockResolvedValue(undefined);

            await controller.deleteProfile('profile_do_1');

            expect(mockOilProfileService.deleteProfile).toHaveBeenCalledWith('profile_do_1');
        });

        it('should throw NotFoundError if profile not found', async () => {
            mockOilProfileService.deleteProfile.mockRejectedValue(
                new Error('Profile not_exists not found')
            );

            await expect(controller.deleteProfile('not_exists'))
                .rejects.toThrow(NotFoundError);
        });

        it('should throw BadRequestError if trying to delete active profile', async () => {
            mockOilProfileService.deleteProfile.mockRejectedValue(
                new Error('Cannot delete active profile. Please activate another profile first.')
            );

            await expect(controller.deleteProfile('active_profile'))
                .rejects.toThrow(BadRequestError);
        });
    });
});

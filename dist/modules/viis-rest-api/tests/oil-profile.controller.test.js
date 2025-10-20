"use strict";
/**
 * @fileoverview Oil Profile Controller Tests
 *
 * Comprehensive test suite for Oil Profile API endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const typedi_1 = require("typedi");
const oil_profile_controller_1 = require("../controllers/oil-profile.controller");
const database_service_1 = require("../services/database.service");
const container_setup_1 = require("../container/container.setup");
const oil_profile_dto_1 = require("../dto/oil-profile.dto");
const routing_controllers_1 = require("routing-controllers");
// Mock Node
const mockNode = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    status: jest.fn()
};
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
    getDataSource: jest.fn(() => mockDataSource),
    isInitialized: jest.fn(() => true),
    query: jest.fn()
};
describe('OilProfileController', () => {
    let controller;
    beforeAll(() => {
        // Setup Container
        typedi_1.Container.set(container_setup_1.NODE_TOKEN, mockNode);
        typedi_1.Container.set(database_service_1.DatabaseService, mockDatabaseService);
    });
    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        // Create controller instance
        controller = new oil_profile_controller_1.OilProfileController(mockDatabaseService, mockNode);
        // Replace service with mock
        controller.oilProfileService = mockOilProfileService;
    });
    afterAll(() => {
        typedi_1.Container.reset();
    });
    describe('createProfile', () => {
        it('should create BO profile successfully', async () => {
            const createDto = {
                device_id: 'device_001',
                machine_type: oil_profile_dto_1.MachineType.MAIN_ENGINE,
                oil_type: oil_profile_dto_1.OilType.FO,
                operating_temperature: 85,
                density: 0.95,
                label: 'Bunker Oil Standard',
                is_active: true
            };
            const mockProfile = Object.assign(Object.assign({ name: 'profile_bo_123' }, createDto), { creation: new Date(), modified: new Date() });
            mockOilProfileService.createProfile.mockResolvedValue(mockProfile);
            const result = await controller.createProfile(createDto);
            expect(result).toBeDefined();
            expect(result.name).toContain('profile_bo_');
            expect(result.oil_type).toBe(oil_profile_dto_1.OilType.FO);
            expect(result.density).toBe(0.95);
            expect(result.is_active).toBe(true);
            expect(mockOilProfileService.createProfile).toHaveBeenCalledWith(expect.objectContaining({
                device_id: 'device_001',
                oil_type: oil_profile_dto_1.OilType.FO,
                density: 0.95
            }));
        });
        it('should create DO profile successfully', async () => {
            const createDto = {
                device_id: 'device_001',
                machine_type: oil_profile_dto_1.MachineType.GENERATOR,
                oil_type: oil_profile_dto_1.OilType.DO,
                operating_temperature: 40,
                density: 0.85,
                label: 'Diesel Oil Standard'
            };
            const mockProfile = Object.assign(Object.assign({ name: 'profile_do_123' }, createDto), { is_active: false, creation: new Date(), modified: new Date() });
            mockOilProfileService.createProfile.mockResolvedValue(mockProfile);
            const result = await controller.createProfile(createDto);
            expect(result.oil_type).toBe(oil_profile_dto_1.OilType.DO);
            expect(result.density).toBe(0.85);
            expect(result.is_active).toBe(false);
        });
        it('should use provided name if specified', async () => {
            const createDto = {
                name: 'custom_profile_name',
                device_id: 'device_001',
                machine_type: oil_profile_dto_1.MachineType.BOILER,
                oil_type: oil_profile_dto_1.OilType.FO,
                operating_temperature: 85,
                density: 0.95
            };
            const mockProfile = Object.assign(Object.assign({}, createDto), { is_active: false, creation: new Date(), modified: new Date() });
            mockOilProfileService.createProfile.mockResolvedValue(mockProfile);
            const result = await controller.createProfile(createDto);
            expect(result.name).toBe('custom_profile_name');
        });
        it('should throw NotFoundError if device not found', async () => {
            const createDto = {
                device_id: 'non_existent_device',
                machine_type: oil_profile_dto_1.MachineType.MAIN_ENGINE,
                oil_type: oil_profile_dto_1.OilType.FO,
                operating_temperature: 85,
                density: 0.95
            };
            mockOilProfileService.createProfile.mockRejectedValue(new Error('Device non_existent_device not found'));
            await expect(controller.createProfile(createDto))
                .rejects.toThrow(routing_controllers_1.NotFoundError);
        });
        it('should throw InternalServerError on other errors', async () => {
            const createDto = {
                device_id: 'device_001',
                machine_type: oil_profile_dto_1.MachineType.MAIN_ENGINE,
                oil_type: oil_profile_dto_1.OilType.FO,
                operating_temperature: 85,
                density: 0.95
            };
            mockOilProfileService.createProfile.mockRejectedValue(new Error('Database connection failed'));
            await expect(controller.createProfile(createDto))
                .rejects.toThrow(routing_controllers_1.InternalServerError);
        });
    });
    describe('getProfiles', () => {
        it('should get all profiles for a device', async () => {
            const query = {
                device_id: 'device_001'
            };
            const mockProfiles = [
                {
                    name: 'profile_bo_1',
                    device_id: 'device_001',
                    oil_type: oil_profile_dto_1.OilType.FO,
                    operating_temperature: 85,
                    density: 0.95,
                    is_active: true,
                    creation: new Date(),
                    modified: new Date()
                },
                {
                    name: 'profile_do_1',
                    device_id: 'device_001',
                    oil_type: oil_profile_dto_1.OilType.DO,
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
            const query = {
                device_id: 'device_001',
                oil_type: oil_profile_dto_1.OilType.FO
            };
            const mockProfiles = [
                {
                    name: 'profile_bo_1',
                    device_id: 'device_001',
                    oil_type: oil_profile_dto_1.OilType.FO,
                    operating_temperature: 85,
                    density: 0.95,
                    is_active: true,
                    creation: new Date(),
                    modified: new Date()
                },
                {
                    name: 'profile_do_1',
                    device_id: 'device_001',
                    oil_type: oil_profile_dto_1.OilType.DO,
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
            expect(result.profiles[0].oil_type).toBe(oil_profile_dto_1.OilType.FO);
        });
        it('should filter profiles by active status', async () => {
            const query = {
                device_id: 'device_001',
                is_active: true
            };
            const mockProfiles = [
                {
                    name: 'profile_bo_1',
                    device_id: 'device_001',
                    oil_type: oil_profile_dto_1.OilType.FO,
                    operating_temperature: 85,
                    density: 0.95,
                    is_active: true,
                    creation: new Date(),
                    modified: new Date()
                },
                {
                    name: 'profile_do_1',
                    device_id: 'device_001',
                    oil_type: oil_profile_dto_1.OilType.DO,
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
            const query = {
                device_id: 'device_001',
                limit: 1,
                offset: 1
            };
            const mockProfiles = [
                {
                    name: 'profile_1',
                    device_id: 'device_001',
                    oil_type: oil_profile_dto_1.OilType.FO,
                    operating_temperature: 85,
                    density: 0.95,
                    is_active: false,
                    creation: new Date(),
                    modified: new Date()
                },
                {
                    name: 'profile_2',
                    device_id: 'device_001',
                    oil_type: oil_profile_dto_1.OilType.DO,
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
            const query = {};
            await expect(controller.getProfiles(query))
                .rejects.toThrow(routing_controllers_1.BadRequestError);
        });
    });
    describe('getActiveProfile', () => {
        it('should return active profile', async () => {
            const mockProfile = {
                name: 'profile_bo_1',
                device_id: 'device_001',
                oil_type: oil_profile_dto_1.OilType.FO,
                operating_temperature: 85,
                density: 0.95,
                is_active: true,
                creation: new Date(),
                modified: new Date()
            };
            mockOilProfileService.getActiveProfile.mockResolvedValue(mockProfile);
            const result = await controller.getActiveProfile('device_001');
            expect(result).toBeDefined();
            expect(result.is_active).toBe(true);
            expect(result.device_id).toBe('device_001');
        });
        it('should return null if no active profile', async () => {
            mockOilProfileService.getActiveProfile.mockResolvedValue(null);
            const result = await controller.getActiveProfile('device_001');
            expect(result).toBeNull();
        });
        it('should throw InternalServerError on error', async () => {
            mockOilProfileService.getActiveProfile.mockRejectedValue(new Error('Database error'));
            await expect(controller.getActiveProfile('device_001'))
                .rejects.toThrow(routing_controllers_1.InternalServerError);
        });
    });
    describe('updateProfile', () => {
        it('should update profile successfully', async () => {
            const updateDto = {
                density: 0.96,
                label: 'Updated Label'
            };
            const mockProfile = {
                name: 'profile_bo_1',
                device_id: 'device_001',
                oil_type: oil_profile_dto_1.OilType.FO,
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
            expect(mockOilProfileService.updateProfile).toHaveBeenCalledWith('profile_bo_1', updateDto);
        });
        it('should throw NotFoundError if profile not found', async () => {
            const updateDto = {
                density: 0.96
            };
            mockOilProfileService.updateProfile.mockRejectedValue(new Error('Profile not_exists not found'));
            await expect(controller.updateProfile('not_exists', updateDto))
                .rejects.toThrow(routing_controllers_1.NotFoundError);
        });
    });
    describe('activateProfile', () => {
        it('should activate profile successfully', async () => {
            const activateDto = {
                profile_name: 'profile_do_1'
            };
            const mockProfile = {
                name: 'profile_do_1',
                device_id: 'device_001',
                oil_type: oil_profile_dto_1.OilType.DO,
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
            const activateDto = {
                profile_name: 'not_exists'
            };
            mockOilProfileService.setActiveProfile.mockRejectedValue(new Error('Profile not_exists not found'));
            await expect(controller.activateProfile(activateDto))
                .rejects.toThrow(routing_controllers_1.NotFoundError);
        });
    });
    describe('deleteProfile', () => {
        it('should delete inactive profile successfully', async () => {
            mockOilProfileService.deleteProfile.mockResolvedValue(undefined);
            await controller.deleteProfile('profile_do_1');
            expect(mockOilProfileService.deleteProfile).toHaveBeenCalledWith('profile_do_1');
        });
        it('should throw NotFoundError if profile not found', async () => {
            mockOilProfileService.deleteProfile.mockRejectedValue(new Error('Profile not_exists not found'));
            await expect(controller.deleteProfile('not_exists'))
                .rejects.toThrow(routing_controllers_1.NotFoundError);
        });
        it('should throw BadRequestError if trying to delete active profile', async () => {
            mockOilProfileService.deleteProfile.mockRejectedValue(new Error('Cannot delete active profile. Please activate another profile first.'));
            await expect(controller.deleteProfile('active_profile'))
                .rejects.toThrow(routing_controllers_1.BadRequestError);
        });
    });
});

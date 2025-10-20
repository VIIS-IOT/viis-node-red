"use strict";
/**
 * @fileoverview Oil Profile Controller for Marine IoT System
 *
 * Provides REST API endpoints for managing oil profiles:
 * - Create new oil profile (BO/DO)
 * - List all profiles for a device
 * - Get active profile
 * - Update profile
 * - Delete profile
 * - Activate/deactivate profile
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OilProfileController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const container_setup_1 = require("../container/container.setup");
const logger_1 = require("../utils/logger");
const OilProfileService_1 = require("../../../services/MarineIoT/OilProfileService");
const database_service_1 = require("../services/database.service");
const oil_profile_dto_1 = require("../dto/oil-profile.dto");
/**
 * Oil Profile Controller
 *
 * Base path: /api/v2/oil-profiles
 */
let OilProfileController = class OilProfileController {
    constructor(databaseService, node) {
        this.databaseService = databaseService;
        this.node = node;
        // Initialize service with data source
        const dataSource = this.databaseService.getDataSource();
        if (!dataSource) {
            throw new Error('DataSource not available');
        }
        this.oilProfileService = new OilProfileService_1.OilProfileService(dataSource);
        logger_1.logger.info(this.node, 'OilProfileController initialized');
    }
    /**
     * Create new oil profile
     * POST /api/v2/oil-profiles
     *
     * @param createDto - Oil profile creation data
     * @returns Created oil profile
     */
    async createProfile(createDto) {
        try {
            logger_1.logger.info(this.node, 'Creating oil profile', {
                device_id: createDto.device_id,
                oil_type: createDto.oil_type
            });
            // Generate name if not provided
            const profileName = createDto.name || `profile_${createDto.oil_type.toLowerCase()}_${Date.now()}`;
            const profile = await this.oilProfileService.createProfile({
                name: profileName,
                device_id: createDto.device_id,
                oil_type: createDto.oil_type,
                operating_temperature: createDto.operating_temperature,
                density: createDto.density,
                label: createDto.label,
                description: createDto.description,
                is_active: createDto.is_active || false
            });
            logger_1.logger.info(this.node, 'Oil profile created successfully', {
                profile_name: profile.name
            });
            return this.mapToResponseDto(profile);
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error creating oil profile', {
                error: error.message
            });
            if (error.message.includes('not found')) {
                throw new routing_controllers_1.NotFoundError(error.message);
            }
            throw new routing_controllers_1.InternalServerError(`Failed to create oil profile: ${error.message}`);
        }
    }
    /**
     * Get all profiles for a device
     * GET /api/v2/oil-profiles
     *
     * @param query - Query parameters
     * @returns List of oil profiles
     */
    async getProfiles(query) {
        try {
            logger_1.logger.debug(this.node, 'Fetching oil profiles', { query });
            let profiles;
            if (query.device_id) {
                // Get profiles for specific device
                profiles = await this.oilProfileService.getProfilesByDevice(query.device_id);
                // Apply filters
                if (query.oil_type) {
                    profiles = profiles.filter(p => p.oil_type === query.oil_type);
                }
                if (query.is_active !== undefined) {
                    profiles = profiles.filter(p => p.is_active === query.is_active);
                }
            }
            else {
                throw new routing_controllers_1.BadRequestError('device_id query parameter is required');
            }
            // Apply pagination
            const limit = query.limit || 20;
            const offset = query.offset || 0;
            const total = profiles.length;
            const paginatedProfiles = profiles.slice(offset, offset + limit);
            return {
                profiles: paginatedProfiles.map(p => this.mapToResponseDto(p)),
                total,
                limit,
                offset
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error fetching oil profiles', {
                error: error.message
            });
            if (error instanceof routing_controllers_1.BadRequestError) {
                throw error;
            }
            throw new routing_controllers_1.InternalServerError(`Failed to fetch oil profiles: ${error.message}`);
        }
    }
    /**
     * Get active profile for a device
     * GET /api/v2/oil-profiles/active/:device_id
     *
     * @param deviceId - Device ID
     * @returns Active oil profile or null
     */
    async getActiveProfile(deviceId) {
        try {
            logger_1.logger.debug(this.node, 'Fetching active profile', { device_id: deviceId });
            const profile = await this.oilProfileService.getActiveProfile(deviceId);
            if (!profile) {
                logger_1.logger.warn(this.node, 'No active profile found', { device_id: deviceId });
                return null;
            }
            return this.mapToResponseDto(profile);
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error fetching active profile', {
                error: error.message,
                device_id: deviceId
            });
            throw new routing_controllers_1.InternalServerError(`Failed to fetch active profile: ${error.message}`);
        }
    }
    /**
     * Get single profile by name
     * GET /api/v2/oil-profiles/:name
     *
     * @param name - Profile name
     * @returns Oil profile
     */
    async getProfile(name) {
        try {
            logger_1.logger.debug(this.node, 'Fetching profile by name', { name });
            // This would require adding a getProfileByName method to OilProfileService
            // For now, we'll throw an error
            throw new routing_controllers_1.NotFoundError(`Profile ${name} not found`);
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error fetching profile', {
                error: error.message,
                name
            });
            if (error instanceof routing_controllers_1.NotFoundError) {
                throw error;
            }
            throw new routing_controllers_1.InternalServerError(`Failed to fetch profile: ${error.message}`);
        }
    }
    /**
     * Update oil profile
     * PUT /api/v2/oil-profiles/:name
     *
     * @param name - Profile name
     * @param updateDto - Update data
     * @returns Updated profile
     */
    async updateProfile(name, updateDto) {
        try {
            logger_1.logger.info(this.node, 'Updating oil profile', { name, updates: updateDto });
            const profile = await this.oilProfileService.updateProfile(name, updateDto);
            logger_1.logger.info(this.node, 'Oil profile updated successfully', { name });
            return this.mapToResponseDto(profile);
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error updating oil profile', {
                error: error.message,
                name
            });
            if (error.message.includes('not found')) {
                throw new routing_controllers_1.NotFoundError(error.message);
            }
            throw new routing_controllers_1.InternalServerError(`Failed to update oil profile: ${error.message}`);
        }
    }
    /**
     * Activate oil profile
     * POST /api/v2/oil-profiles/activate
     *
     * @param activateDto - Profile name to activate
     * @returns Activated profile
     */
    async activateProfile(activateDto) {
        try {
            logger_1.logger.info(this.node, 'Activating oil profile', {
                profile_name: activateDto.profile_name
            });
            const profile = await this.oilProfileService.setActiveProfile(activateDto.profile_name);
            logger_1.logger.info(this.node, 'Oil profile activated successfully', {
                profile_name: profile.name
            });
            return this.mapToResponseDto(profile);
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error activating oil profile', {
                error: error.message,
                profile_name: activateDto.profile_name
            });
            if (error.message.includes('not found')) {
                throw new routing_controllers_1.NotFoundError(error.message);
            }
            throw new routing_controllers_1.InternalServerError(`Failed to activate oil profile: ${error.message}`);
        }
    }
    /**
     * Delete oil profile
     * DELETE /api/v2/oil-profiles/:name
     *
     * @param name - Profile name
     * @returns Success message
     */
    async deleteProfile(name) {
        try {
            logger_1.logger.info(this.node, 'Deleting oil profile', { name });
            await this.oilProfileService.deleteProfile(name);
            logger_1.logger.info(this.node, 'Oil profile deleted successfully', { name });
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error deleting oil profile', {
                error: error.message,
                name
            });
            if (error.message.includes('not found')) {
                throw new routing_controllers_1.NotFoundError(error.message);
            }
            if (error.message.includes('Cannot delete active profile')) {
                throw new routing_controllers_1.BadRequestError(error.message);
            }
            throw new routing_controllers_1.InternalServerError(`Failed to delete oil profile: ${error.message}`);
        }
    }
    /**
     * Map entity to response DTO
     */
    mapToResponseDto(profile) {
        return {
            name: profile.name,
            device_id: profile.device_id,
            oil_type: profile.oil_type,
            operating_temperature: profile.operating_temperature,
            density: profile.density,
            label: profile.label,
            description: profile.description,
            is_active: profile.is_active,
            creation: profile.creation,
            modified: profile.modified
        };
    }
};
exports.OilProfileController = OilProfileController;
__decorate([
    (0, routing_controllers_1.Post)('/'),
    (0, routing_controllers_1.HttpCode)(201),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [oil_profile_dto_1.CreateOilProfileDto]),
    __metadata("design:returntype", Promise)
], OilProfileController.prototype, "createProfile", null);
__decorate([
    (0, routing_controllers_1.Get)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.QueryParams)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [oil_profile_dto_1.QueryOilProfileDto]),
    __metadata("design:returntype", Promise)
], OilProfileController.prototype, "getProfiles", null);
__decorate([
    (0, routing_controllers_1.Get)('/active/:device_id'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('device_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], OilProfileController.prototype, "getActiveProfile", null);
__decorate([
    (0, routing_controllers_1.Get)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], OilProfileController.prototype, "getProfile", null);
__decorate([
    (0, routing_controllers_1.Put)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, oil_profile_dto_1.UpdateOilProfileDto]),
    __metadata("design:returntype", Promise)
], OilProfileController.prototype, "updateProfile", null);
__decorate([
    (0, routing_controllers_1.Post)('/activate'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [oil_profile_dto_1.ActivateProfileDto]),
    __metadata("design:returntype", Promise)
], OilProfileController.prototype, "activateProfile", null);
__decorate([
    (0, routing_controllers_1.Delete)('/:name'),
    (0, routing_controllers_1.HttpCode)(204),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], OilProfileController.prototype, "deleteProfile", null);
exports.OilProfileController = OilProfileController = __decorate([
    (0, routing_controllers_1.JsonController)('/oil-profiles'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService, Object])
], OilProfileController);

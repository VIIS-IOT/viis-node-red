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

import 'reflect-metadata';
import {
    JsonController,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    QueryParams,
    HttpCode,
    Authorized,
    BadRequestError,
    NotFoundError,
    InternalServerError
} from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { Node } from 'node-red';
import { NODE_TOKEN } from '../container/container.setup';
import { logger } from '../utils/logger';
import { OilProfileService } from '../../../services/MarineIoT/OilProfileService';
import { DatabaseService } from '../services/database.service';
import {
    CreateOilProfileDto,
    UpdateOilProfileDto,
    ActivateProfileDto,
    QueryOilProfileDto,
    OilProfileResponseDto,
    OilProfileListResponseDto,
    OilType
} from '../dto/oil-profile.dto';

/**
 * Oil Profile Controller
 * 
 * Base path: /api/v2/oil-profiles
 */
@JsonController('/oil-profiles')
@Service()
export class OilProfileController {
    private oilProfileService: OilProfileService;

    constructor(
        @Inject() private databaseService: DatabaseService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        // Initialize service with data source
        const dataSource = this.databaseService.getDataSource();
        if (!dataSource) {
            throw new Error('DataSource not available');
        }
        this.oilProfileService = new OilProfileService(dataSource);
        
        logger.info(this.node, 'OilProfileController initialized');
    }

    /**
     * Create new oil profile
     * POST /api/v2/oil-profiles
     * 
     * @param createDto - Oil profile creation data
     * @returns Created oil profile
     */
    @Post('/')
    @HttpCode(201)
    @Authorized()
    async createProfile(
        @Body() createDto: CreateOilProfileDto
    ): Promise<OilProfileResponseDto> {
        try {
            logger.info(this.node, 'Creating oil profile', {
                device_id: createDto.device_id,
                oil_type: createDto.oil_type
            });

            // Generate name if not provided
            const profileName = createDto.name || `profile_${createDto.oil_type.toLowerCase()}_${Date.now()}`;

            const profile = await this.oilProfileService.createProfile({
                name: profileName,
                device_id: createDto.device_id,
                machine_type: createDto.machine_type,
                oil_type: createDto.oil_type,
                operating_temperature: createDto.operating_temperature,
                density: createDto.density,
                label: createDto.label,
                description: createDto.description,
                is_active: createDto.is_active || false
            });

            logger.info(this.node, 'Oil profile created successfully', {
                profile_name: profile.name
            });

            return this.mapToResponseDto(profile);
        } catch (error) {
            logger.error(this.node, 'Error creating oil profile', {
                error: (error as Error).message
            });

            if ((error as Error).message.includes('not found')) {
                throw new NotFoundError((error as Error).message);
            }

            throw new InternalServerError(`Failed to create oil profile: ${(error as Error).message}`);
        }
    }

    /**
     * Get all profiles for a device
     * GET /api/v2/oil-profiles
     * 
     * @param query - Query parameters
     * @returns List of oil profiles
     */
    @Get('/')
    @Authorized()
    async getProfiles(
        @QueryParams() query: QueryOilProfileDto
    ): Promise<OilProfileListResponseDto> {
        try {
            logger.debug(this.node, 'Fetching oil profiles', { query });

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
            } else {
                throw new BadRequestError('device_id query parameter is required');
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
        } catch (error) {
            logger.error(this.node, 'Error fetching oil profiles', {
                error: (error as Error).message
            });

            if (error instanceof BadRequestError) {
                throw error;
            }

            throw new InternalServerError(`Failed to fetch oil profiles: ${(error as Error).message}`);
        }
    }

    /**
     * Get active profile for a device (any machine)
     * GET /api/v2/oil-profiles/active/:device_id
     * 
     * @deprecated Use getActiveProfileByMachine for machine-specific profiles
     * @param deviceId - Device ID
     * @returns Active oil profile or null
     */
    @Get('/active/:device_id')
    @Authorized()
    async getActiveProfile(
        @Param('device_id') deviceId: string
    ): Promise<OilProfileResponseDto | null> {
        try {
            logger.debug(this.node, 'Fetching active profile', { device_id: deviceId });

            const profile = await this.oilProfileService.getActiveProfile(deviceId);

            if (!profile) {
                logger.warn(this.node, 'No active profile found', { device_id: deviceId });
                return null;
            }

            return this.mapToResponseDto(profile);
        } catch (error) {
            logger.error(this.node, 'Error fetching active profile', {
                error: (error as Error).message,
                device_id: deviceId
            });

            throw new InternalServerError(`Failed to fetch active profile: ${(error as Error).message}`);
        }
    }

    /**
     * Get active profile for a specific machine on a device
     * GET /api/v2/oil-profiles/active/:device_id/:machine_type
     * 
     * @param deviceId - Device ID
     * @param machineType - Machine type (GENERATOR, MAIN_ENGINE, or BOILER)
     * @returns Active oil profile for the machine or null
     * 
     * @example
     * GET /api/v2/oil-profiles/active/ship_001/GENERATOR
     * GET /api/v2/oil-profiles/active/ship_001/MAIN_ENGINE
     * GET /api/v2/oil-profiles/active/ship_001/BOILER
     */
    @Get('/active/:device_id/:machine_type')
    @Authorized()
    async getActiveProfileByMachine(
        @Param('device_id') deviceId: string,
        @Param('machine_type') machineType: string
    ): Promise<OilProfileResponseDto | null> {
        try {
            // Validate machine type
            const validMachineTypes = ['GENERATOR', 'MAIN_ENGINE', 'BOILER'];
            if (!validMachineTypes.includes(machineType)) {
                throw new BadRequestError(
                    `Invalid machine_type. Must be one of: ${validMachineTypes.join(', ')}`
                );
            }

            logger.debug(this.node, 'Fetching active profile by machine', {
                device_id: deviceId,
                machine_type: machineType
            });

            const profile = await this.oilProfileService.getActiveProfileForMachine(
                deviceId,
                machineType as any
            );

            if (!profile) {
                logger.warn(this.node, 'No active profile found for machine', {
                    device_id: deviceId,
                    machine_type: machineType
                });
                return null;
            }

            logger.debug(this.node, 'Active profile found', {
                device_id: deviceId,
                machine_type: machineType,
                profile_name: profile.name,
                oil_type: profile.oil_type,
                density: profile.density
            });

            return this.mapToResponseDto(profile);
        } catch (error) {
            logger.error(this.node, 'Error fetching active profile by machine', {
                error: (error as Error).message,
                device_id: deviceId,
                machine_type: machineType
            });

            if (error instanceof BadRequestError) {
                throw error;
            }

            throw new InternalServerError(`Failed to fetch active profile: ${(error as Error).message}`);
        }
    }

    /**
     * Get single profile by name
     * GET /api/v2/oil-profiles/:name
     * 
     * @param name - Profile name
     * @returns Oil profile
     */
    @Get('/:name')
    @Authorized()
    async getProfile(
        @Param('name') name: string
    ): Promise<OilProfileResponseDto> {
        try {
            logger.debug(this.node, 'Fetching profile by name', { name });

            // This would require adding a getProfileByName method to OilProfileService
            // For now, we'll throw an error
            throw new NotFoundError(`Profile ${name} not found`);
        } catch (error) {
            logger.error(this.node, 'Error fetching profile', {
                error: (error as Error).message,
                name
            });

            if (error instanceof NotFoundError) {
                throw error;
            }

            throw new InternalServerError(`Failed to fetch profile: ${(error as Error).message}`);
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
    @Put('/:name')
    @Authorized()
    async updateProfile(
        @Param('name') name: string,
        @Body() updateDto: UpdateOilProfileDto
    ): Promise<OilProfileResponseDto> {
        try {
            logger.info(this.node, 'Updating oil profile', { name, updates: updateDto });

            const profile = await this.oilProfileService.updateProfile(name, updateDto);

            logger.info(this.node, 'Oil profile updated successfully', { name });

            return this.mapToResponseDto(profile);
        } catch (error) {
            logger.error(this.node, 'Error updating oil profile', {
                error: (error as Error).message,
                name
            });

            if ((error as Error).message.includes('not found')) {
                throw new NotFoundError((error as Error).message);
            }

            throw new InternalServerError(`Failed to update oil profile: ${(error as Error).message}`);
        }
    }

    /**
     * Activate oil profile
     * POST /api/v2/oil-profiles/activate
     * 
     * @param activateDto - Profile name to activate
     * @returns Activated profile
     */
    @Post('/activate')
    @Authorized()
    async activateProfile(
        @Body() activateDto: ActivateProfileDto
    ): Promise<OilProfileResponseDto> {
        try {
            logger.info(this.node, 'Activating oil profile', {
                profile_name: activateDto.profile_name
            });

            const profile = await this.oilProfileService.setActiveProfile(activateDto.profile_name);

            logger.info(this.node, 'Oil profile activated successfully', {
                profile_name: profile.name
            });

            return this.mapToResponseDto(profile);
        } catch (error) {
            logger.error(this.node, 'Error activating oil profile', {
                error: (error as Error).message,
                profile_name: activateDto.profile_name
            });

            if ((error as Error).message.includes('not found')) {
                throw new NotFoundError((error as Error).message);
            }

            throw new InternalServerError(`Failed to activate oil profile: ${(error as Error).message}`);
        }
    }

    /**
     * Soft delete oil profile (marks as deleted, preserves data for historical records)
     * DELETE /api/v2/oil-profiles/:name
     * 
     * @param name - Profile name
     * @returns Success message
     */
    @Delete('/:name')
    @HttpCode(204)
    @Authorized()
    async deleteProfile(
        @Param('name') name: string
    ): Promise<void> {
        try {
            logger.info(this.node, 'Soft deleting oil profile', { name });

            await this.oilProfileService.deleteProfile(name);

            logger.info(this.node, 'Oil profile soft deleted successfully', { name });
        } catch (error) {
            logger.error(this.node, 'Error deleting oil profile', {
                error: (error as Error).message,
                name
            });

            if ((error as Error).message.includes('not found')) {
                throw new NotFoundError((error as Error).message);
            }

            if ((error as Error).message.includes('Cannot delete active profile')) {
                throw new BadRequestError((error as Error).message);
            }

            throw new InternalServerError(`Failed to delete oil profile: ${(error as Error).message}`);
        }
    }

    /**
     * Restore a soft-deleted oil profile
     * POST /api/v2/oil-profiles/:name/restore
     * 
     * @param name - Profile name
     * @returns Restored profile
     */
    @Post('/:name/restore')
    @Authorized()
    async restoreProfile(
        @Param('name') name: string
    ): Promise<OilProfileResponseDto> {
        try {
            logger.info(this.node, 'Restoring oil profile', { name });

            const profile = await this.oilProfileService.restoreProfile(name);

            logger.info(this.node, 'Oil profile restored successfully', { name });

            return this.mapToResponseDto(profile);
        } catch (error) {
            logger.error(this.node, 'Error restoring oil profile', {
                error: (error as Error).message,
                name
            });

            if ((error as Error).message.includes('not found')) {
                throw new NotFoundError((error as Error).message);
            }

            if ((error as Error).message.includes('not deleted')) {
                throw new BadRequestError((error as Error).message);
            }

            throw new InternalServerError(`Failed to restore oil profile: ${(error as Error).message}`);
        }
    }

    /**
     * Map entity to response DTO
     */
    private mapToResponseDto(profile: any): OilProfileResponseDto {
        return {
            name: profile.name,
            device_id: profile.device_id,
            machine_type: profile.machine_type,
            oil_type: profile.oil_type as OilType,
            operating_temperature: profile.operating_temperature,
            density: profile.density,
            label: profile.label,
            description: profile.description,
            is_active: profile.is_active,
            creation: profile.creation,
            modified: profile.modified
        };
    }
}

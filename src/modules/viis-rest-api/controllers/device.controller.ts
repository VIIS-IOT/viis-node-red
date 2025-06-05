/**
 * @fileoverview Device controller - Migrated to routing-controllers
 */

import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { DeviceService } from '../services/device.service';
import { DeviceValidator } from '../validators/device.validator';
import { Node } from 'node-red';
import { ApiConfigManager } from '../config/api.config';
import { logger } from '../utils/logger';

/**
 * Device controller class - Migrated to routing-controllers
 *
 * Provides device management endpoints:
 * - List devices with pagination
 * - Get device by ID
 * - Create new device
 * - Update existing device
 * - Delete device
 */
@JsonController('/devices')
@Service()
export class DeviceController {
    constructor(
        @Inject() private deviceService: DeviceService,
        @Inject() private deviceValidator: DeviceValidator,
        @Inject('node') private node: Node,
        @Inject('configManager') private configManager: ApiConfigManager
    ) {
        logger.info(this.node, 'DeviceController initialized with routing-controllers');
    }




    /**
     * List devices with pagination
     * GET /api/v2/devices
     */
    @Get('/')
    @Authorized()
    async listDevices(@QueryParams() query: any): Promise<any> {
        logger.debug(this.node, 'List devices request', { query });

        // Default pagination
        const page = query.page || 1;
        const limit = Math.min(query.limit || 10, 100); // Max 100 items per page
        const offset = (page - 1) * limit;

        try {
            const result = await this.deviceService.list({ page, limit, offset });

            logger.info(this.node, 'Devices retrieved successfully', {
                count: result.data?.length || 0,
                page,
                limit
            });

            return result;
        } catch (error) {
            logger.error(this.node, 'Failed to list devices', { error: (error as Error).message });
            throw new Error('Failed to retrieve devices');
        }
    }

    /**
     * Get device by ID
     * GET /api/v2/devices/:id
     */
    @Get('/:id')
    @Authorized()
    async getDevice(@Param('id') id: string): Promise<any> {
        logger.debug(this.node, 'Get device request', { deviceId: id });

        if (!id || typeof id !== 'string' || id.trim().length === 0) {
            throw new Error('Device ID is required and must be a valid string');
        }

        try {
            const result = await this.deviceService.getById(id);

            if (!result) {
                throw new Error('Device not found');
            }

            logger.info(this.node, 'Device retrieved successfully', { deviceId: id });
            return result;
        } catch (error) {
            logger.error(this.node, 'Failed to get device', {
                deviceId: id,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Create new device
     * POST /api/v2/devices
     */
    @Post('/')
    @Authorized()
    async createDevice(@Body() deviceData: any): Promise<any> {
        logger.debug(this.node, 'Create device request', { deviceData });

        try {
            // Validate device data
            const validatedData = await this.deviceValidator.validateCreate(deviceData);

            // Create device
            const result = await this.deviceService.create(validatedData);

            logger.info(this.node, 'Device created successfully', {
                deviceId: (result as any).id || (result as any)._id || 'unknown',
                name: (result as any).name || 'unknown'
            });

            return result;
        } catch (error) {
            logger.error(this.node, 'Failed to create device', {
                error: (error as Error).message,
                deviceData
            });
            throw error;
        }
    }

    /**
     * Update device
     * PUT /api/v2/devices/:id
     */
    @Put('/:id')
    @Authorized()
    async updateDevice(@Param('id') id: string, @Body() deviceData: any): Promise<any> {
        logger.debug(this.node, 'Update device request', { deviceId: id, deviceData });

        if (!id || typeof id !== 'string' || id.trim().length === 0) {
            throw new Error('Device ID is required and must be a valid string');
        }

        try {
            // Validate device data
            const validatedData = await this.deviceValidator.validateUpdate(deviceData);

            // Update device
            const result = await this.deviceService.update(id, validatedData);

            logger.info(this.node, 'Device updated successfully', {
                deviceId: id,
                updatedFields: Object.keys(validatedData)
            });

            return result;
        } catch (error) {
            logger.error(this.node, 'Failed to update device', {
                deviceId: id,
                error: (error as Error).message,
                deviceData
            });
            throw error;
        }
    }

    /**
     * Delete device
     * DELETE /api/v2/devices/:id
     */
    @Delete('/:id')
    @Authorized()
    async deleteDevice(@Param('id') id: string): Promise<{ message: string }> {
        logger.debug(this.node, 'Delete device request', { deviceId: id });

        if (!id || typeof id !== 'string' || id.trim().length === 0) {
            throw new Error('Device ID is required and must be a valid string');
        }

        try {
            // Delete device
            await this.deviceService.delete(id);

            logger.info(this.node, 'Device deleted successfully', { deviceId: id });

            return { message: 'Device deleted successfully' };
        } catch (error) {
            logger.error(this.node, 'Failed to delete device', {
                deviceId: id,
                error: (error as Error).message
            });
            throw error;
        }
    }
}
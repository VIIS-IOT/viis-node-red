/**
 * @fileoverview IoT Notification management controller
 */

import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, QueryParams, Body, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { NotificationService } from '../services/notification.service';
import {
    IotNotificationQueryDto,
    CreateIotNotificationDto,
    UpdateIotNotificationDto
} from '../dto/iot-notification.dto';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { NODE_TOKEN } from '../container/container.setup';

/**
 * IoT Notification management controller class
 * 
 * This controller provides full CRUD operations for IoT notification:
 * - Uses routing-controllers decorators with automatic validation
 * - Implements comprehensive error handling and logging
 * - Supports dynamic filtering and pagination
 * - Token-based authentication with @Authorized() decorator
 */
@JsonController('/web-notification')
@Service()
export class IotNotificationController {
    constructor(
        @Inject() private notificationService: NotificationService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        logger.info(this.node, 'IotNotificationController initialized');
    }

    /**
     * Get all IoT notification with filtering and pagination
     * GET /api/v2/notification
     */
    @Get('/')
    @Authorized()
    async getAllNotifications(
        @QueryParams() queryParams: IotNotificationQueryDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get all IoT notification request', {
            requestedBy: user?.user_id,
            filters: queryParams
        });

        try {
            const result = await this.notificationService.getAllNotifications(queryParams, user?.user_id);

            logger.info(this.node, 'IoT notification retrieved successfully', {
                requestedBy: user?.user_id,
                total: result.total,
                returned: result.data.length,
                page: result.page,
                size: result.size
            });

            return result;
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving IoT notification:', error);
            throw error;
        }
    }

    /**
     * Get a specific IoT notification by name
     * GET /api/v2/notification/:name
     */
    @Get('/:name')
    @Authorized()
    async getNotification(
        @Param('name') name: string,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get IoT notification request', {
            requestedBy: user?.user_id,
            notificationName: name
        });

        try {
            const notification = await this.notificationService.getNotificationByName(name, user?.user_id);

            logger.info(this.node, 'IoT notification retrieved successfully', {
                requestedBy: user?.user_id,
                notificationName: name
            });

            return notification;
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving IoT notification:', error);
            throw error;
        }
    }

    /**
     * Create a new IoT notification
     * POST /api/v2/notification
     */
    @Post('/')
    @Authorized()
    async createNotification(
        @Body() notificationData: CreateIotNotificationDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Create IoT notification request', {
            requestedBy: user?.user_id,
            notificationName: notificationData.name
        });

        try {
            const savedNotification = await this.notificationService.createNotificationFromDto(notificationData, user?.user_id);

            logger.info(this.node, 'IoT notification created successfully', {
                requestedBy: user?.user_id,
                notificationName: savedNotification.name
            });

            return savedNotification;
        } catch (error: any) {
            logger.error(this.node, 'Error creating IoT notification:', error);
            throw error;
        }
    }

    /**
     * Update an existing IoT notification
     * PUT /api/v2/notification/:name
     */
    @Put('/:name')
    @Authorized()
    async updateNotification(
        @Param('name') name: string,
        @Body() notificationData: UpdateIotNotificationDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Update IoT notification request', {
            requestedBy: user?.user_id,
            notificationName: name
        });

        try {
            const updatedNotification = await this.notificationService.updateNotification(name, notificationData, user?.user_id);

            logger.info(this.node, 'IoT notification updated successfully', {
                requestedBy: user?.user_id,
                notificationName: name
            });

            return updatedNotification;
        } catch (error: any) {
            logger.error(this.node, 'Error updating IoT notification:', error);
            throw error;
        }
    }

    /**
     * Delete an IoT notification
     * DELETE /api/v2/notification/:name
     */
    @Delete('/:name')
    @Authorized()
    async deleteNotification(
        @Param('name') name: string,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Delete IoT notification request', {
            requestedBy: user?.user_id,
            notificationName: name
        });

        try {
            const result = await this.notificationService.deleteNotification(name, user?.user_id);

            logger.info(this.node, 'IoT notification deleted successfully', {
                requestedBy: user?.user_id,
                notificationName: name
            });

            return result;
        } catch (error: any) {
            logger.error(this.node, 'Error deleting IoT notification:', error);
            throw error;
        }
    }
}

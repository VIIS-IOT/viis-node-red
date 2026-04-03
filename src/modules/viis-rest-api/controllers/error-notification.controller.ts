/**
 * @fileoverview Error Notification management controller
 */

import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, QueryParams, Body, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { ErrorNotificationApiService } from '../services/error-notification-api.service';
import {
    ErrorNotificationQueryDto,
    CreateErrorNotificationDto,
    UpdateErrorNotificationDto,
    BulkResolveDto
} from '../dto/error-notification.dto';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { NODE_TOKEN } from '../container/container.setup';

/**
 * Error Notification management controller
 * 
 * Endpoints:
 * - GET /api/v2/error-notifications - List all with filters
 * - GET /api/v2/error-notifications/stats - Get statistics
 * - GET /api/v2/error-notifications/:name - Get by name
 * - POST /api/v2/error-notifications - Create manually
 * - PUT /api/v2/error-notifications/:name - Update (e.g., mark as read)
 * - DELETE /api/v2/error-notifications/:name - Delete
 * - POST /api/v2/error-notifications/bulk-resolve - Bulk resolve
 */
@JsonController('/error-notifications')
@Service()
export class ErrorNotificationController {
    constructor(
        @Inject() private errorNotificationService: ErrorNotificationApiService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        logger.info(this.node, 'ErrorNotificationController initialized');
    }

    /**
     * Get all error notifications with filtering and pagination
     * GET /api/v2/error-notifications
     * 
     * Query params:
     * - err_code: Filter by error code
     * - severity: Filter by severity (low|medium|high|critical)
     * - type: Filter by type (info|warning|error|alert)
     * - entity: Filter by entity
     * - is_read: Filter by read status (true|false)
     * - board_id: Filter by board ID
     * - page: Page number (default: 1)
     * - size: Page size (default: 20)
     * - sortBy: Sort field (default: created_at)
     * - sortOrder: Sort order (ASC|DESC, default: DESC)
     */
    @Get('/')
    @Authorized()
    async getAllNotifications(
        @QueryParams() queryParams: ErrorNotificationQueryDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get all error notifications request', {
            requestedBy: user?.user_id,
            filters: queryParams
        });

        try {
            const result = await this.errorNotificationService.getAllNotifications(queryParams);

            logger.info(this.node, 'Error notifications retrieved successfully', {
                requestedBy: user?.user_id,
                total: result.total,
                returned: result.data.length,
                page: result.page,
                size: result.size
            });

            return result;
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving error notifications:', error);
            throw error;
        }
    }

    /**
     * Get notification statistics
     * GET /api/v2/error-notifications/stats
     */
    @Get('/stats')
    @Authorized()
    async getStatistics(
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get error notification statistics request', {
            requestedBy: user?.user_id
        });

        try {
            const stats = await this.errorNotificationService.getStatistics();

            logger.info(this.node, 'Statistics retrieved successfully', {
                requestedBy: user?.user_id,
                stats
            });

            return stats;
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving statistics:', error);
            throw error;
        }
    }

    /**
     * Get a specific error notification by name
     * GET /api/v2/error-notifications/:name
     */
    @Get('/:name')
    @Authorized()
    async getNotification(
        @Param('name') name: string,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get error notification request', {
            requestedBy: user?.user_id,
            notificationName: name
        });

        try {
            const notification = await this.errorNotificationService.getNotificationByName(name);

            logger.info(this.node, 'Error notification retrieved successfully', {
                requestedBy: user?.user_id,
                notificationName: name
            });

            return notification;
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving error notification:', error);
            throw error;
        }
    }

    /**
     * Create a new error notification manually
     * POST /api/v2/error-notifications
     */
    @Post('/')
    @Authorized()
    async createNotification(
        @Body() notificationData: CreateErrorNotificationDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Create error notification request', {
            requestedBy: user?.user_id,
            errCode: notificationData.err_code,
            entity: notificationData.entity
        });

        try {
            const savedNotification = await this.errorNotificationService.createNotification(notificationData);

            logger.info(this.node, 'Error notification created successfully', {
                requestedBy: user?.user_id,
                notificationName: savedNotification.name
            });

            return savedNotification;
        } catch (error: any) {
            logger.error(this.node, 'Error creating error notification:', error);
            throw error;
        }
    }

    /**
     * Update an existing error notification
     * PUT /api/v2/error-notifications/:name
     * 
     * Common use case: Mark as read
     * Body: { "is_read": true }
     */
    @Put('/:name')
    @Authorized()
    async updateNotification(
        @Param('name') name: string,
        @Body() notificationData: UpdateErrorNotificationDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Update error notification request', {
            requestedBy: user?.user_id,
            notificationName: name,
            updates: notificationData
        });

        try {
            const updatedNotification = await this.errorNotificationService.updateNotification(name, notificationData);

            logger.info(this.node, 'Error notification updated successfully', {
                requestedBy: user?.user_id,
                notificationName: name
            });

            return updatedNotification;
        } catch (error: any) {
            logger.error(this.node, 'Error updating error notification:', error);
            throw error;
        }
    }

    /**
     * Delete an error notification
     * DELETE /api/v2/error-notifications/:name
     */
    @Delete('/:name')
    @Authorized()
    async deleteNotification(
        @Param('name') name: string,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Delete error notification request', {
            requestedBy: user?.user_id,
            notificationName: name
        });

        try {
            const result = await this.errorNotificationService.deleteNotification(name);

            logger.info(this.node, 'Error notification deleted successfully', {
                requestedBy: user?.user_id,
                notificationName: name
            });

            return result;
        } catch (error: any) {
            logger.error(this.node, 'Error deleting error notification:', error);
            throw error;
        }
    }

    /**
     * Bulk resolve notifications
     * POST /api/v2/error-notifications/bulk-resolve
     * 
     * Body:
     * {
     *   "err_code": "ERR_FAN_OVERRUN",  // optional
     *   "entity": "device_001",          // optional
     *   "board_id": "board1"             // optional
     * }
     */
    @Post('/bulk-resolve')
    @Authorized()
    async bulkResolve(
        @Body() filters: BulkResolveDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Bulk resolve error notifications request', {
            requestedBy: user?.user_id,
            filters
        });

        try {
            const result = await this.errorNotificationService.bulkResolve(filters);

            logger.info(this.node, 'Bulk resolve completed successfully', {
                requestedBy: user?.user_id,
                resolved: result.resolved
            });

            return result;
        } catch (error: any) {
            logger.error(this.node, 'Error bulk resolving notifications:', error);
            throw error;
        }
    }
}

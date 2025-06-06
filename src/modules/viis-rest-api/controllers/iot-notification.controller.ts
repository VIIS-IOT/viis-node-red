/**
 * @fileoverview IoT Notification management controller
 */

import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, QueryParams, Body, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { DatabaseService } from '../services/database.service';
import {
    IotNotificationQueryDto,
    CreateIotNotificationDto,
    UpdateIotNotificationDto
} from '../dto/iot-notification.dto';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { NODE_TOKEN } from '../container/container.setup';
import { applyQueryFilters, FilterTuple } from '../utils/query-filters.util';

/**
 * IoT Notification management controller class
 * 
 * This controller provides full CRUD operations for IoT notifications:
 * - Uses routing-controllers decorators with automatic validation
 * - Implements comprehensive error handling and logging
 * - Supports dynamic filtering and pagination
 * - Token-based authentication with @Authorized() decorator
 */
@JsonController('/iot-notifications')
@Service()
export class IotNotificationController {
    constructor(
        @Inject() private databaseService: DatabaseService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        logger.info(this.node, 'IotNotificationController initialized');
    }

    /**
     * Get all IoT notifications with filtering and pagination
     * GET /api/v2/iot-notifications
     */
    @Get('/')
    @Authorized()
    async getAllNotifications(
        @QueryParams() queryParams: IotNotificationQueryDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get all IoT notifications request', {
            requestedBy: user?.user_id,
            filters: queryParams
        });

        try {
            const page = queryParams.page || 1;
            const size = Math.min(queryParams.size || 10, 100);
            const skip = (page - 1) * size;

            const notificationRepo = this.databaseService.getNotificationRepository();
            let qb = notificationRepo.createQueryBuilder('notification')
                .leftJoinAndSelect('notification.customer', 'customer')
                .leftJoinAndSelect('notification.customerUser', 'customerUser');

            // Apply dynamic filters if provided
            if (queryParams.filters) {
                try {
                    const parsedFilters: FilterTuple[] = JSON.parse(queryParams.filters);
                    qb = applyQueryFilters(qb, parsedFilters, 'notification');
                } catch (parseError) {
                    logger.error(this.node, 'Failed to parse filters:', { filters: queryParams.filters, error: parseError });
                    throw new Error('Invalid filters format');
                }
            }

            // Apply search filter
            if (queryParams.search) {
                qb.andWhere(
                    '(notification.message ILIKE :search OR notification.entity ILIKE :search OR notification.entity_label ILIKE :search)',
                    { search: `%${queryParams.search}%` }
                );
            }

            // Apply specific filters
            if (queryParams.customer_user) {
                qb.andWhere('notification.customer_user = :customer_user', { customer_user: queryParams.customer_user });
            }

            if (queryParams.customer_id) {
                qb.andWhere('notification.customer_id = :customer_id', { customer_id: queryParams.customer_id });
            }

            if (queryParams.type) {
                qb.andWhere('notification.type = :type', { type: queryParams.type });
            }

            if (queryParams.severity) {
                qb.andWhere('notification.severity = :severity', { severity: queryParams.severity });
            }

            if (queryParams.is_read !== undefined) {
                qb.andWhere('notification.is_read = :is_read', { is_read: queryParams.is_read ? 1 : 0 });
            }

            if (queryParams.is_sent !== undefined) {
                qb.andWhere('notification.is_sent = :is_sent', { is_sent: queryParams.is_sent ? 1 : 0 });
            }

            // Apply ordering
            if (queryParams.order_by) {
                const [field, direction] = queryParams.order_by.split(' ');
                qb.orderBy(`notification.${field}`, direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC');
            } else {
                qb.orderBy('notification.created_at', 'DESC');
            }

            // Get total count
            const total = await qb.getCount();

            // Apply pagination
            const data = await qb.skip(skip).take(size).getMany();

            // Transform data to plain objects to avoid serialization issues
            const transformedData = data.map(notification => ({
                name: notification.name,
                customer_user: notification.customer_user,
                message: notification.message,
                created_at: notification.created_at,
                entity: notification.entity,
                type: notification.type,
                is_read: notification.is_read,
                is_sent: notification.is_sent,
                customer_id: notification.customer_id,
                err_code: notification.err_code,
                entity_label: notification.entity_label,
                severity: notification.severity,
                customer: notification.customer ? {
                    name: notification.customer.name,
                    customerName: notification.customer.customerName,
                    email: notification.customer.email
                } : null,
                customerUser: notification.customerUser ? {
                    name: notification.customerUser.name,
                    user_name: notification.customerUser.user_name,
                    email: notification.customerUser.email,
                    full_name: notification.customerUser.full_name
                } : null
            }));

            logger.info(this.node, 'IoT notifications retrieved successfully', {
                requestedBy: user?.user_id,
                total,
                returned: transformedData.length,
                page,
                size
            });

            return {
                data: transformedData,
                page,
                size,
                total,
                totalPages: Math.ceil(total / size)
            };
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving IoT notifications:', error);
            throw error;
        }
    }

    /**
     * Get a specific IoT notification by name
     * GET /api/v2/iot-notifications/:name
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
            const notificationRepo = this.databaseService.getNotificationRepository();
            const notification = await notificationRepo.findOne({
                where: { name: name },
                relations: ['customer', 'customerUser']
            });

            if (!notification) {
                logger.warn(this.node, 'IoT notification not found', { name: name });
                throw new Error('IoT notification not found');
            }

            logger.info(this.node, 'IoT notification retrieved successfully', {
                requestedBy: user?.user_id,
                notificationName: name
            });

            // Transform to plain object to avoid serialization issues
            return {
                name: notification.name,
                customer_user: notification.customer_user,
                message: notification.message,
                created_at: notification.created_at,
                entity: notification.entity,
                type: notification.type,
                is_read: notification.is_read,
                is_sent: notification.is_sent,
                customer_id: notification.customer_id,
                err_code: notification.err_code,
                entity_label: notification.entity_label,
                severity: notification.severity,
                customer: notification.customer ? {
                    name: notification.customer.name,
                    customerName: notification.customer.customerName,
                    email: notification.customer.email
                } : null,
                customerUser: notification.customerUser ? {
                    name: notification.customerUser.name,
                    user_name: notification.customerUser.user_name,
                    email: notification.customerUser.email,
                    full_name: notification.customerUser.full_name
                } : null
            };
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving IoT notification:', error);
            throw error;
        }
    }

    /**
     * Create a new IoT notification
     * POST /api/v2/iot-notifications
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
            const notificationRepo = this.databaseService.getNotificationRepository();

            // Check if notification already exists
            const existingNotification = await notificationRepo.findOne({
                where: { name: notificationData.name }
            });

            if (existingNotification) {
                logger.warn(this.node, 'IoT notification already exists', { name: notificationData.name });
                throw new Error('IoT notification with this name already exists');
            }

            // Create new notification
            const newNotification = notificationRepo.create({
                ...notificationData,
                created_at: new Date()
            });

            const savedNotification = await notificationRepo.save(newNotification);

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
     * PUT /api/v2/iot-notifications/:name
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
            const notificationRepo = this.databaseService.getNotificationRepository();

            // Check if notification exists
            const existingNotification = await notificationRepo.findOne({
                where: { name: name }
            });

            if (!existingNotification) {
                logger.warn(this.node, 'IoT notification not found for update', { name: name });
                throw new Error('IoT notification not found');
            }

            // Update notification
            await notificationRepo.update({ name: name }, notificationData);

            // Fetch updated notification
            const updatedNotification = await notificationRepo.findOne({
                where: { name: name },
                relations: ['customer', 'customerUser']
            });

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
     * DELETE /api/v2/iot-notifications/:name
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
            const notificationRepo = this.databaseService.getNotificationRepository();

            // Check if notification exists
            const existingNotification = await notificationRepo.findOne({
                where: { name: name }
            });

            if (!existingNotification) {
                logger.warn(this.node, 'IoT notification not found for deletion', { name: name });
                throw new Error('IoT notification not found');
            }

            // Delete notification
            await notificationRepo.delete({ name: name });

            logger.info(this.node, 'IoT notification deleted successfully', {
                requestedBy: user?.user_id,
                notificationName: name
            });

            return { message: 'IoT notification deleted successfully' };
        } catch (error: any) {
            logger.error(this.node, 'Error deleting IoT notification:', error);
            throw error;
        }
    }
}

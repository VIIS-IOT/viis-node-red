"use strict";
/**
 * @fileoverview IoT Notification management controller
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
exports.IotNotificationController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const database_service_1 = require("../services/database.service");
const iot_notification_dto_1 = require("../dto/iot-notification.dto");
const logger_1 = require("../utils/logger");
const container_setup_1 = require("../container/container.setup");
const query_filters_util_1 = require("../utils/query-filters.util");
/**
 * IoT Notification management controller class
 *
 * This controller provides full CRUD operations for IoT notifications:
 * - Uses routing-controllers decorators with automatic validation
 * - Implements comprehensive error handling and logging
 * - Supports dynamic filtering and pagination
 * - Token-based authentication with @Authorized() decorator
 */
let IotNotificationController = class IotNotificationController {
    constructor(databaseService, node) {
        this.databaseService = databaseService;
        this.node = node;
        logger_1.logger.info(this.node, 'IotNotificationController initialized');
    }
    /**
     * Get all IoT notifications with filtering and pagination
     * GET /api/v2/iot-notifications
     */
    async getAllNotifications(queryParams, user) {
        logger_1.logger.info(this.node, 'Get all IoT notifications request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
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
                    const parsedFilters = JSON.parse(queryParams.filters);
                    qb = (0, query_filters_util_1.applyQueryFilters)(qb, parsedFilters, 'notification');
                }
                catch (parseError) {
                    logger_1.logger.error(this.node, 'Failed to parse filters:', { filters: queryParams.filters, error: parseError });
                    throw new Error('Invalid filters format');
                }
            }
            // Apply search filter
            if (queryParams.search) {
                qb.andWhere('(notification.message ILIKE :search OR notification.entity ILIKE :search OR notification.entity_label ILIKE :search)', { search: `%${queryParams.search}%` });
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
                qb.orderBy(`notification.${field}`, (direction === null || direction === void 0 ? void 0 : direction.toUpperCase()) === 'DESC' ? 'DESC' : 'ASC');
            }
            else {
                qb.orderBy('notification.created_at', 'DESC');
            }
            // Get total count
            const total = await qb.getCount();
            // Apply pagination
            const data = await qb.skip(skip).take(size).getMany();
            logger_1.logger.info(this.node, 'IoT notifications retrieved successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                total,
                returned: data.length,
                page,
                size
            });
            return {
                data,
                page,
                size,
                total,
                totalPages: Math.ceil(total / size)
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving IoT notifications:', error);
            throw error;
        }
    }
    /**
     * Get a specific IoT notification by name
     * GET /api/v2/iot-notifications/:name
     */
    async getNotification(name, user) {
        logger_1.logger.info(this.node, 'Get IoT notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: name
        });
        try {
            const notificationRepo = this.databaseService.getNotificationRepository();
            const notification = await notificationRepo.findOne({
                where: { name: name },
                relations: ['customer', 'customerUser']
            });
            if (!notification) {
                logger_1.logger.warn(this.node, 'IoT notification not found', { name: name });
                throw new Error('IoT notification not found');
            }
            logger_1.logger.info(this.node, 'IoT notification retrieved successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                notificationName: name
            });
            return notification;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving IoT notification:', error);
            throw error;
        }
    }
    /**
     * Create a new IoT notification
     * POST /api/v2/iot-notifications
     */
    async createNotification(notificationData, user) {
        logger_1.logger.info(this.node, 'Create IoT notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: notificationData.name
        });
        try {
            const notificationRepo = this.databaseService.getNotificationRepository();
            // Check if notification already exists
            const existingNotification = await notificationRepo.findOne({
                where: { name: notificationData.name }
            });
            if (existingNotification) {
                logger_1.logger.warn(this.node, 'IoT notification already exists', { name: notificationData.name });
                throw new Error('IoT notification with this name already exists');
            }
            // Create new notification
            const newNotification = notificationRepo.create(Object.assign(Object.assign({}, notificationData), { created_at: new Date() }));
            const savedNotification = await notificationRepo.save(newNotification);
            logger_1.logger.info(this.node, 'IoT notification created successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                notificationName: savedNotification.name
            });
            return savedNotification;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error creating IoT notification:', error);
            throw error;
        }
    }
    /**
     * Update an existing IoT notification
     * PUT /api/v2/iot-notifications/:name
     */
    async updateNotification(name, notificationData, user) {
        logger_1.logger.info(this.node, 'Update IoT notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: name
        });
        try {
            const notificationRepo = this.databaseService.getNotificationRepository();
            // Check if notification exists
            const existingNotification = await notificationRepo.findOne({
                where: { name: name }
            });
            if (!existingNotification) {
                logger_1.logger.warn(this.node, 'IoT notification not found for update', { name: name });
                throw new Error('IoT notification not found');
            }
            // Update notification
            await notificationRepo.update({ name: name }, notificationData);
            // Fetch updated notification
            const updatedNotification = await notificationRepo.findOne({
                where: { name: name },
                relations: ['customer', 'customerUser']
            });
            logger_1.logger.info(this.node, 'IoT notification updated successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                notificationName: name
            });
            return updatedNotification;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error updating IoT notification:', error);
            throw error;
        }
    }
    /**
     * Delete an IoT notification
     * DELETE /api/v2/iot-notifications/:name
     */
    async deleteNotification(name, user) {
        logger_1.logger.info(this.node, 'Delete IoT notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: name
        });
        try {
            const notificationRepo = this.databaseService.getNotificationRepository();
            // Check if notification exists
            const existingNotification = await notificationRepo.findOne({
                where: { name: name }
            });
            if (!existingNotification) {
                logger_1.logger.warn(this.node, 'IoT notification not found for deletion', { name: name });
                throw new Error('IoT notification not found');
            }
            // Delete notification
            await notificationRepo.delete({ name: name });
            logger_1.logger.info(this.node, 'IoT notification deleted successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                notificationName: name
            });
            return { message: 'IoT notification deleted successfully' };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error deleting IoT notification:', error);
            throw error;
        }
    }
};
exports.IotNotificationController = IotNotificationController;
__decorate([
    (0, routing_controllers_1.Get)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.QueryParams)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [iot_notification_dto_1.IotNotificationQueryDto, Object]),
    __metadata("design:returntype", Promise)
], IotNotificationController.prototype, "getAllNotifications", null);
__decorate([
    (0, routing_controllers_1.Get)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], IotNotificationController.prototype, "getNotification", null);
__decorate([
    (0, routing_controllers_1.Post)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [iot_notification_dto_1.CreateIotNotificationDto, Object]),
    __metadata("design:returntype", Promise)
], IotNotificationController.prototype, "createNotification", null);
__decorate([
    (0, routing_controllers_1.Put)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.Body)()),
    __param(2, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, iot_notification_dto_1.UpdateIotNotificationDto, Object]),
    __metadata("design:returntype", Promise)
], IotNotificationController.prototype, "updateNotification", null);
__decorate([
    (0, routing_controllers_1.Delete)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], IotNotificationController.prototype, "deleteNotification", null);
exports.IotNotificationController = IotNotificationController = __decorate([
    (0, routing_controllers_1.JsonController)('/iot-notifications'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService, Object])
], IotNotificationController);

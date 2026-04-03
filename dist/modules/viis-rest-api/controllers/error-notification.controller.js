"use strict";
/**
 * @fileoverview Error Notification management controller
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
exports.ErrorNotificationController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const error_notification_api_service_1 = require("../services/error-notification-api.service");
const error_notification_dto_1 = require("../dto/error-notification.dto");
const logger_1 = require("../utils/logger");
const container_setup_1 = require("../container/container.setup");
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
let ErrorNotificationController = class ErrorNotificationController {
    constructor(errorNotificationService, node) {
        this.errorNotificationService = errorNotificationService;
        this.node = node;
        logger_1.logger.info(this.node, 'ErrorNotificationController initialized');
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
    async getAllNotifications(queryParams, user) {
        logger_1.logger.info(this.node, 'Get all error notifications request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            filters: queryParams
        });
        try {
            const result = await this.errorNotificationService.getAllNotifications(queryParams);
            logger_1.logger.info(this.node, 'Error notifications retrieved successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                total: result.total,
                returned: result.data.length,
                page: result.page,
                size: result.size
            });
            return result;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving error notifications:', error);
            throw error;
        }
    }
    /**
     * Get notification statistics
     * GET /api/v2/error-notifications/stats
     */
    async getStatistics(user) {
        logger_1.logger.info(this.node, 'Get error notification statistics request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id
        });
        try {
            const stats = await this.errorNotificationService.getStatistics();
            logger_1.logger.info(this.node, 'Statistics retrieved successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                stats
            });
            return stats;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving statistics:', error);
            throw error;
        }
    }
    /**
     * Get a specific error notification by name
     * GET /api/v2/error-notifications/:name
     */
    async getNotification(name, user) {
        logger_1.logger.info(this.node, 'Get error notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: name
        });
        try {
            const notification = await this.errorNotificationService.getNotificationByName(name);
            logger_1.logger.info(this.node, 'Error notification retrieved successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                notificationName: name
            });
            return notification;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving error notification:', error);
            throw error;
        }
    }
    /**
     * Create a new error notification manually
     * POST /api/v2/error-notifications
     */
    async createNotification(notificationData, user) {
        logger_1.logger.info(this.node, 'Create error notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            errCode: notificationData.err_code,
            entity: notificationData.entity
        });
        try {
            const savedNotification = await this.errorNotificationService.createNotification(notificationData);
            logger_1.logger.info(this.node, 'Error notification created successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                notificationName: savedNotification.name
            });
            return savedNotification;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error creating error notification:', error);
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
    async updateNotification(name, notificationData, user) {
        logger_1.logger.info(this.node, 'Update error notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: name,
            updates: notificationData
        });
        try {
            const updatedNotification = await this.errorNotificationService.updateNotification(name, notificationData);
            logger_1.logger.info(this.node, 'Error notification updated successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                notificationName: name
            });
            return updatedNotification;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error updating error notification:', error);
            throw error;
        }
    }
    /**
     * Delete an error notification
     * DELETE /api/v2/error-notifications/:name
     */
    async deleteNotification(name, user) {
        logger_1.logger.info(this.node, 'Delete error notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: name
        });
        try {
            const result = await this.errorNotificationService.deleteNotification(name);
            logger_1.logger.info(this.node, 'Error notification deleted successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                notificationName: name
            });
            return result;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error deleting error notification:', error);
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
    async bulkResolve(filters, user) {
        logger_1.logger.info(this.node, 'Bulk resolve error notifications request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            filters
        });
        try {
            const result = await this.errorNotificationService.bulkResolve(filters);
            logger_1.logger.info(this.node, 'Bulk resolve completed successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                resolved: result.resolved
            });
            return result;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error bulk resolving notifications:', error);
            throw error;
        }
    }
};
exports.ErrorNotificationController = ErrorNotificationController;
__decorate([
    (0, routing_controllers_1.Get)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.QueryParams)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [error_notification_dto_1.ErrorNotificationQueryDto, Object]),
    __metadata("design:returntype", Promise)
], ErrorNotificationController.prototype, "getAllNotifications", null);
__decorate([
    (0, routing_controllers_1.Get)('/stats'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ErrorNotificationController.prototype, "getStatistics", null);
__decorate([
    (0, routing_controllers_1.Get)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ErrorNotificationController.prototype, "getNotification", null);
__decorate([
    (0, routing_controllers_1.Post)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [error_notification_dto_1.CreateErrorNotificationDto, Object]),
    __metadata("design:returntype", Promise)
], ErrorNotificationController.prototype, "createNotification", null);
__decorate([
    (0, routing_controllers_1.Put)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.Body)()),
    __param(2, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, error_notification_dto_1.UpdateErrorNotificationDto, Object]),
    __metadata("design:returntype", Promise)
], ErrorNotificationController.prototype, "updateNotification", null);
__decorate([
    (0, routing_controllers_1.Delete)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ErrorNotificationController.prototype, "deleteNotification", null);
__decorate([
    (0, routing_controllers_1.Post)('/bulk-resolve'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [error_notification_dto_1.BulkResolveDto, Object]),
    __metadata("design:returntype", Promise)
], ErrorNotificationController.prototype, "bulkResolve", null);
exports.ErrorNotificationController = ErrorNotificationController = __decorate([
    (0, routing_controllers_1.JsonController)('/error-notifications'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [error_notification_api_service_1.ErrorNotificationApiService, Object])
], ErrorNotificationController);

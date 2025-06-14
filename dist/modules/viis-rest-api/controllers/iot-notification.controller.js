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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IotNotificationController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const notification_service_1 = require("../services/notification.service");
const iot_notification_dto_1 = require("../dto/iot-notification.dto");
const node_red_1 = require("node-red");
const logger_1 = require("../utils/logger");
const container_setup_1 = require("../container/container.setup");
/**
 * IoT Notification management controller class
 *
 * This controller provides full CRUD operations for IoT notification:
 * - Uses routing-controllers decorators with automatic validation
 * - Implements comprehensive error handling and logging
 * - Supports dynamic filtering and pagination
 * - Token-based authentication with @Authorized() decorator
 */
let IotNotificationController = class IotNotificationController {
    constructor(notificationService, node) {
        this.notificationService = notificationService;
        this.node = node;
        logger_1.logger.info(this.node, 'IotNotificationController initialized');
    }
    /**
     * Get all IoT notification with filtering and pagination
     * GET /api/v2/notification
     */
    async getAllNotifications(queryParams, user) {
        logger_1.logger.info(this.node, 'Get all IoT notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            filters: queryParams
        });
        try {
            const result = await this.notificationService.getAllNotifications(queryParams, user === null || user === void 0 ? void 0 : user.user_id);
            logger_1.logger.info(this.node, 'IoT notification retrieved successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                total: result.total,
                returned: result.data.length,
                page: result.page,
                size: result.size
            });
            return result;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving IoT notification:', error);
            throw error;
        }
    }
    /**
     * Get a specific IoT notification by name
     * GET /api/v2/notification/:name
     */
    async getNotification(name, user) {
        logger_1.logger.info(this.node, 'Get IoT notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: name
        });
        try {
            const notification = await this.notificationService.getNotificationByName(name, user === null || user === void 0 ? void 0 : user.user_id);
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
     * POST /api/v2/notification
     */
    async createNotification(notificationData, user) {
        logger_1.logger.info(this.node, 'Create IoT notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: notificationData.name
        });
        try {
            const savedNotification = await this.notificationService.createNotificationFromDto(notificationData, user === null || user === void 0 ? void 0 : user.user_id);
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
     * PUT /api/v2/notification/:name
     */
    async updateNotification(name, notificationData, user) {
        logger_1.logger.info(this.node, 'Update IoT notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: name
        });
        try {
            const updatedNotification = await this.notificationService.updateNotification(name, notificationData, user === null || user === void 0 ? void 0 : user.user_id);
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
     * DELETE /api/v2/notification/:name
     */
    async deleteNotification(name, user) {
        logger_1.logger.info(this.node, 'Delete IoT notification request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            notificationName: name
        });
        try {
            const result = await this.notificationService.deleteNotification(name, user === null || user === void 0 ? void 0 : user.user_id);
            logger_1.logger.info(this.node, 'IoT notification deleted successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                notificationName: name
            });
            return result;
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
    (0, routing_controllers_1.JsonController)('/web-notification'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [notification_service_1.NotificationService, typeof (_a = typeof node_red_1.Node !== "undefined" && node_red_1.Node) === "function" ? _a : Object])
], IotNotificationController);

"use strict";
/**
 * @fileoverview Service for error notification management (API layer)
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorNotificationApiService = void 0;
require("reflect-metadata");
const typedi_1 = require("typedi");
const typeorm_1 = require("typeorm");
const TabiotNotification_1 = require("../../../orm/entities/notification/TabiotNotification");
const dataSource_1 = require("../../../orm/dataSource");
const routing_controllers_1 = require("routing-controllers");
let ErrorNotificationApiService = class ErrorNotificationApiService {
    constructor(nodeContext) {
        this.nodeContext = nodeContext;
        this.notificationRepo = null;
        this.initialized = false;
        this.initializeRepository();
    }
    /**
     * Initialize notification repository
     */
    async initializeRepository() {
        try {
            const dataSource = (0, dataSource_1.createDataSource)(this.nodeContext);
            if (!dataSource.isInitialized) {
                await dataSource.initialize();
            }
            this.notificationRepo = dataSource.getRepository(TabiotNotification_1.TabiotNotification);
            this.initialized = true;
        }
        catch (error) {
            console.error('[ErrorNotificationApiService] Failed to initialize repository:', error);
            this.initialized = false;
        }
    }
    /**
     * Get all notifications with filtering and pagination
     */
    async getAllNotifications(queryParams) {
        if (!this.notificationRepo) {
            throw new routing_controllers_1.BadRequestError('Repository not initialized');
        }
        const { err_code, severity, type, entity, is_read, board_id, page = 1, size = 20, sortBy = 'created_at', sortOrder = 'DESC' } = queryParams;
        // Build where clause
        const where = {};
        if (err_code)
            where.err_code = (0, typeorm_1.Like)(`%${err_code}%`);
        if (severity)
            where.severity = severity;
        if (type)
            where.type = type;
        if (entity)
            where.entity = (0, typeorm_1.Like)(`%${entity}%`);
        if (is_read !== undefined)
            where.is_read = is_read ? 1 : 0;
        // Handle board_id filter from metadata
        const options = {
            where,
            take: size,
            skip: (page - 1) * size,
            order: {
                [sortBy]: sortOrder.toUpperCase()
            }
        };
        const [data, total] = await this.notificationRepo.findAndCount(options);
        // Filter by board_id if specified (from metadata)
        let filteredData = data;
        if (board_id) {
            filteredData = data.filter(n => {
                try {
                    const metadata = typeof n.metadata === 'string'
                        ? JSON.parse(n.metadata)
                        : n.metadata;
                    return (metadata === null || metadata === void 0 ? void 0 : metadata.board_id) === board_id;
                }
                catch (_a) {
                    return false;
                }
            });
        }
        return {
            data: filteredData,
            total,
            page,
            size,
            totalPages: Math.ceil(total / size)
        };
    }
    /**
     * Get notification by name
     */
    async getNotificationByName(name) {
        if (!this.notificationRepo) {
            throw new routing_controllers_1.BadRequestError('Repository not initialized');
        }
        const notification = await this.notificationRepo.findOne({
            where: { name }
        });
        if (!notification) {
            throw new routing_controllers_1.NotFoundError(`Notification with name "${name}" not found`);
        }
        return notification;
    }
    /**
     * Create notification manually
     */
    async createNotification(data) {
        if (!this.notificationRepo) {
            throw new routing_controllers_1.BadRequestError('Repository not initialized');
        }
        const notification = this.notificationRepo.create({
            name: `notification_${data.entity}_${data.err_code}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            err_code: data.err_code,
            message: data.message,
            severity: data.severity,
            type: data.type,
            entity: data.entity,
            entity_label: data.entity_label || data.entity,
            is_read: 0,
            metadata: JSON.stringify(data.metadata || {}),
            created_at: new Date()
        });
        return await this.notificationRepo.save(notification);
    }
    /**
     * Update notification
     */
    async updateNotification(name, data) {
        if (!this.notificationRepo) {
            throw new routing_controllers_1.BadRequestError('Repository not initialized');
        }
        const notification = await this.getNotificationByName(name);
        if (data.message !== undefined) {
            notification.message = data.message;
        }
        if (data.is_read !== undefined) {
            notification.is_read = data.is_read ? 1 : 0;
            // Update metadata with resolve info
            if (data.is_read) {
                const metadata = typeof notification.metadata === 'string'
                    ? JSON.parse(notification.metadata)
                    : notification.metadata || {};
                metadata.resolved_at = new Date().toISOString();
                metadata.resolved_by = 'manual';
                notification.metadata = JSON.stringify(metadata);
            }
        }
        if (data.metadata !== undefined) {
            const existingMetadata = typeof notification.metadata === 'string'
                ? JSON.parse(notification.metadata)
                : notification.metadata || {};
            notification.metadata = JSON.stringify(Object.assign(Object.assign({}, existingMetadata), data.metadata));
        }
        return await this.notificationRepo.save(notification);
    }
    /**
     * Delete notification
     */
    async deleteNotification(name) {
        if (!this.notificationRepo) {
            throw new routing_controllers_1.BadRequestError('Repository not initialized');
        }
        const notification = await this.getNotificationByName(name);
        await this.notificationRepo.remove(notification);
        return { message: `Notification "${name}" deleted successfully` };
    }
    /**
     * Bulk resolve notifications
     */
    async bulkResolve(filters) {
        if (!this.notificationRepo) {
            throw new routing_controllers_1.BadRequestError('Repository not initialized');
        }
        const where = { is_read: 0 };
        if (filters.err_code)
            where.err_code = filters.err_code;
        if (filters.entity)
            where.entity = (0, typeorm_1.Like)(`%${filters.entity}%`);
        const notifications = await this.notificationRepo.find({ where });
        // Filter by board_id if specified
        let toResolve = notifications;
        if (filters.board_id) {
            toResolve = notifications.filter(n => {
                try {
                    const metadata = typeof n.metadata === 'string'
                        ? JSON.parse(n.metadata)
                        : n.metadata;
                    return (metadata === null || metadata === void 0 ? void 0 : metadata.board_id) === filters.board_id;
                }
                catch (_a) {
                    return false;
                }
            });
        }
        // Update all to resolved
        const resolvedCount = toResolve.length;
        for (const notification of toResolve) {
            notification.is_read = 1;
            const metadata = typeof notification.metadata === 'string'
                ? JSON.parse(notification.metadata)
                : notification.metadata || {};
            metadata.resolved_at = new Date().toISOString();
            metadata.resolved_by = 'bulk_manual';
            notification.metadata = JSON.stringify(metadata);
        }
        if (toResolve.length > 0) {
            await this.notificationRepo.save(toResolve);
        }
        return { resolved: resolvedCount };
    }
    /**
     * Get statistics
     */
    async getStatistics() {
        if (!this.notificationRepo) {
            throw new routing_controllers_1.BadRequestError('Repository not initialized');
        }
        const [total, unread, bySeverity] = await Promise.all([
            this.notificationRepo.count(),
            this.notificationRepo.count({ where: { is_read: 0 } }),
            this.notificationRepo
                .createQueryBuilder('n')
                .select('n.severity', 'severity')
                .addSelect('COUNT(*)', 'count')
                .where('n.is_read = 0')
                .groupBy('n.severity')
                .getRawMany()
        ]);
        return {
            total,
            unread,
            resolved: total - unread,
            bySeverity: bySeverity.reduce((acc, item) => {
                acc[item.severity] = parseInt(item.count);
                return acc;
            }, {})
        };
    }
};
exports.ErrorNotificationApiService = ErrorNotificationApiService;
exports.ErrorNotificationApiService = ErrorNotificationApiService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object])
], ErrorNotificationApiService);

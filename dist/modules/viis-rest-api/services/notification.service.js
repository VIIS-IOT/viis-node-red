"use strict";
/**
 * @fileoverview Notification Service for VIIS REST API
 * Handles notification creation and MQTT publishing
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const typedi_1 = require("typedi");
const base_service_1 = require("./base.service");
const database_service_1 = require("./database.service");
const TabiotNotification_1 = require("../../../orm/entities/notification/TabiotNotification");
const client_registry_1 = __importDefault(require("../../../core/client-registry"));
const common_types_1 = require("../types/common.types");
const global_context_helper_1 = require("../../../ultils/global-context-helper");
const constants_1 = require("../constants");
const query_filters_util_1 = require("../utils/query-filters.util");
/**
 * Notification service class
 * Handles notification creation and MQTT publishing operations
 */
let NotificationService = class NotificationService extends base_service_1.BaseService {
    constructor(context, databaseService) {
        super(context, 'NotificationService');
        this.mqttClient = null;
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(this.node.context());
    }
    /**
     * Initialize the notification service
     */
    async onInitialize() {
        this.logInfo("Notification service initializing...");
        try {
            // Ensure database service is initialized
            await this.databaseService.initialize();
            // Get repository
            this.notificationRepository = this.databaseService.getNotificationRepository();
            // Initialize MQTT client
            await this.initializeMqttClient();
            this.logInfo("Notification service initialized successfully");
        }
        catch (error) {
            this.logError("Failed to initialize notification service", error);
            throw error;
        }
    }
    /**
     * Create a new notification
     */
    async createNotification(params) {
        return this.executeOperation('createNotification', async () => {
            var _a, _b;
            this.logInfo('Creating notification', {
                entity: params.entity,
                type: params.type,
                severity: params.severity
            });
            try {
                // Generate unique name for the notification
                const notificationName = this.generateNotificationName(params.entity, params.type);
                // Create notification entity
                const notification = new TabiotNotification_1.TabiotNotification();
                notification.name = notificationName;
                notification.entity = params.entity;
                notification.type = params.type;
                notification.severity = params.severity;
                notification.customer_user = params.customerUser;
                notification.customer_id = params.customerId;
                notification.message = params.message;
                notification.is_read = (_a = params.isRead) !== null && _a !== void 0 ? _a : 0;
                notification.is_sent = (_b = params.isSent) !== null && _b !== void 0 ? _b : 0;
                notification.created_at = params.createdAt || new Date();
                notification.err_code = params.errCode;
                notification.entity_label = params.entityLabel;
                // Save to database
                const savedNotification = await this.notificationRepository.save(notification);
                this.logInfo('Notification created successfully', {
                    notificationName,
                    entity: params.entity,
                    type: params.type,
                    customerUser: params.customerUser
                });
                return savedNotification;
            }
            catch (error) {
                this.logError('Failed to create notification', error, {
                    entity: params.entity,
                    type: params.type
                });
                throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to create notification: ${error.message}`, 500);
            }
        }, { entity: params.entity, type: params.type });
    }
    /**
     * Publish notification to MQTT
     */
    async publishNotificationToMqtt(params) {
        return this.executeOperation('publishNotificationToMqtt', async () => {
            this.logInfo('Publishing notification to MQTT', {
                deviceId: params.deviceId,
                notificationName: params.notification.name
            });
            try {
                if (!this.mqttClient || !this.mqttClient.isConnected()) {
                    this.logWarn('MQTT client not connected, skipping notification publish');
                    return false;
                }
                // Build MQTT topic
                const topic = params.topic || `viis/things/v2/${params.deviceId}/telemetry`;
                // Prepare notification payload
                const payload = this.prepareNotificationPayload(params.notification);
                // Publish to MQTT
                await this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
                this.logInfo('Notification published to MQTT successfully', {
                    deviceId: params.deviceId,
                    topic,
                    notificationName: params.notification.name
                });
                return true;
            }
            catch (error) {
                this.logError('Failed to publish notification to MQTT', error, {
                    deviceId: params.deviceId,
                    notificationName: params.notification.name
                });
                // Don't throw error - MQTT failures shouldn't break the main flow
                return false;
            }
        }, { deviceId: params.deviceId });
    }
    /**
     * Create notification and publish to MQTT in one operation
     */
    async createAndPublishNotification(createParams, mqttParams) {
        return this.executeOperation('createAndPublishNotification', async () => {
            // Create notification first
            const notification = await this.createNotification(createParams);
            // Publish to MQTT
            const mqttPublished = await this.publishNotificationToMqtt(Object.assign(Object.assign({}, mqttParams), { notification }));
            return { notification, mqttPublished };
        });
    }
    /**
     * Initialize MQTT client using existing core infrastructure
     */
    async initializeMqttClient() {
        try {
            const mqttConfig = this.createMqttConfig();
            this.mqttClient = await client_registry_1.default.getLocalMqttClient(mqttConfig, this.node);
            if (this.mqttClient) {
                this.logInfo('MQTT client initialized for notification service');
            }
        }
        catch (error) {
            this.logWarn('Failed to initialize MQTT client for notification service', error);
            // Don't throw - MQTT is optional for notifications
        }
    }
    /**
     * Cleanup on service shutdown — release MQTT client
     */
    async onCleanup() {
        if (this.mqttClient) {
            client_registry_1.default.releaseClient('local', this.node);
            this.mqttClient = null;
        }
    }
    /**
     * Create MQTT configuration for local EMQX broker
     */
    createMqttConfig() {
        // Use local EMQX broker configuration
        const host = this.globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_HOST, constants_1.MQTT_CONFIG.LOCAL.DEFAULT_HOST);
        const port = this.globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_PORT, constants_1.MQTT_CONFIG.LOCAL.DEFAULT_PORT);
        const username = this.globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_USERNAME, '');
        const password = this.globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_PASSWORD, '');
        return {
            broker: `mqtt://${host}:${port}`,
            clientId: `viis-notification-service-${Math.random().toString(16).substring(2, 10)}`,
            username,
            password,
            qos: constants_1.MQTT_CONFIG.LOCAL.QOS,
            keepalive: constants_1.MQTT_CONFIG.LOCAL.KEEPALIVE,
            connectTimeout: constants_1.MQTT_CONFIG.LOCAL.CONNECT_TIMEOUT,
            reconnectPeriod: constants_1.MQTT_CONFIG.LOCAL.RECONNECT_PERIOD
        };
    }
    /**
     * Generate unique name for notification
     */
    generateNotificationName(entity, type) {
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `notification_${type}_${entity}_${timestamp}_${randomSuffix}`;
    }
    /**
     * Prepare notification payload for MQTT publishing
     */
    prepareNotificationPayload(notification) {
        return {
            name: notification.name,
            entity: notification.entity,
            type: notification.type,
            severity: notification.severity,
            message: notification.message,
            customer_user: notification.customer_user,
            customer_id: notification.customer_id,
            is_read: notification.is_read,
            is_sent: notification.is_sent,
            created_at: notification.created_at,
            err_code: notification.err_code,
            entity_label: notification.entity_label,
            timestamp: Date.now()
        };
    }
    /**
     * Get all notifications with filtering and pagination
     */
    async getAllNotifications(queryParams, userId) {
        return this.executeOperation('getAllNotifications', async () => {
            this.logInfo('Getting all notifications', {
                requestedBy: userId,
                filters: queryParams
            });
            try {
                const page = queryParams.page || 1;
                const size = Math.min(queryParams.size || 10, 100);
                const skip = (page - 1) * size;
                let qb = this.notificationRepository.createQueryBuilder('notification')
                    .leftJoinAndSelect('notification.customer', 'customer')
                    .leftJoinAndSelect('notification.customerUser', 'customerUser');
                // Apply dynamic filters if provided
                if (queryParams.filters) {
                    try {
                        const parsedFilters = JSON.parse(queryParams.filters);
                        qb = (0, query_filters_util_1.applyQueryFilters)(qb, parsedFilters, 'notification');
                    }
                    catch (parseError) {
                        this.logError('Failed to parse filters', parseError, { filters: queryParams.filters });
                        throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Invalid filters format', 400);
                    }
                }
                // Apply dynamic OR filters if provided
                if (queryParams.or_filters) {
                    try {
                        const parsedOrFilters = JSON.parse(queryParams.or_filters);
                        qb = (0, query_filters_util_1.applyOrQueryFilters)(qb, parsedOrFilters, 'notification');
                    }
                    catch (parseError) {
                        this.logError('Failed to parse OR filters', parseError, { or_filters: queryParams.or_filters });
                        throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Invalid OR filters format', 400);
                    }
                }
                // Apply search filter
                if (queryParams.search) {
                    qb.andWhere('(notification.message ILIKE :search OR notification.entity ILIKE :search OR notification.entity_label ILIKE :search)', { search: `%${queryParams.search}%` });
                }
                // Apply specific filters
                this.applySpecificFilters(qb, queryParams);
                // Apply ordering
                this.applyOrdering(qb, queryParams);
                // Get total count
                const total = await qb.getCount();
                // Apply pagination
                const data = await qb.skip(skip).take(size).getMany();
                // Transform data
                const transformedData = this.transformNotificationData(data);
                this.logInfo('Notifications retrieved successfully', {
                    requestedBy: userId,
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
            }
            catch (error) {
                this.logError('Error retrieving notifications', error);
                throw error instanceof common_types_1.ApiError ? error : new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to retrieve notifications: ${error.message}`, 500);
            }
        }, { userId });
    }
    /**
     * Get a specific notification by name
     */
    async getNotificationByName(name, userId) {
        return this.executeOperation('getNotificationByName', async () => {
            this.logInfo('Getting notification by name', {
                requestedBy: userId,
                notificationName: name
            });
            try {
                const notification = await this.notificationRepository.findOne({
                    where: { name: name },
                    relations: ['customer', 'customerUser']
                });
                if (!notification) {
                    this.logWarn('Notification not found', { name: name });
                    throw new common_types_1.ApiError(common_types_1.ErrorType.NOT_FOUND_ERROR, 'IoT notification not found', 404);
                }
                this.logInfo('Notification retrieved successfully', {
                    requestedBy: userId,
                    notificationName: name
                });
                return this.transformSingleNotification(notification);
            }
            catch (error) {
                this.logError('Error retrieving notification', error);
                throw error instanceof common_types_1.ApiError ? error : new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to retrieve notification: ${error.message}`, 500);
            }
        }, { name, userId });
    }
    /**
     * Create a new notification from DTO
     */
    async createNotificationFromDto(notificationData, userId) {
        return this.executeOperation('createNotificationFromDto', async () => {
            this.logInfo('Creating notification from DTO', {
                requestedBy: userId,
                notificationName: notificationData.name
            });
            try {
                // Check if notification already exists
                const existingNotification = await this.notificationRepository.findOne({
                    where: { name: notificationData.name }
                });
                if (existingNotification) {
                    this.logWarn('Notification already exists', { name: notificationData.name });
                    throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'IoT notification with this name already exists', 409);
                }
                // Create new notification
                const newNotification = this.notificationRepository.create(Object.assign(Object.assign({}, notificationData), { created_at: new Date() }));
                const savedNotification = await this.notificationRepository.save(newNotification);
                this.logInfo('Notification created successfully', {
                    requestedBy: userId,
                    notificationName: savedNotification.name
                });
                return savedNotification;
            }
            catch (error) {
                this.logError('Error creating notification', error);
                throw error instanceof common_types_1.ApiError ? error : new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to create notification: ${error.message}`, 500);
            }
        }, { name: notificationData.name, userId });
    }
    /**
     * Update an existing notification
     */
    async updateNotification(name, notificationData, userId) {
        return this.executeOperation('updateNotification', async () => {
            this.logInfo('Updating notification', {
                requestedBy: userId,
                notificationName: name
            });
            try {
                // Check if notification exists
                const existingNotification = await this.notificationRepository.findOne({
                    where: { name: name }
                });
                if (!existingNotification) {
                    this.logWarn('Notification not found for update', { name: name });
                    throw new common_types_1.ApiError(common_types_1.ErrorType.NOT_FOUND_ERROR, 'IoT notification not found', 404);
                }
                // Update notification
                await this.notificationRepository.update({ name: name }, notificationData);
                // Fetch updated notification
                const updatedNotification = await this.notificationRepository.findOne({
                    where: { name: name },
                    relations: ['customer', 'customerUser']
                });
                this.logInfo('Notification updated successfully', {
                    requestedBy: userId,
                    notificationName: name
                });
                return updatedNotification;
            }
            catch (error) {
                this.logError('Error updating notification', error);
                throw error instanceof common_types_1.ApiError ? error : new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to update notification: ${error.message}`, 500);
            }
        }, { name, userId });
    }
    /**
     * Delete a notification
     */
    async deleteNotification(name, userId) {
        return this.executeOperation('deleteNotification', async () => {
            this.logInfo('Deleting notification', {
                requestedBy: userId,
                notificationName: name
            });
            try {
                // Check if notification exists
                const existingNotification = await this.notificationRepository.findOne({
                    where: { name: name }
                });
                if (!existingNotification) {
                    this.logWarn('Notification not found for deletion', { name: name });
                    throw new common_types_1.ApiError(common_types_1.ErrorType.NOT_FOUND_ERROR, 'IoT notification not found', 404);
                }
                // Delete notification
                await this.notificationRepository.delete({ name: name });
                this.logInfo('Notification deleted successfully', {
                    requestedBy: userId,
                    notificationName: name
                });
                return { message: 'IoT notification deleted successfully' };
            }
            catch (error) {
                this.logError('Error deleting notification', error);
                throw error instanceof common_types_1.ApiError ? error : new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to delete notification: ${error.message}`, 500);
            }
        }, { name, userId });
    }
    /**
     * Apply specific filters to query builder
     */
    applySpecificFilters(qb, queryParams) {
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
    }
    /**
     * Apply ordering to query builder
     */
    applyOrdering(qb, queryParams) {
        if (queryParams.order_by) {
            const [field, direction] = queryParams.order_by.split(' ');
            qb.orderBy(`notification.${field}`, (direction === null || direction === void 0 ? void 0 : direction.toUpperCase()) === 'DESC' ? 'DESC' : 'ASC');
        }
        else {
            qb.orderBy('notification.created_at', 'DESC');
        }
    }
    /**
     * Transform notification data to plain objects
     */
    transformNotificationData(notifications) {
        return notifications.map(notification => this.transformSingleNotification(notification));
    }
    /**
     * Transform single notification to plain object
     */
    transformSingleNotification(notification) {
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
    }
    /**
     * Health check for notification service
     */
    async onHealthCheck() {
        var _a;
        const repositoryConnected = !!this.notificationRepository;
        const mqttConnected = ((_a = this.mqttClient) === null || _a === void 0 ? void 0 : _a.isConnected()) || false;
        return {
            repositoryConnected,
            mqttConnected,
            status: repositoryConnected ? (mqttConnected ? 'healthy' : 'degraded') : 'unhealthy'
        };
    }
};
exports.NotificationService = NotificationService;
exports.NotificationService = NotificationService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object, database_service_1.DatabaseService])
], NotificationService);

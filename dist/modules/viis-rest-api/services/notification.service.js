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
/**
 * Notification service class
 * Handles notification creation and MQTT publishing operations
 */
let NotificationService = class NotificationService extends base_service_1.BaseService {
    constructor(context, databaseService) {
        super(context, 'NotificationService');
        this.mqttClient = null;
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
     * Create MQTT configuration
     */
    createMqttConfig() {
        const host = process.env.MQTT_HOST || 'mqtt.viis.tech';
        const port = process.env.MQTT_PORT || '1883';
        const username = process.env.MQTT_USERNAME || '';
        const password = process.env.MQTT_PASSWORD || '';
        return {
            broker: `mqtt://${host}:${port}`,
            clientId: `viis-notification-service-${Math.random().toString(16).substring(2, 10)}`,
            username,
            password,
            qos: 1,
            keepalive: 60,
            connectTimeout: 30000,
            reconnectPeriod: 5000
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

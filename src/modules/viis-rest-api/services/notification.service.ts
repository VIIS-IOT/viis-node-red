/**
 * @fileoverview Notification Service for VIIS REST API
 * Handles notification creation and MQTT publishing
 */

import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { Node } from 'node-red';
import { BaseService, ServiceContext } from './base.service';
import { DatabaseService } from './database.service';
import { TabiotNotification } from '../../../orm/entities/notification/TabiotNotification';
import { MqttClientCore, MqttConfig } from '../../../core/mqtt-client';
import ClientRegistry from '../../../core/client-registry';
import { ApiError, ErrorType } from '../types/common.types';
import { logger } from '../utils/logger';
import { GlobalContextHelper } from '../../../ultils/global-context-helper';
import { ENV_KEYS, MQTT_CONFIG, DEFAULTS } from '../constants';

/**
 * Interface for notification creation parameters
 */
export interface CreateNotificationParams {
    entity: string;
    type: string;
    severity: string;
    customerUser?: string;
    customerId?: string;
    message: string;
    isRead?: number;
    isSent?: number;
    createdAt?: Date;
    errCode?: string;
    entityLabel?: string;
}

/**
 * Interface for MQTT publishing parameters
 */
export interface MqttPublishParams {
    deviceId: string;
    notification: TabiotNotification;
    topic?: string;
}

/**
 * Notification service class
 * Handles notification creation and MQTT publishing operations
 */
@Service()
export class NotificationService extends BaseService {
    private notificationRepository: Repository<TabiotNotification>;
    private mqttClient: MqttClientCore | null = null;
    private globalHelper: GlobalContextHelper;

    constructor(
        context: ServiceContext,
        databaseService: DatabaseService
    ) {
        super(context, 'NotificationService');
        this.globalHelper = new GlobalContextHelper(this.node.context());
    }

    /**
     * Initialize the notification service
     */
    protected async onInitialize(): Promise<void> {
        this.logInfo("Notification service initializing...");

        try {
            // Ensure database service is initialized
            await this.databaseService.initialize();

            // Get repository
            this.notificationRepository = this.databaseService.getNotificationRepository();

            // Initialize MQTT client
            await this.initializeMqttClient();

            this.logInfo("Notification service initialized successfully");
        } catch (error) {
            this.logError("Failed to initialize notification service", error);
            throw error;
        }
    }

    /**
     * Create a new notification
     */
    async createNotification(params: CreateNotificationParams): Promise<TabiotNotification> {
        return this.executeOperation('createNotification', async () => {
            this.logInfo('Creating notification', {
                entity: params.entity,
                type: params.type,
                severity: params.severity
            });

            try {
                // Generate unique name for the notification
                const notificationName = this.generateNotificationName(params.entity, params.type);

                // Create notification entity
                const notification = new TabiotNotification();
                notification.name = notificationName;
                notification.entity = params.entity;
                notification.type = params.type;
                notification.severity = params.severity;
                notification.customer_user = params.customerUser;
                notification.customer_id = params.customerId;
                notification.message = params.message;
                notification.is_read = params.isRead ?? 0;
                notification.is_sent = params.isSent ?? 0;
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

            } catch (error) {
                this.logError('Failed to create notification', error, {
                    entity: params.entity,
                    type: params.type
                });
                throw new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to create notification: ${(error as Error).message}`,
                    500
                );
            }
        }, { entity: params.entity, type: params.type });
    }

    /**
     * Publish notification to MQTT
     */
    async publishNotificationToMqtt(params: MqttPublishParams): Promise<boolean> {
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

            } catch (error) {
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
    async createAndPublishNotification(
        createParams: CreateNotificationParams,
        mqttParams: Omit<MqttPublishParams, 'notification'>
    ): Promise<{ notification: TabiotNotification; mqttPublished: boolean }> {
        return this.executeOperation('createAndPublishNotification', async () => {
            // Create notification first
            const notification = await this.createNotification(createParams);

            // Publish to MQTT
            const mqttPublished = await this.publishNotificationToMqtt({
                ...mqttParams,
                notification
            });

            return { notification, mqttPublished };
        });
    }

    /**
     * Initialize MQTT client using existing core infrastructure
     */
    private async initializeMqttClient(): Promise<void> {
        try {
            const mqttConfig = this.createMqttConfig();
            this.mqttClient = await ClientRegistry.getLocalMqttClient(mqttConfig, this.node);

            if (this.mqttClient) {
                this.logInfo('MQTT client initialized for notification service');
            }
        } catch (error) {
            this.logWarn('Failed to initialize MQTT client for notification service', error);
            // Don't throw - MQTT is optional for notifications
        }
    }

    /**
     * Create MQTT configuration for local EMQX broker
     */
    private createMqttConfig(): MqttConfig {
        // Use local EMQX broker configuration
        const host = this.globalHelper.getEnvVar(ENV_KEYS.EMQX_HOST, MQTT_CONFIG.LOCAL.DEFAULT_HOST);
        const port = this.globalHelper.getEnvVar(ENV_KEYS.EMQX_PORT, MQTT_CONFIG.LOCAL.DEFAULT_PORT);
        const username = this.globalHelper.getEnvVar(ENV_KEYS.EMQX_USERNAME, '');
        const password = this.globalHelper.getEnvVar(ENV_KEYS.EMQX_PASSWORD, '');

        return {
            broker: `mqtt://${host}:${port}`,
            clientId: `viis-notification-service-${Math.random().toString(16).substring(2, 10)}`,
            username,
            password,
            qos: MQTT_CONFIG.LOCAL.QOS,
            keepalive: MQTT_CONFIG.LOCAL.KEEPALIVE,
            connectTimeout: MQTT_CONFIG.LOCAL.CONNECT_TIMEOUT,
            reconnectPeriod: MQTT_CONFIG.LOCAL.RECONNECT_PERIOD
        };
    }

    /**
     * Generate unique name for notification
     */
    private generateNotificationName(entity: string, type: string): string {
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `notification_${type}_${entity}_${timestamp}_${randomSuffix}`;
    }

    /**
     * Prepare notification payload for MQTT publishing
     */
    private prepareNotificationPayload(notification: TabiotNotification): any {
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
    protected async onHealthCheck(): Promise<any> {
        const repositoryConnected = !!this.notificationRepository;
        const mqttConnected = this.mqttClient?.isConnected() || false;

        return {
            repositoryConnected,
            mqttConnected,
            status: repositoryConnected ? (mqttConnected ? 'healthy' : 'degraded') : 'unhealthy'
        };
    }
}

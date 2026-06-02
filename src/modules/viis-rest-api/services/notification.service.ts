/**
 * @fileoverview Notification Service for VIIS REST API
 * Handles notification creation and MQTT publishing
 */

import { Service } from 'typedi';
import { Repository, SelectQueryBuilder } from 'typeorm';
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
import {
    IotNotificationQueryDto,
    CreateIotNotificationDto,
    UpdateIotNotificationDto
} from '../dto/iot-notification.dto';
import { applyQueryFilters, applyOrQueryFilters, FilterTuple } from '../utils/query-filters.util';

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
 * Interface for paginated notification results
 */
export interface PaginatedNotificationResult {
    data: any[];
    page: number;
    size: number;
    total: number;
    totalPages: number;
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
     * Cleanup on service shutdown — release MQTT client
     */
    protected async onCleanup(): Promise<void> {
        if (this.mqttClient) {
            ClientRegistry.releaseClient('local', this.node);
            this.mqttClient = null;
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
     * Get all notifications with filtering and pagination
     */
    async getAllNotifications(queryParams: IotNotificationQueryDto, userId?: string): Promise<PaginatedNotificationResult> {
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
                        const parsedFilters: FilterTuple[] = JSON.parse(queryParams.filters);
                        qb = applyQueryFilters(qb, parsedFilters, 'notification');
                    } catch (parseError) {
                        this.logError('Failed to parse filters', parseError, { filters: queryParams.filters });
                        throw new ApiError(ErrorType.VALIDATION_ERROR, 'Invalid filters format', 400);
                    }
                }

                // Apply dynamic OR filters if provided
                if (queryParams.or_filters) {
                    try {
                        const parsedOrFilters: FilterTuple[] = JSON.parse(queryParams.or_filters);
                        qb = applyOrQueryFilters(qb, parsedOrFilters, 'notification');
                    } catch (parseError) {
                        this.logError('Failed to parse OR filters', parseError, { or_filters: queryParams.or_filters });
                        throw new ApiError(ErrorType.VALIDATION_ERROR, 'Invalid OR filters format', 400);
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
            } catch (error) {
                this.logError('Error retrieving notifications', error);
                throw error instanceof ApiError ? error : new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to retrieve notifications: ${(error as Error).message}`,
                    500
                );
            }
        }, { userId });
    }

    /**
     * Get a specific notification by name
     */
    async getNotificationByName(name: string, userId?: string): Promise<any> {
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
                    throw new ApiError(ErrorType.NOT_FOUND_ERROR, 'IoT notification not found', 404);
                }

                this.logInfo('Notification retrieved successfully', {
                    requestedBy: userId,
                    notificationName: name
                });

                return this.transformSingleNotification(notification);
            } catch (error) {
                this.logError('Error retrieving notification', error);
                throw error instanceof ApiError ? error : new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to retrieve notification: ${(error as Error).message}`,
                    500
                );
            }
        }, { name, userId });
    }

    /**
     * Create a new notification from DTO
     */
    async createNotificationFromDto(notificationData: CreateIotNotificationDto, userId?: string): Promise<TabiotNotification> {
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
                    throw new ApiError(ErrorType.VALIDATION_ERROR, 'IoT notification with this name already exists', 409);
                }

                // Create new notification
                const newNotification = this.notificationRepository.create({
                    ...notificationData,
                    created_at: new Date()
                });

                const savedNotification = await this.notificationRepository.save(newNotification);

                this.logInfo('Notification created successfully', {
                    requestedBy: userId,
                    notificationName: savedNotification.name
                });

                return savedNotification;
            } catch (error) {
                this.logError('Error creating notification', error);
                throw error instanceof ApiError ? error : new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to create notification: ${(error as Error).message}`,
                    500
                );
            }
        }, { name: notificationData.name, userId });
    }

    /**
     * Update an existing notification
     */
    async updateNotification(name: string, notificationData: UpdateIotNotificationDto, userId?: string): Promise<TabiotNotification> {
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
                    throw new ApiError(ErrorType.NOT_FOUND_ERROR, 'IoT notification not found', 404);
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

                return updatedNotification!;
            } catch (error) {
                this.logError('Error updating notification', error);
                throw error instanceof ApiError ? error : new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to update notification: ${(error as Error).message}`,
                    500
                );
            }
        }, { name, userId });
    }

    /**
     * Delete a notification
     */
    async deleteNotification(name: string, userId?: string): Promise<{ message: string }> {
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
                    throw new ApiError(ErrorType.NOT_FOUND_ERROR, 'IoT notification not found', 404);
                }

                // Delete notification
                await this.notificationRepository.delete({ name: name });

                this.logInfo('Notification deleted successfully', {
                    requestedBy: userId,
                    notificationName: name
                });

                return { message: 'IoT notification deleted successfully' };
            } catch (error) {
                this.logError('Error deleting notification', error);
                throw error instanceof ApiError ? error : new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to delete notification: ${(error as Error).message}`,
                    500
                );
            }
        }, { name, userId });
    }

    /**
     * Apply specific filters to query builder
     */
    private applySpecificFilters(qb: SelectQueryBuilder<TabiotNotification>, queryParams: IotNotificationQueryDto): void {
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
    private applyOrdering(qb: SelectQueryBuilder<TabiotNotification>, queryParams: IotNotificationQueryDto): void {
        if (queryParams.order_by) {
            const [field, direction] = queryParams.order_by.split(' ');
            qb.orderBy(`notification.${field}`, direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC');
        } else {
            qb.orderBy('notification.created_at', 'DESC');
        }
    }

    /**
     * Transform notification data to plain objects
     */
    private transformNotificationData(notifications: TabiotNotification[]): any[] {
        return notifications.map(notification => this.transformSingleNotification(notification));
    }

    /**
     * Transform single notification to plain object
     */
    private transformSingleNotification(notification: TabiotNotification): any {
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

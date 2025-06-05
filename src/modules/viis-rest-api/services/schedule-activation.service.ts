/**
 * @fileoverview Schedule Activation Service for VIIS REST API
 * Handles conditional logic for schedule activation in RPC commands
 */

import { Service } from 'typedi';
import { Node } from 'node-red';
import { BaseService, ServiceContext } from './base.service';
import { ScheduleLogService, CreateScheduleLogParams } from './schedule-log.service';
import { NotificationService, CreateNotificationParams } from './notification.service';
import { TabiotScheduleLog } from '../../../orm/entities/schedule/TabiotSchedule';
import { TabiotNotification } from '../../../orm/entities/notification/TabiotNotification';
import { ApiError, ErrorType } from '../types/common.types';
import { logger } from '../utils/logger';

/**
 * Interface for RPC parameters that trigger schedule activation
 */
export interface ScheduleActivationTrigger {
    COIL_AUTO_TRON: boolean;
    schedule_id: string;
}

/**
 * Interface for user context from authentication
 */
export interface UserContext {
    user_id: string;
    customer_id: string;
    first_name?: string;
    last_name?: string;
    email?: string;
}

/**
 * Interface for schedule activation parameters
 */
export interface ScheduleActivationParams {
    deviceId: string;
    scheduleId: string;
    userContext: UserContext;
    rpcParams: Record<string, any>;
}

/**
 * Interface for schedule activation result
 */
export interface ScheduleActivationResult {
    scheduleLogCreated: boolean;
    notificationCreated: boolean;
    mqttPublished: boolean;
    scheduleLog?: TabiotScheduleLog;
    notification?: TabiotNotification;
    errors: string[];
}

/**
 * Schedule Activation service class
 * Orchestrates the conditional logic for schedule activation in RPC commands
 */
@Service()
export class ScheduleActivationService extends BaseService {
    constructor(
        context: ServiceContext,
        private scheduleLogService: ScheduleLogService,
        private notificationService: NotificationService
    ) {
        super(context, 'ScheduleActivationService');
    }

    /**
     * Initialize the schedule activation service
     */
    protected async onInitialize(): Promise<void> {
        this.logInfo("Schedule activation service initializing...");

        try {
            // Initialize dependent services
            await this.scheduleLogService.initialize();
            await this.notificationService.initialize();

            this.logInfo("Schedule activation service initialized successfully");
        } catch (error) {
            this.logError("Failed to initialize schedule activation service", error);
            throw error;
        }
    }

    /**
     * Check if RPC parameters contain schedule activation trigger
     */
    isScheduleActivationTrigger(rpcParams: Record<string, any>): boolean {
        return (
            rpcParams.COIL_AUTO_TRON === true &&
            typeof rpcParams.schedule_id === 'string' &&
            rpcParams.schedule_id.trim().length > 0
        );
    }

    /**
     * Process schedule activation logic
     */
    async processScheduleActivation(params: ScheduleActivationParams): Promise<ScheduleActivationResult> {
        return this.executeOperation('processScheduleActivation', async () => {
            this.logInfo('Processing schedule activation', {
                deviceId: params.deviceId,
                scheduleId: params.scheduleId,
                userId: params.userContext.user_id
            });

            const result: ScheduleActivationResult = {
                scheduleLogCreated: false,
                notificationCreated: false,
                mqttPublished: false,
                errors: []
            };

            try {
                // Step 1: Create schedule log
                await this.createScheduleLogEntry(params, result);

                // Step 2: Create notification and publish to MQTT
                await this.createNotificationEntry(params, result);

                this.logInfo('Schedule activation processed successfully', {
                    deviceId: params.deviceId,
                    scheduleId: params.scheduleId,
                    scheduleLogCreated: result.scheduleLogCreated,
                    notificationCreated: result.notificationCreated,
                    mqttPublished: result.mqttPublished
                });

                return result;

            } catch (error) {
                const errorMessage = `Schedule activation failed: ${(error as Error).message}`;
                this.logError(errorMessage, error, {
                    deviceId: params.deviceId,
                    scheduleId: params.scheduleId
                });

                result.errors.push(errorMessage);
                return result;
            }
        }, {
            deviceId: params.deviceId,
            scheduleId: params.scheduleId
        });
    }

    /**
     * Create schedule log entry
     */
    private async createScheduleLogEntry(
        params: ScheduleActivationParams,
        result: ScheduleActivationResult
    ): Promise<void> {
        try {
            const scheduleLogParams: CreateScheduleLogParams = {
                scheduleId: params.scheduleId,
                customerUser: params.userContext.user_id,
                startTime: new Date()
            };

            result.scheduleLog = await this.scheduleLogService.createScheduleLog(scheduleLogParams);
            result.scheduleLogCreated = true;

            this.logInfo('Schedule log created successfully', {
                scheduleId: params.scheduleId,
                logName: result.scheduleLog.name
            });

        } catch (error) {
            const errorMessage = `Failed to create schedule log: ${(error as Error).message}`;
            this.logError(errorMessage, error);
            result.errors.push(errorMessage);
            // Don't throw - continue with notification creation
        }
    }

    /**
     * Create notification entry and publish to MQTT
     */
    private async createNotificationEntry(
        params: ScheduleActivationParams,
        result: ScheduleActivationResult
    ): Promise<void> {
        try {
            const notificationParams: CreateNotificationParams = {
                entity: params.scheduleId,
                type: 'device',
                severity: 'notification',
                customerUser: params.userContext.user_id,
                customerId: params.userContext.customer_id,
                message: 'Chương trình bắt đầu hoạt động',
                isRead: 0,
                isSent: 0,
                createdAt: new Date(),
                entityLabel: `Schedule ${params.scheduleId}`
            };

            const mqttParams = {
                deviceId: params.deviceId
            };

            const { notification, mqttPublished } = await this.notificationService.createAndPublishNotification(
                notificationParams,
                mqttParams
            );

            result.notification = notification;
            result.notificationCreated = true;
            result.mqttPublished = mqttPublished;

            this.logInfo('Notification created and published successfully', {
                scheduleId: params.scheduleId,
                notificationName: notification.name,
                mqttPublished
            });

        } catch (error) {
            const errorMessage = `Failed to create notification: ${(error as Error).message}`;
            this.logError(errorMessage, error);
            result.errors.push(errorMessage);
            // Don't throw - this is additional functionality
        }
    }

    /**
     * Extract schedule activation parameters from RPC params
     */
    extractScheduleActivationParams(
        deviceId: string,
        rpcParams: Record<string, any>,
        userContext: UserContext
    ): ScheduleActivationParams | null {
        if (!this.isScheduleActivationTrigger(rpcParams)) {
            return null;
        }

        return {
            deviceId,
            scheduleId: rpcParams.schedule_id,
            userContext,
            rpcParams
        };
    }

    /**
     * Validate user context for schedule activation
     */
    validateUserContext(userContext: UserContext | null): boolean {
        if (!userContext) {
            this.logWarn('No user context provided for schedule activation');
            return false;
        }

        if (!userContext.user_id || !userContext.customer_id) {
            this.logWarn('Incomplete user context for schedule activation', {
                hasUserId: !!userContext.user_id,
                hasCustomerId: !!userContext.customer_id
            });
            return false;
        }

        return true;
    }

    /**
     * Health check for schedule activation service
     */
    protected async onHealthCheck(): Promise<any> {
        const scheduleLogServiceHealthy = this.scheduleLogService.isInitialized();
        const notificationServiceHealthy = this.notificationService.isInitialized();

        return {
            scheduleLogServiceHealthy,
            notificationServiceHealthy,
            status: (scheduleLogServiceHealthy && notificationServiceHealthy) ? 'healthy' : 'degraded'
        };
    }
}

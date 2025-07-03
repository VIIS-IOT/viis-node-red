/**
 * @fileoverview Schedule Activation Service for VIIS REST API
 * Handles conditional logic for schedule activation in RPC commands
 */

import { Service } from 'typedi';
import { Node } from 'node-red';
import { Repository } from 'typeorm';
import { BaseService, ServiceContext } from './base.service';
import { ScheduleLogService, CreateScheduleLogParams } from './schedule-log.service';
import { NotificationService, CreateNotificationParams } from './notification.service';
import { DatabaseService } from './database.service';
import { ScheduleCompletionMonitorService, ActiveScheduleInfo } from './schedule-completion-monitor.service';
import { TabiotSchedule, TabiotScheduleLog } from '../../../orm/entities/schedule/TabiotSchedule';
import { TabiotNotification } from '../../../orm/entities/notification/TabiotNotification';
import { ApiError, ErrorType } from '../types/common.types';
import { logger } from '../utils/logger';

/**
 * Interface for RPC parameters that trigger schedule activation
 * COIL_AUTO_TRON accepts both boolean and numeric values (truthy check)
 */
export interface ScheduleActivationTrigger {
    COIL_AUTO_TRON: boolean | number;
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
    private scheduleRepository: Repository<TabiotSchedule>;

    constructor(
        context: ServiceContext,
        private scheduleLogService: ScheduleLogService,
        private notificationService: NotificationService,
        protected databaseService: DatabaseService,
        private scheduleCompletionMonitor: ScheduleCompletionMonitorService
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
            await this.databaseService.initialize();
            await this.scheduleCompletionMonitor.initialize();

            // Initialize repository
            this.scheduleRepository = this.databaseService.getScheduleRepository();

            this.logInfo("Schedule activation service initialized successfully");
        } catch (error) {
            this.logError("Failed to initialize schedule activation service", error);
            throw error;
        }
    }

    /**
     * Check if RPC parameters contain schedule activation trigger
     * Accepts both boolean and numeric values for COIL_AUTO_TRON (truthy check)
     */
    isScheduleActivationTrigger(rpcParams: Record<string, any>): boolean {
        return (
            !!rpcParams.COIL_AUTO_TRON &&
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
                // Step 1: Update schedule status to "running"
                await this.updateScheduleStatus(params.scheduleId, 'running');

                // Step 2: Create schedule log
                await this.createScheduleLogEntry(params, result);

                // Step 3: Create notification and publish to MQTT
                await this.createNotificationEntry(params, result);

                // Step 4: Register schedule for completion monitoring
                await this.registerScheduleForMonitoring(params, result);

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

            this.logInfo('Schedule log creation successfully', {
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

            this.logInfo('Notification creation and published successfully', {
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
     * Update schedule status in database
     */
    private async updateScheduleStatus(scheduleId: string, status: 'running' | 'stopped' | 'finished' | ''): Promise<void> {
        try {
            this.logInfo('Updating schedule status', { scheduleId, status });

            const schedule = await this.scheduleRepository.findOne({ where: { name: scheduleId } });

            if (!schedule) {
                this.logWarn('Schedule not found for status update', { scheduleId });
                return;
            }

            schedule.status = status;
            schedule.modified = new Date();

            await this.scheduleRepository.save(schedule);

            this.logInfo('Schedule status updated successfully', {
                scheduleId,
                status,
                scheduleName: schedule.name
            });

        } catch (error) {
            const errorMessage = `Failed to update schedule status: ${(error as Error).message}`;
            this.logError(errorMessage, error, { scheduleId, status });
            throw new ApiError(
                ErrorType.DATABASE_ERROR,
                errorMessage,
                500
            );
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
        //debug user context
        this.logDebug('User context for schedule activation', userContext);

        // if (!userContext.user_id || !userContext.customer_id) {
        //     this.logWarn('Incomplete user context for schedule activation', {
        //         hasUserId: !!userContext.user_id,
        //         hasCustomerId: !!userContext.customer_id
        //     });
        //     return false;
        // }

        return true;
    }

    /**
     * Register schedule for completion monitoring
     */
    private async registerScheduleForMonitoring(
        params: ScheduleActivationParams,
        result: ScheduleActivationResult
    ): Promise<void> {
        try {
            if (!result.scheduleLogCreated || !result.scheduleLog) {
                this.logWarn('Cannot register schedule for monitoring - no schedule log creation', {
                    scheduleId: params.scheduleId
                });
                return;
            }

            const activeScheduleInfo: ActiveScheduleInfo = {
                scheduleId: params.scheduleId,
                deviceId: params.deviceId,
                startTime: new Date(),
                customerUser: params.userContext.user_id,
                customerId: params.userContext.customer_id,
                lastCoilAutoTronValue: 1 // Assume it's 1 since we just activated
            };

            this.scheduleCompletionMonitor.addActiveSchedule(activeScheduleInfo);

            this.logInfo('Schedule registered for completion monitoring', {
                scheduleId: params.scheduleId,
                deviceId: params.deviceId,
                customerUser: params.userContext.user_id
            });

        } catch (error) {
            this.logError('Failed to register schedule for monitoring', error, {
                scheduleId: params.scheduleId,
                deviceId: params.deviceId
            });
            // Don't throw - this is additional functionality
        }
    }

    /**
     * Health check for schedule activation service
     */
    protected async onHealthCheck(): Promise<any> {
        const scheduleLogServiceHealthy = this.scheduleLogService.isInitialized();
        const notificationServiceHealthy = this.notificationService.isInitialized();
        const monitorServiceHealthy = this.scheduleCompletionMonitor.isInitialized();

        return {
            scheduleLogServiceHealthy,
            notificationServiceHealthy,
            monitorServiceHealthy,
            status: (scheduleLogServiceHealthy && notificationServiceHealthy && monitorServiceHealthy) ? 'healthy' : 'degraded'
        };
    }
}

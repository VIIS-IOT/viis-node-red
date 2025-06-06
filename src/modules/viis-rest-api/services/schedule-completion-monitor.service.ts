/**
 * @fileoverview Schedule Completion Monitoring Service for VIIS REST API
 * Monitors COIL_AUTO_TRON status changes to detect schedule completion
 */

import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { BaseService, ServiceContext } from './base.service';
import { NotificationService, CreateNotificationParams } from './notification.service';
import { DatabaseService } from './database.service';
import { GlobalContextHelper } from '../../../ultils/global-context-helper';
import { TabiotSchedule, TabiotScheduleLog } from '../../../orm/entities/schedule/TabiotSchedule';
import { ApiError, ErrorType } from '../types/common.types';

/**
 * Interface for active schedule tracking
 */
export interface ActiveScheduleInfo {
    scheduleId: string;
    deviceId: string;
    startTime: Date;
    customerUser: string;
    customerId: string;
    lastCoilAutoTronValue: number | boolean;
}

/**
 * Interface for schedule completion detection result
 */
export interface ScheduleCompletionResult {
    scheduleId: string;
    deviceId: string;
    completionTime: Date;
    scheduleUpdated: boolean;
    scheduleLogUpdated: boolean;
    notificationCreated: boolean;
    mqttPublished: boolean;
    errors: string[];
}

/**
 * Schedule Completion Monitoring service class
 * Monitors global context for COIL_AUTO_TRON status changes to detect schedule completion
 */
@Service()
export class ScheduleCompletionMonitorService extends BaseService {
    private scheduleRepository: Repository<TabiotSchedule>;
    private scheduleLogRepository: Repository<TabiotScheduleLog>;
    private globalHelper: GlobalContextHelper;
    private monitoringInterval: NodeJS.Timeout | null = null;
    private activeSchedules: Map<string, ActiveScheduleInfo> = new Map();
    private readonly MONITORING_INTERVAL_MS = 5000; // Check every 5 seconds

    constructor(
        context: ServiceContext,
        protected databaseService: DatabaseService,
        private notificationService: NotificationService
    ) {
        super(context, 'ScheduleCompletionMonitorService');
        this.globalHelper = new GlobalContextHelper(this.node.context());
    }

    /**
     * Initialize the schedule completion monitoring service
     */
    protected async onInitialize(): Promise<void> {
        this.logInfo("Schedule completion monitoring service initializing...");

        try {
            // Initialize dependent services
            await this.databaseService.initialize();
            await this.notificationService.initialize();

            // Initialize repositories
            this.scheduleRepository = this.databaseService.getScheduleRepository();
            this.scheduleLogRepository = this.databaseService.getScheduleLogRepository();

            // Load currently running schedules
            await this.loadRunningSchedules();

            // Start monitoring
            this.startMonitoring();

            this.logInfo("Schedule completion monitoring service initialized successfully");
        } catch (error) {
            this.logError("Failed to initialize schedule completion monitoring service", error);
            throw error;
        }
    }

    /**
     * Override cleanup method to stop monitoring
     */
    protected async onCleanup(): Promise<void> {
        this.stopMonitoring();
        await super.onCleanup();
    }

    /**
     * Start monitoring COIL_AUTO_TRON status changes
     */
    private startMonitoring(): void {
        if (this.monitoringInterval) {
            return; // Already monitoring
        }

        this.logInfo('Starting schedule completion monitoring', {
            intervalMs: this.MONITORING_INTERVAL_MS,
            activeSchedulesCount: this.activeSchedules.size
        });

        this.monitoringInterval = setInterval(async () => {
            try {
                await this.checkForScheduleCompletions();
            } catch (error) {
                this.logError('Error during schedule completion check', error);
            }
        }, this.MONITORING_INTERVAL_MS);
    }

    /**
     * Stop monitoring
     */
    private stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            this.logInfo('Schedule completion monitoring stopped');
        }
    }

    /**
     * Load currently running schedules from database
     */
    private async loadRunningSchedules(): Promise<void> {
        try {
            const runningSchedules = await this.scheduleRepository.find({
                where: { status: 'running' }
            });

            this.logInfo('Loading running schedules', { count: runningSchedules.length });

            for (const schedule of runningSchedules) {
                // Find the most recent schedule log for this schedule
                const recentLog = await this.scheduleLogRepository.findOne({
                    where: { schedule_id: schedule.name },
                    order: { creation: 'DESC' }
                });

                if (recentLog) {
                    const activeInfo: ActiveScheduleInfo = {
                        scheduleId: schedule.name,
                        deviceId: schedule.device_id || '',
                        startTime: new Date(), // Use current time as fallback
                        customerUser: recentLog.customer_user || '',
                        customerId: '', // Will be populated from user context when needed
                        lastCoilAutoTronValue: 1 // Assume it was 1 when started
                    };

                    this.activeSchedules.set(schedule.name, activeInfo);
                }
            }

            this.logInfo('Loaded running schedules for monitoring', {
                activeSchedulesCount: this.activeSchedules.size
            });

        } catch (error) {
            this.logError('Failed to load running schedules', error);
            throw error;
        }
    }

    /**
     * Check for schedule completions by monitoring COIL_AUTO_TRON status
     */
    private async checkForScheduleCompletions(): Promise<void> {
        if (this.activeSchedules.size === 0) {
            return; // No active schedules to monitor
        }

        try {
            // Get current coil register data from global context
            // This data is stored by the telemetry polling service
            const coilRegisterData: any = this.node.context().global.get('coilRegisterData') || {};
            const currentCoilAutoTron = coilRegisterData.COIL_AUTO_TRON;

            // Check each active schedule
            const scheduleEntries = Array.from(this.activeSchedules.entries());
            for (const [scheduleId, activeInfo] of scheduleEntries) {
                await this.checkScheduleCompletion(scheduleId, activeInfo, currentCoilAutoTron);
            }

        } catch (error) {
            this.logError('Error checking schedule completions', error);
        }
    }

    /**
     * Check if a specific schedule has completed
     */
    private async checkScheduleCompletion(
        scheduleId: string,
        activeInfo: ActiveScheduleInfo,
        currentCoilAutoTron: any
    ): Promise<void> {
        try {
            // Convert current value to boolean/number for comparison
            const currentValue = this.normalizeCoilValue(currentCoilAutoTron);
            const lastValue = this.normalizeCoilValue(activeInfo.lastCoilAutoTronValue);

            // Detect completion: transition from 1 (running) to 0 (stopped)
            if (lastValue === 1 && currentValue === 0) {
                this.logInfo('Schedule completion detected', {
                    scheduleId,
                    lastValue,
                    currentValue,
                    deviceId: activeInfo.deviceId
                });

                // Process schedule completion
                const completionResult = await this.processScheduleCompletion(activeInfo);

                // Remove from active schedules
                this.activeSchedules.delete(scheduleId);

                this.logInfo('Schedule completion processed', {
                    scheduleId,
                    result: completionResult
                });
            } else {
                // Update last known value
                activeInfo.lastCoilAutoTronValue = currentValue;
            }

        } catch (error) {
            this.logError('Error checking individual schedule completion', error, {
                scheduleId,
                deviceId: activeInfo.deviceId
            });
        }
    }

    /**
     * Process schedule completion
     */
    private async processScheduleCompletion(activeInfo: ActiveScheduleInfo): Promise<ScheduleCompletionResult> {
        const completionTime = new Date();
        const result: ScheduleCompletionResult = {
            scheduleId: activeInfo.scheduleId,
            deviceId: activeInfo.deviceId,
            completionTime,
            scheduleUpdated: false,
            scheduleLogUpdated: false,
            notificationCreated: false,
            mqttPublished: false,
            errors: []
        };

        try {
            // Step 1: Update schedule status to "finished"
            await this.updateScheduleStatus(activeInfo.scheduleId, 'finished');
            result.scheduleUpdated = true;

            // Step 2: Update schedule log with end time
            await this.updateScheduleLogEndTime(activeInfo.scheduleId, completionTime);
            result.scheduleLogUpdated = true;

            // Step 3: Create completion notification
            await this.createCompletionNotification(activeInfo, result);

            return result;

        } catch (error) {
            const errorMessage = `Schedule completion processing failed: ${(error as Error).message}`;
            this.logError(errorMessage, error, {
                scheduleId: activeInfo.scheduleId,
                deviceId: activeInfo.deviceId
            });
            result.errors.push(errorMessage);
            return result;
        }
    }

    /**
     * Normalize coil value to number for comparison
     */
    private normalizeCoilValue(value: any): number {
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }
        if (typeof value === 'number') {
            return value;
        }
        if (typeof value === 'string') {
            const num = parseInt(value, 10);
            return isNaN(num) ? 0 : num;
        }
        return 0;
    }

    /**
     * Update schedule status in database
     */
    private async updateScheduleStatus(scheduleId: string, status: 'running' | 'stopped' | 'finished' | ''): Promise<void> {
        const schedule = await this.scheduleRepository.findOne({ where: { name: scheduleId } });

        if (!schedule) {
            throw new Error(`Schedule not found: ${scheduleId}`);
        }

        schedule.status = status;
        schedule.modified = new Date();

        await this.scheduleRepository.save(schedule);

        this.logInfo('Schedule status updated', {
            scheduleId,
            status,
            scheduleName: schedule.name
        });
    }

    /**
     * Update schedule log with end time
     */
    private async updateScheduleLogEndTime(scheduleId: string, endTime: Date): Promise<void> {
        const scheduleLog = await this.scheduleLogRepository.findOne({
            where: { schedule_id: scheduleId },
            order: { creation: 'DESC' }
        });

        if (!scheduleLog) {
            this.logWarn('Schedule log not found for end time update', { scheduleId });
            return;
        }

        scheduleLog.end_time = this.formatTimeForDatabase(endTime);
        scheduleLog.modified = new Date();

        await this.scheduleLogRepository.save(scheduleLog);

        this.logInfo('Schedule log end time updated', {
            scheduleId,
            logName: scheduleLog.name,
            endTime: scheduleLog.end_time
        });
    }

    /**
     * Create completion notification
     */
    private async createCompletionNotification(
        activeInfo: ActiveScheduleInfo,
        result: ScheduleCompletionResult
    ): Promise<void> {
        try {
            const notificationParams: CreateNotificationParams = {
                entity: activeInfo.scheduleId,
                type: 'device',
                severity: 'notification',
                customerUser: activeInfo.customerUser,
                customerId: activeInfo.customerId,
                message: 'Chương trình đã hoàn thành',
                isRead: 0,
                isSent: 0,
                createdAt: result.completionTime,
                entityLabel: `Schedule ${activeInfo.scheduleId}`
            };

            const mqttParams = {
                deviceId: activeInfo.deviceId
            };

            const { notification, mqttPublished } = await this.notificationService.createAndPublishNotification(
                notificationParams,
                mqttParams
            );

            result.notificationCreated = true;
            result.mqttPublished = mqttPublished;

            this.logInfo('Completion notification created', {
                scheduleId: activeInfo.scheduleId,
                notificationName: notification.name,
                mqttPublished
            });

        } catch (error) {
            const errorMessage = `Failed to create completion notification: ${(error as Error).message}`;
            this.logError(errorMessage, error);
            result.errors.push(errorMessage);
        }
    }

    /**
     * Format time for database storage
     */
    private formatTimeForDatabase(date: Date): string {
        return date.toTimeString().split(' ')[0]; // Returns HH:mm:ss format
    }

    /**
     * Add a schedule to active monitoring
     */
    public addActiveSchedule(scheduleInfo: ActiveScheduleInfo): void {
        this.activeSchedules.set(scheduleInfo.scheduleId, scheduleInfo);
        this.logInfo('Schedule added to active monitoring', {
            scheduleId: scheduleInfo.scheduleId,
            deviceId: scheduleInfo.deviceId,
            activeSchedulesCount: this.activeSchedules.size
        });
    }

    /**
     * Remove a schedule from active monitoring
     */
    public removeActiveSchedule(scheduleId: string): void {
        if (this.activeSchedules.delete(scheduleId)) {
            this.logInfo('Schedule removed from active monitoring', {
                scheduleId,
                activeSchedulesCount: this.activeSchedules.size
            });
        }
    }

    /**
     * Get current active schedules
     */
    public getActiveSchedules(): Map<string, ActiveScheduleInfo> {
        return new Map(this.activeSchedules);
    }

    /**
     * Health check for schedule completion monitoring service
     */
    protected async onHealthCheck(): Promise<any> {
        const isMonitoring = this.monitoringInterval !== null;
        const activeSchedulesCount = this.activeSchedules.size;

        return {
            isMonitoring,
            activeSchedulesCount,
            monitoringIntervalMs: this.MONITORING_INTERVAL_MS,
            status: isMonitoring ? 'healthy' : 'stopped'
        };
    }
}

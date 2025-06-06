"use strict";
/**
 * @fileoverview Schedule Activation Service for VIIS REST API
 * Handles conditional logic for schedule activation in RPC commands
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
exports.ScheduleActivationService = void 0;
const typedi_1 = require("typedi");
const base_service_1 = require("./base.service");
const schedule_log_service_1 = require("./schedule-log.service");
const notification_service_1 = require("./notification.service");
const database_service_1 = require("./database.service");
const schedule_completion_monitor_service_1 = require("./schedule-completion-monitor.service");
const common_types_1 = require("../types/common.types");
/**
 * Schedule Activation service class
 * Orchestrates the conditional logic for schedule activation in RPC commands
 */
let ScheduleActivationService = class ScheduleActivationService extends base_service_1.BaseService {
    constructor(context, scheduleLogService, notificationService, databaseService, scheduleCompletionMonitor) {
        super(context, 'ScheduleActivationService');
        this.scheduleLogService = scheduleLogService;
        this.notificationService = notificationService;
        this.databaseService = databaseService;
        this.scheduleCompletionMonitor = scheduleCompletionMonitor;
    }
    /**
     * Initialize the schedule activation service
     */
    async onInitialize() {
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
        }
        catch (error) {
            this.logError("Failed to initialize schedule activation service", error);
            throw error;
        }
    }
    /**
     * Check if RPC parameters contain schedule activation trigger
     * Accepts both boolean and numeric values for COIL_AUTO_TRON (truthy check)
     */
    isScheduleActivationTrigger(rpcParams) {
        return (!!rpcParams.COIL_AUTO_TRON &&
            typeof rpcParams.schedule_id === 'string' &&
            rpcParams.schedule_id.trim().length > 0);
    }
    /**
     * Process schedule activation logic
     */
    async processScheduleActivation(params) {
        return this.executeOperation('processScheduleActivation', async () => {
            this.logInfo('Processing schedule activation', {
                deviceId: params.deviceId,
                scheduleId: params.scheduleId,
                userId: params.userContext.user_id
            });
            const result = {
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
            }
            catch (error) {
                const errorMessage = `Schedule activation failed: ${error.message}`;
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
    async createScheduleLogEntry(params, result) {
        try {
            const scheduleLogParams = {
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
        }
        catch (error) {
            const errorMessage = `Failed to create schedule log: ${error.message}`;
            this.logError(errorMessage, error);
            result.errors.push(errorMessage);
            // Don't throw - continue with notification creation
        }
    }
    /**
     * Create notification entry and publish to MQTT
     */
    async createNotificationEntry(params, result) {
        try {
            const notificationParams = {
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
            const { notification, mqttPublished } = await this.notificationService.createAndPublishNotification(notificationParams, mqttParams);
            result.notification = notification;
            result.notificationCreated = true;
            result.mqttPublished = mqttPublished;
            this.logInfo('Notification creation and published successfully', {
                scheduleId: params.scheduleId,
                notificationName: notification.name,
                mqttPublished
            });
        }
        catch (error) {
            const errorMessage = `Failed to create notification: ${error.message}`;
            this.logError(errorMessage, error);
            result.errors.push(errorMessage);
            // Don't throw - this is additional functionality
        }
    }
    /**
     * Update schedule status in database
     */
    async updateScheduleStatus(scheduleId, status) {
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
        }
        catch (error) {
            const errorMessage = `Failed to update schedule status: ${error.message}`;
            this.logError(errorMessage, error, { scheduleId, status });
            throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, errorMessage, 500);
        }
    }
    /**
     * Extract schedule activation parameters from RPC params
     */
    extractScheduleActivationParams(deviceId, rpcParams, userContext) {
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
    validateUserContext(userContext) {
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
     * Register schedule for completion monitoring
     */
    async registerScheduleForMonitoring(params, result) {
        try {
            if (!result.scheduleLogCreated || !result.scheduleLog) {
                this.logWarn('Cannot register schedule for monitoring - no schedule log creation', {
                    scheduleId: params.scheduleId
                });
                return;
            }
            const activeScheduleInfo = {
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
        }
        catch (error) {
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
    async onHealthCheck() {
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
};
exports.ScheduleActivationService = ScheduleActivationService;
exports.ScheduleActivationService = ScheduleActivationService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object, schedule_log_service_1.ScheduleLogService,
        notification_service_1.NotificationService,
        database_service_1.DatabaseService,
        schedule_completion_monitor_service_1.ScheduleCompletionMonitorService])
], ScheduleActivationService);

"use strict";
/**
 * @fileoverview Schedule Completion Monitoring Service for VIIS REST API
 * Monitors COIL_AUTO_TRON status changes to detect schedule completion
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
exports.ScheduleCompletionMonitorService = void 0;
const typedi_1 = require("typedi");
const base_service_1 = require("./base.service");
const notification_service_1 = require("./notification.service");
const database_service_1 = require("./database.service");
const global_context_helper_1 = require("../../../ultils/global-context-helper");
/**
 * Schedule Completion Monitoring service class
 * Monitors global context for COIL_AUTO_TRON status changes to detect schedule completion
 */
let ScheduleCompletionMonitorService = class ScheduleCompletionMonitorService extends base_service_1.BaseService {
    constructor(context, databaseService, notificationService) {
        super(context, 'ScheduleCompletionMonitorService');
        this.databaseService = databaseService;
        this.notificationService = notificationService;
        this.monitoringInterval = null;
        this.activeSchedules = new Map();
        this.MONITORING_INTERVAL_MS = 5000; // Check every 5 seconds
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(this.node.context());
    }
    /**
     * Initialize the schedule completion monitoring service
     */
    async onInitialize() {
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
        }
        catch (error) {
            this.logError("Failed to initialize schedule completion monitoring service", error);
            throw error;
        }
    }
    /**
     * Cleanup when service is destroyed
     */
    async onDestroy() {
        this.stopMonitoring();
        await super.onDestroy();
    }
    /**
     * Start monitoring COIL_AUTO_TRON status changes
     */
    startMonitoring() {
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
            }
            catch (error) {
                this.logError('Error during schedule completion check', error);
            }
        }, this.MONITORING_INTERVAL_MS);
    }
    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            this.logInfo('Schedule completion monitoring stopped');
        }
    }
    /**
     * Load currently running schedules from database
     */
    async loadRunningSchedules() {
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
                    const activeInfo = {
                        scheduleId: schedule.name,
                        deviceId: schedule.device_id || '',
                        startTime: recentLog.created || new Date(),
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
        }
        catch (error) {
            this.logError('Failed to load running schedules', error);
            throw error;
        }
    }
    /**
     * Check for schedule completions by monitoring COIL_AUTO_TRON status
     */
    async checkForScheduleCompletions() {
        if (this.activeSchedules.size === 0) {
            return; // No active schedules to monitor
        }
        try {
            // Get current coil register data from global context
            // This data is stored by the telemetry polling service
            const coilRegisterData = this.node.context().global.get('coilRegisterData') || {};
            const currentCoilAutoTron = coilRegisterData.COIL_AUTO_TRON;
            // Check each active schedule
            for (const [scheduleId, activeInfo] of this.activeSchedules.entries()) {
                await this.checkScheduleCompletion(scheduleId, activeInfo, currentCoilAutoTron);
            }
        }
        catch (error) {
            this.logError('Error checking schedule completions', error);
        }
    }
    /**
     * Check if a specific schedule has completed
     */
    async checkScheduleCompletion(scheduleId, activeInfo, currentCoilAutoTron) {
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
            }
            else {
                // Update last known value
                activeInfo.lastCoilAutoTronValue = currentValue;
            }
        }
        catch (error) {
            this.logError('Error checking individual schedule completion', error, {
                scheduleId,
                deviceId: activeInfo.deviceId
            });
        }
    }
    /**
     * Process schedule completion
     */
    async processScheduleCompletion(activeInfo) {
        const completionTime = new Date();
        const result = {
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
        }
        catch (error) {
            const errorMessage = `Schedule completion processing failed: ${error.message}`;
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
    normalizeCoilValue(value) {
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
    async updateScheduleStatus(scheduleId, status) {
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
    async updateScheduleLogEndTime(scheduleId, endTime) {
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
    async createCompletionNotification(activeInfo, result) {
        try {
            const notificationParams = {
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
            const { notification, mqttPublished } = await this.notificationService.createAndPublishNotification(notificationParams, mqttParams);
            result.notificationCreated = true;
            result.mqttPublished = mqttPublished;
            this.logInfo('Completion notification created', {
                scheduleId: activeInfo.scheduleId,
                notificationName: notification.name,
                mqttPublished
            });
        }
        catch (error) {
            const errorMessage = `Failed to create completion notification: ${error.message}`;
            this.logError(errorMessage, error);
            result.errors.push(errorMessage);
        }
    }
    /**
     * Format time for database storage
     */
    formatTimeForDatabase(date) {
        return date.toTimeString().split(' ')[0]; // Returns HH:mm:ss format
    }
    /**
     * Add a schedule to active monitoring
     */
    addActiveSchedule(scheduleInfo) {
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
    removeActiveSchedule(scheduleId) {
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
    getActiveSchedules() {
        return new Map(this.activeSchedules);
    }
    /**
     * Health check for schedule completion monitoring service
     */
    async onHealthCheck() {
        const isMonitoring = this.monitoringInterval !== null;
        const activeSchedulesCount = this.activeSchedules.size;
        return {
            isMonitoring,
            activeSchedulesCount,
            monitoringIntervalMs: this.MONITORING_INTERVAL_MS,
            status: isMonitoring ? 'healthy' : 'stopped'
        };
    }
};
exports.ScheduleCompletionMonitorService = ScheduleCompletionMonitorService;
exports.ScheduleCompletionMonitorService = ScheduleCompletionMonitorService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object, database_service_1.DatabaseService,
        notification_service_1.NotificationService])
], ScheduleCompletionMonitorService);

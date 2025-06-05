"use strict";
/**
 * @fileoverview Schedule Log Service for VIIS REST API
 * Handles schedule log creation and management
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
exports.ScheduleLogService = void 0;
const typedi_1 = require("typedi");
const base_service_1 = require("./base.service");
const database_service_1 = require("./database.service");
const TabiotSchedule_1 = require("../../../orm/entities/schedule/TabiotSchedule");
const common_types_1 = require("../types/common.types");
/**
 * Schedule Log service class
 * Handles schedule log creation and management operations
 */
let ScheduleLogService = class ScheduleLogService extends base_service_1.BaseService {
    constructor(context, databaseService) {
        super(context, 'ScheduleLogService');
    }
    /**
     * Initialize the schedule log service
     */
    async onInitialize() {
        this.logInfo("Schedule log service initializing...");
        try {
            // Ensure database service is initialized
            await this.databaseService.initialize();
            // Get repository
            this.scheduleLogRepository = this.databaseService.getScheduleLogRepository();
            this.logInfo("Schedule log service initialized successfully");
        }
        catch (error) {
            this.logError("Failed to initialize schedule log service", error);
            throw error;
        }
    }
    /**
     * Create a new schedule log entry
     */
    async createScheduleLog(params) {
        return this.executeOperation('createScheduleLog', async () => {
            this.logInfo('Creating schedule log entry', { scheduleId: params.scheduleId });
            try {
                // Generate unique name for the schedule log
                const logName = this.generateScheduleLogName(params.scheduleId);
                // Create schedule log entity
                const scheduleLog = new TabiotSchedule_1.TabiotScheduleLog();
                scheduleLog.name = logName;
                scheduleLog.schedule_id = params.scheduleId;
                scheduleLog.customer_user = params.customerUser;
                scheduleLog.start_time = this.formatTimeForDatabase(params.startTime || new Date());
                scheduleLog.end_time = params.endTime ? this.formatTimeForDatabase(params.endTime) : null;
                // Save to database
                const savedLog = await this.scheduleLogRepository.save(scheduleLog);
                this.logInfo('Schedule log created successfully', {
                    logName,
                    scheduleId: params.scheduleId,
                    customerUser: params.customerUser
                });
                return savedLog;
            }
            catch (error) {
                this.logError('Failed to create schedule log', error, { scheduleId: params.scheduleId });
                throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to create schedule log: ${error.message}`, 500);
            }
        }, { scheduleId: params.scheduleId });
    }
    /**
     * Update schedule log end time
     */
    async updateScheduleLogEndTime(logName, endTime) {
        return this.executeOperation('updateScheduleLogEndTime', async () => {
            this.logInfo('Updating schedule log end time', { logName });
            try {
                const scheduleLog = await this.scheduleLogRepository.findOne({
                    where: { name: logName }
                });
                if (!scheduleLog) {
                    this.logWarn('Schedule log not found for update', { logName });
                    return null;
                }
                scheduleLog.end_time = this.formatTimeForDatabase(endTime);
                const updatedLog = await this.scheduleLogRepository.save(scheduleLog);
                this.logInfo('Schedule log end time updated successfully', { logName });
                return updatedLog;
            }
            catch (error) {
                this.logError('Failed to update schedule log end time', error, { logName });
                throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to update schedule log: ${error.message}`, 500);
            }
        }, { logName });
    }
    /**
     * Get schedule logs by schedule ID
     */
    async getScheduleLogsByScheduleId(scheduleId) {
        return this.executeOperation('getScheduleLogsByScheduleId', async () => {
            try {
                const logs = await this.scheduleLogRepository.find({
                    where: { schedule_id: scheduleId },
                    order: { creation: 'DESC' }
                });
                this.logDebug('Retrieved schedule logs', {
                    scheduleId,
                    count: logs.length
                });
                return logs;
            }
            catch (error) {
                this.logError('Failed to retrieve schedule logs', error, { scheduleId });
                throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to retrieve schedule logs: ${error.message}`, 500);
            }
        }, { scheduleId });
    }
    /**
     * Generate unique name for schedule log
     */
    generateScheduleLogName(scheduleId) {
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `schedule_log_${scheduleId}_${timestamp}_${randomSuffix}`;
    }
    /**
     * Format time for database storage (MySQL time format)
     */
    formatTimeForDatabase(date) {
        return date.toISOString().slice(11, 19); // Extract HH:MM:SS from ISO string
    }
    /**
     * Health check for schedule log service
     */
    async onHealthCheck() {
        const repositoryConnected = !!this.scheduleLogRepository;
        return {
            repositoryConnected,
            status: repositoryConnected ? 'healthy' : 'degraded'
        };
    }
};
exports.ScheduleLogService = ScheduleLogService;
exports.ScheduleLogService = ScheduleLogService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object, database_service_1.DatabaseService])
], ScheduleLogService);

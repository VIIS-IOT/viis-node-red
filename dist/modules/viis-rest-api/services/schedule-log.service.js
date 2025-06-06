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
const TabiotSchedule_1 = require("../../../orm/entities/schedule/TabiotSchedule");
const common_types_1 = require("../types/common.types");
const query_filters_util_1 = require("../utils/query-filters.util");
/**
 * Schedule Log service class
 * Handles schedule log creation and management operations
 */
let ScheduleLogService = class ScheduleLogService extends base_service_1.BaseService {
    constructor(context) {
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
    async list(options) {
        return this.executeOperation('listScheduleLogs', async () => {
            this.ensureDatabaseService();
            // TODO: Implement your list logic here
            // Example:
            // const repository = this.databaseService.getScheduleLogRepository();
            // const [items, total] = await repository.findAndCount({
            //     skip: options.offset,
            //     take: options.limit
            // });
            // 
            // return {
            //     data: items,
            //     pagination: {
            //         page: options.page,
            //         limit: options.limit,
            //         total,
            //         totalPages: Math.ceil(total / options.limit)
            //     }
            // };
            return {
                data: [],
                pagination: {
                    page: options.page,
                    limit: options.limit,
                    total: 0,
                    totalPages: 0
                }
            };
        });
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
     * Get schedule logs with telemetry data
     * Main endpoint for listing schedule logs with telemetry integration
     */
    async getScheduleLogsWithTelemetry(queryParams, userId) {
        return this.executeOperation('getScheduleLogsWithTelemetry', async () => {
            var _a;
            this.logInfo('Getting schedule logs with telemetry', {
                requestedBy: userId,
                filters: queryParams
            });
            try {
                const page = queryParams.page || 1;
                const size = Math.min(queryParams.size || 100, 100);
                const skip = (page - 1) * size;
                const scheduleLogRepo = this.databaseService.getScheduleLogRepository();
                const telemetryRepo = this.databaseService.getDeviceTelemetryRepository();
                // Get schedule logs first
                let qb = scheduleLogRepo.createQueryBuilder('iot_schedule_log')
                    .leftJoinAndSelect('iot_schedule_log.schedule', 'iot_schedule')
                    .leftJoinAndSelect('iot_schedule_log.customerUser', 'customerUser');
                // Apply filters similar to the main endpoint
                if (queryParams.filters) {
                    try {
                        const parsedFilters = JSON.parse(queryParams.filters);
                        qb = (0, query_filters_util_1.applyQueryFilters)(qb, parsedFilters, 'iot_schedule_log');
                    }
                    catch (parseError) {
                        this.logError('Failed to parse filters', parseError, { filters: queryParams.filters });
                        throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Invalid filters format', 400);
                    }
                }
                // Apply time range filters
                if (queryParams.start_date) {
                    qb.andWhere('DATE(iot_schedule_log.start_time) >= :start_date', { start_date: queryParams.start_date });
                }
                if (queryParams.end_date) {
                    qb.andWhere('DATE(iot_schedule_log.end_time) <= :end_date', { end_date: queryParams.end_date });
                }
                const total = await qb.getCount();
                const scheduleLogs = await qb.skip(skip).take(size).getMany();
                this.logInfo('Schedule logs retrieved successfully', {
                    requestedBy: userId,
                    total,
                    returned: scheduleLogs.length,
                    page,
                    size
                });
                // For each schedule log, get associated telemetry data
                const enrichedData = [];
                for (const log of scheduleLogs) {
                    const enrichedLog = {
                        name: log.name,
                        start_time: log.start_time,
                        end_time: log.end_time,
                        schedule_id: log.schedule_id,
                        customer_user: log.customer_user,
                        schedule: log.schedule ? {
                            name: log.schedule.name,
                            device_id: log.schedule.device_id,
                            label: log.schedule.label,
                            action: log.schedule.action,
                            enable: log.schedule.enable
                        } : undefined,
                        telemetry: []
                    };
                    // Get telemetry data for the device within the schedule time range
                    if (((_a = log.schedule) === null || _a === void 0 ? void 0 : _a.device_id) && log.start_time && log.end_time) {
                        try {
                            const telemetryData = await telemetryRepo.createQueryBuilder('telemetry')
                                .where('telemetry.device_id = :device_id', { device_id: log.schedule.device_id })
                                .andWhere('telemetry.timestamp >= :start_time', { start_time: log.start_time })
                                .andWhere('telemetry.timestamp <= :end_time', { end_time: log.end_time })
                                .orderBy('telemetry.timestamp', 'ASC')
                                .getMany();
                            enrichedLog.telemetry = telemetryData.map(t => ({
                                device_id: t.device_id,
                                timestamp: new Date(t.timestamp), // Convert number to Date
                                data: {
                                    key_name: t.key_name,
                                    value_type: t.value_type,
                                    int_value: t.int_value,
                                    float_value: t.float_value,
                                    string_value: t.string_value,
                                    boolean_value: t.boolean_value,
                                    json_value: t.json_value
                                },
                                id: t.id,
                                key_name: t.key_name,
                                value_type: t.value_type,
                                int_value: t.int_value,
                                float_value: t.float_value,
                                string_value: t.string_value,
                                boolean_value: t.boolean_value,
                                json_value: t.json_value
                            }));
                        }
                        catch (telemetryError) {
                            this.logWarn('Failed to fetch telemetry data', {
                                device_id: log.schedule.device_id,
                                error: telemetryError
                            });
                        }
                    }
                    enrichedData.push(enrichedLog);
                }
                this.logInfo('Schedule logs with telemetry retrieved successfully', {
                    requestedBy: userId,
                    total,
                    returned: enrichedData.length,
                    page,
                    size
                });
                return {
                    data: enrichedData,
                    page,
                    size,
                    total,
                    totalPages: Math.ceil(total / size)
                };
            }
            catch (error) {
                this.logError('Error retrieving schedule logs with telemetry', error);
                if (error instanceof common_types_1.ApiError) {
                    throw error;
                }
                throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to retrieve schedule logs with telemetry: ${error.message}`, 500);
            }
        }, { userId, filters: queryParams });
    }
    /**
     * Get detailed schedule logs with comprehensive data
     * Supports filtering, pagination, and includes telemetry data, notifications, etc.
     */
    async getScheduleLogDetail(queryParams, userId) {
        return this.executeOperation('getScheduleLogDetail', async () => {
            var _a, _b;
            this.logInfo('Getting schedule log detail', {
                requestedBy: userId,
                filters: queryParams
            });
            try {
                const page = queryParams.page || 1;
                const size = Math.min(queryParams.size || 100, 100);
                const skip = (page - 1) * size;
                const scheduleLogRepo = this.databaseService.getScheduleLogRepository();
                const telemetryRepo = this.databaseService.getDeviceTelemetryRepository();
                const notificationRepo = this.databaseService.getNotificationRepository();
                // Build complex query with all necessary joins
                let qb = scheduleLogRepo.createQueryBuilder('iot_schedule_log')
                    .leftJoinAndSelect('iot_schedule_log.schedule', 'iot_schedule')
                    .leftJoinAndSelect('iot_schedule.schedulePlan', 'tabiot_schedule_plan')
                    .leftJoinAndSelect('iot_schedule_log.customerUser', 'customerUser');
                // Apply dynamic filters if provided
                if (queryParams.filters) {
                    try {
                        const parsedFilters = JSON.parse(queryParams.filters);
                        qb = (0, query_filters_util_1.applyQueryFilters)(qb, parsedFilters, 'iot_schedule_log');
                    }
                    catch (parseError) {
                        this.logError('Failed to parse filters', parseError, { filters: queryParams.filters });
                        throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Invalid filters format', 400);
                    }
                }
                // Apply ordering - support complex ordering like "tabiot_schedule_plan.label ASC"
                if (queryParams.order_by) {
                    const orderParts = queryParams.order_by.trim().split(' ');
                    const field = orderParts[0];
                    const direction = ((_a = orderParts[1]) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === 'DESC' ? 'DESC' : 'ASC';
                    // Handle complex field paths
                    if (field.includes('.')) {
                        qb.orderBy(field, direction);
                    }
                    else {
                        qb.orderBy(`iot_schedule_log.${field}`, direction);
                    }
                }
                else {
                    qb.orderBy('iot_schedule_log.creation', 'DESC');
                }
                // Get total count and data
                const total = await qb.getCount();
                const scheduleLogs = await qb.skip(skip).take(size).getMany();
                this.logInfo('Schedule logs retrieved for detail processing', {
                    requestedBy: userId,
                    total,
                    returned: scheduleLogs.length,
                    page,
                    size
                });
                // Transform data to the required format
                const scheduleData = [];
                for (const log of scheduleLogs) {
                    if (!((_b = log.schedule) === null || _b === void 0 ? void 0 : _b.schedulePlan)) {
                        continue; // Skip logs without proper schedule plan data
                    }
                    const schedulePlan = log.schedule.schedulePlan;
                    const schedule = log.schedule;
                    // Format dates and times
                    const startTimeUnix = this.formatToUnixTime(log.start_time, schedulePlan.start_date);
                    const endTimeUnix = this.formatToUnixTime(log.end_time, schedulePlan.end_date);
                    // Get notifications for this schedule/device
                    const notifications = await this.getNotificationsForSchedule(notificationRepo, schedule.device_id, log.start_time, log.end_time);
                    // Get telemetry data grouped by key
                    const dataByKey = await this.getTelemetryDataByKey(telemetryRepo, schedule.device_id, startTimeUnix, endTimeUnix);
                    const schedulePlanData = {
                        name: schedulePlan.name || '',
                        schedule_id: log.schedule_id || '',
                        label: schedulePlan.label || '',
                        device_id: schedule.device_id || '',
                        start_date: schedulePlan.start_date || '',
                        end_date: schedulePlan.end_date || '',
                        start_time: log.start_time || '',
                        end_time: log.end_time || '',
                        start_time_unix: startTimeUnix,
                        end_time_unix: endTimeUnix,
                        log_creation: this.formatDateTime(log.creation),
                        log_modified: this.formatDateTime(log.modified),
                        notifications: notifications.filter((n) => n.severity !== 'error' && n.severity !== 'warning'),
                        errors: notifications.filter((n) => n.severity === 'error'),
                        warnings: notifications.filter((n) => n.severity === 'warning'),
                        data_by_key: dataByKey
                    };
                    scheduleData.push(schedulePlanData);
                }
                const response = {
                    result: {
                        data: scheduleData,
                        pagination: {
                            totalElements: total,
                            totalPages: Math.ceil(total / size),
                            pageSize: size,
                            pageNumber: page,
                            order_by: queryParams.order_by || 'iot_schedule_log.creation DESC'
                        }
                    }
                };
                this.logInfo('Schedule log detail retrieved successfully', {
                    requestedBy: userId,
                    total,
                    returned: scheduleData.length,
                    page,
                    size
                });
                return response;
            }
            catch (error) {
                this.logError('Error retrieving schedule log detail', error);
                if (error instanceof common_types_1.ApiError) {
                    throw error;
                }
                throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Failed to retrieve schedule log detail: ${error.message}`, 500);
            }
        }, { userId, filters: queryParams });
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
     * Format time to Unix timestamp string
     */
    formatToUnixTime(time, date) {
        if (!time || !date) {
            return new Date().toISOString();
        }
        try {
            // Combine date and time
            const dateTimeString = `${date}T${time}`;
            const dateTime = new Date(dateTimeString);
            return dateTime.toISOString();
        }
        catch (error) {
            this.logWarn('Failed to format time to Unix', { time, date, error });
            return new Date().toISOString();
        }
    }
    /**
     * Format date to string format
     */
    formatDateTime(date) {
        if (!date) {
            return '';
        }
        try {
            const dateObj = typeof date === 'string' ? new Date(date) : date;
            return dateObj.toISOString().slice(0, 19).replace('T', ' ');
        }
        catch (error) {
            this.logWarn('Failed to format date time', { date, error });
            return '';
        }
    }
    /**
     * Get notifications for a specific schedule/device within time range
     */
    async getNotificationsForSchedule(notificationRepo, deviceId, startTime, endTime) {
        try {
            if (!deviceId || !startTime || !endTime) {
                return [];
            }
            const notifications = await notificationRepo.createQueryBuilder('notification')
                .where('notification.device_id = :deviceId', { deviceId })
                .andWhere('notification.created_at >= :startTime', { startTime })
                .andWhere('notification.created_at <= :endTime', { endTime })
                .orderBy('notification.created_at', 'DESC')
                .getMany();
            return notifications.map((n) => ({
                name: n.id || n.name || '',
                message: n.message || '',
                severity: n.severity || 'notification',
                created_at: this.formatDateTime(n.created_at),
                type: n.type || 'device'
            }));
        }
        catch (error) {
            this.logWarn('Failed to get notifications for schedule', { deviceId, error });
            return [];
        }
    }
    /**
     * Get telemetry data grouped by key for a device within time range
     */
    async getTelemetryDataByKey(telemetryRepo, deviceId, startTimeUnix, endTimeUnix) {
        try {
            if (!deviceId || !startTimeUnix || !endTimeUnix) {
                return {};
            }
            const telemetryData = await telemetryRepo.createQueryBuilder('telemetry')
                .where('telemetry.device_id = :deviceId', { deviceId })
                .andWhere('telemetry.timestamp >= :startTime', { startTime: new Date(startTimeUnix) })
                .andWhere('telemetry.timestamp <= :endTime', { endTime: new Date(endTimeUnix) })
                .orderBy('telemetry.timestamp', 'ASC')
                .getMany();
            // Group by key_name
            const groupedData = {};
            for (const data of telemetryData) {
                const keyName = data.key_name || 'unknown';
                if (!groupedData[keyName]) {
                    groupedData[keyName] = [];
                }
                // Determine the value based on value_type
                let value = '';
                switch (data.value_type) {
                    case 'int':
                        value = String(data.int_value || 0);
                        break;
                    case 'float':
                        value = String(data.float_value || 0);
                        break;
                    case 'string':
                        value = data.string_value || '';
                        break;
                    case 'boolean':
                        value = String(data.boolean_value || false);
                        break;
                    case 'json':
                        value = data.json_value ? JSON.stringify(data.json_value) : '{}';
                        break;
                    default:
                        value = String(data.string_value || '');
                }
                groupedData[keyName].push({
                    timestamp: new Date(data.timestamp).getTime(),
                    value: value
                });
            }
            return groupedData;
        }
        catch (error) {
            this.logWarn('Failed to get telemetry data by key', { deviceId, error });
            return {};
        }
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
    __metadata("design:paramtypes", [Object])
], ScheduleLogService);

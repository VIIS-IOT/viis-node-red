/**
 * @fileoverview Schedule Log Service for VIIS REST API
 * Handles schedule log creation and management
 */

import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { BaseService, ServiceContext } from './base.service';
import { TabiotScheduleLog } from '../../../orm/entities/schedule/TabiotSchedule';
import { ApiError, ErrorType } from '../types/common.types';
import {
    IotScheduleLogQueryDto,
    ScheduleLogDetailResponse,
    SchedulePlan,
    Notification,
    DataPoint
} from '../dto/iot-schedule-log.dto';

/**
 * Interface for main scheduleLog API response
 */
export interface ScheduleLogResponse {
    result: ScheduleLogResult;
}

export interface ScheduleLogResult {
    data: Schedule[];
    pagination: ScheduleLogPagination;
}

export interface Schedule {
    name: string;
    schedule_id: string;
    label: string;
    device_id: string;
    start_date: string;           // e.g. "2024-12-21"
    end_date: string;             // e.g. "2030-10-21"
    start_time: string;           // e.g. "15:48:00"
    end_time: string;             // e.g. "15:59:00"
    start_time_unix: string;      // e.g. "2025-06-06T15:48:00.000Z"
    end_time_unix: string;        // e.g. "2025-06-06T15:59:00.000Z"
    log_creation: string;         // e.g. "2025-06-06 15:50:08"
    log_modified: string;         // e.g. "2025-06-06 15:50:08"
    notifications: Notification[];
    errors: any[];                // always array, empty in example []
    warnings: Notification[];
    avg_device_data: { [key: string]: number } | null;
    customer_user: {
        name: string;
        user_name: string;
        email: string;
        full_name: string;
        first_name: string;
        last_name: string;
    } | null;
}

export interface ScheduleLogPagination {
    totalElements: number;  // e.g. 78711
    totalPages: number;     // e.g. 7872
    pageSize: number;       // e.g. 10
    pageNumber: number;     // e.g. 1
    order_by: string | null;
}
import { applyQueryFilters, FilterTuple } from '../utils/query-filters.util';

/**
 * Interface for schedule log creation parameters
 */
export interface CreateScheduleLogParams {
    scheduleId: string;
    customerUser?: string;
    startTime?: Date;
    endTime?: Date;
}

/**
 * Schedule Log service class
 * Handles schedule log creation and management operations
 */
@Service()
export class ScheduleLogService extends BaseService {
    private scheduleLogRepository: Repository<TabiotScheduleLog>;

    constructor(
        context: ServiceContext
    ) {
        super(context, 'ScheduleLogService');
    }

    /**
     * Initialize the schedule log service
     */
    protected async onInitialize(): Promise<void> {
        this.logInfo("Schedule log service initializing...");

        try {
            // Ensure database service is initialized
            await this.databaseService.initialize();

            // Get repository
            this.scheduleLogRepository = this.databaseService.getScheduleLogRepository();

            this.logInfo("Schedule log service initialized successfully");
        } catch (error) {
            this.logError("Failed to initialize schedule log service", error);
            throw error;
        }
    }


    async list(options: { page: number; limit: number; offset: number }): Promise<any> {
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
    async createScheduleLog(params: CreateScheduleLogParams): Promise<TabiotScheduleLog> {
        return this.executeOperation('createScheduleLog', async () => {
            this.logInfo('Creating schedule log entry', { scheduleId: params.scheduleId });

            try {
                // Generate unique name for the schedule log
                const logName = this.generateScheduleLogName(params.scheduleId);

                // Create schedule log entity
                const scheduleLog = new TabiotScheduleLog();
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

            } catch (error) {
                this.logError('Failed to create schedule log', error, { scheduleId: params.scheduleId });
                throw new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to create schedule log: ${(error as Error).message}`,
                    500
                );
            }
        }, { scheduleId: params.scheduleId });
    }

    /**
     * Update schedule log end time
     */
    async updateScheduleLogEndTime(logName: string, endTime: Date): Promise<TabiotScheduleLog | null> {
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

            } catch (error) {
                this.logError('Failed to update schedule log end time', error, { logName });
                throw new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to update schedule log: ${(error as Error).message}`,
                    500
                );
            }
        }, { logName });
    }

    /**
     * Get schedule logs by schedule ID
     */
    async getScheduleLogsByScheduleId(scheduleId: string): Promise<TabiotScheduleLog[]> {
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

            } catch (error) {
                this.logError('Failed to retrieve schedule logs', error, { scheduleId });
                throw new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to retrieve schedule logs: ${(error as Error).message}`,
                    500
                );
            }
        }, { scheduleId });
    }

    /**
     * Get schedule logs with telemetry data
     * Main endpoint for listing schedule logs with telemetry integration
     */
    async getScheduleLogsWithTelemetry(queryParams: IotScheduleLogQueryDto, userId?: string): Promise<ScheduleLogResponse> {
        return this.executeOperation('getScheduleLogsWithTelemetry', async () => {
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
                const notificationRepo = this.databaseService.getNotificationRepository();

                // Get schedule logs with all necessary joins
                let qb = scheduleLogRepo.createQueryBuilder('iot_schedule_log')
                    .leftJoinAndSelect('iot_schedule_log.schedule', 'iot_schedule')
                    .leftJoinAndSelect('iot_schedule.schedulePlan', 'tabiot_schedule_plan')
                    .leftJoinAndSelect('iot_schedule_log.customerUser', 'customerUser');

                // Apply filters similar to the main endpoint
                if (queryParams.filters) {
                    try {
                        const parsedFilters: FilterTuple[] = JSON.parse(queryParams.filters);
                        qb = applyQueryFilters(qb, parsedFilters, 'iot_schedule_log');
                    } catch (parseError) {
                        this.logError('Failed to parse filters', parseError, { filters: queryParams.filters });
                        throw new ApiError(
                            ErrorType.VALIDATION_ERROR,
                            'Invalid filters format',
                            400
                        );
                    }
                }

                // Apply time range filters based on creation date since start_time/end_time are only time fields
                if (queryParams.start_date) {
                    qb.andWhere('DATE(iot_schedule_log.creation) >= :start_date', { start_date: queryParams.start_date });
                }

                if (queryParams.end_date) {
                    qb.andWhere('DATE(iot_schedule_log.creation) <= :end_date', { end_date: queryParams.end_date });
                }
                
                // Apply time filters if provided (for time-only comparisons)
                if (queryParams.start_time) {
                    qb.andWhere('iot_schedule_log.start_time >= :start_time', { start_time: queryParams.start_time });
                }
                
                if (queryParams.end_time) {
                    qb.andWhere('iot_schedule_log.end_time <= :end_time', { end_time: queryParams.end_time });
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

                // Transform data to the required format
                const scheduleData: Schedule[] = [];

                for (const log of scheduleLogs) {
                    if (!log.schedule?.schedulePlan) {
                        continue; // Skip logs without proper schedule plan data
                    }

                    const schedulePlan = log.schedule.schedulePlan;
                    const schedule = log.schedule;

                    // Format dates and times
                    const startTimeUnix = this.formatToUnixTime(log.start_time, schedulePlan.start_date);
                    const endTimeUnix = this.formatToUnixTime(log.end_time, schedulePlan.end_date);

                    // Get notifications for this schedule/device
                    const notifications = await this.getNotificationsForSchedule(
                        notificationRepo,
                        schedule.device_id,
                        log.start_time,
                        log.end_time
                    );

                    // Calculate average device data from telemetry
                    const avgDeviceData = await this.calculateAverageDeviceData(
                        telemetryRepo,
                        schedule.device_id,
                        startTimeUnix,
                        endTimeUnix
                    );

                    const scheduleItem: Schedule = {
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
                        notifications: notifications.filter((n: Notification) => n.severity !== 'error' && n.severity !== 'warning'),
                        errors: notifications.filter((n: Notification) => n.severity === 'error'),
                        warnings: notifications.filter((n: Notification) => n.severity === 'warning'),
                        avg_device_data: avgDeviceData,
                        customer_user: log.customerUser ? {
                            name: log.customerUser.name || '',
                            user_name: log.customerUser.user_name || '',
                            email: log.customerUser.email || '',
                            full_name: log.customerUser.full_name || '',
                            first_name: log.customerUser.first_name || '',
                            last_name: log.customerUser.last_name || ''
                        } : null
                    };

                    scheduleData.push(scheduleItem);
                }

                this.logInfo('Schedule logs retrieved successfully', {
                    requestedBy: userId,
                    total,
                    returned: scheduleData.length,
                    page,
                    size
                });

                const response: ScheduleLogResponse = {
                    result: {
                        data: scheduleData,
                        pagination: {
                            totalElements: total,
                            totalPages: Math.ceil(total / size),
                            pageSize: size,
                            pageNumber: page,
                            order_by: queryParams.order_by || null
                        }
                    }
                };

                return response;
            } catch (error) {
                this.logError('Error retrieving schedule logs with telemetry', error);
                if (error instanceof ApiError) {
                    throw error;
                }
                throw new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to retrieve schedule logs with telemetry: ${(error as Error).message}`,
                    500
                );
            }
        }, { userId, filters: queryParams });
    }

    /**
     * Get detailed schedule logs with comprehensive data
     * Supports filtering, pagination, and includes telemetry data, notifications, etc.
     */
    async getScheduleLogDetail(queryParams: IotScheduleLogQueryDto, userId?: string): Promise<ScheduleLogDetailResponse> {
        return this.executeOperation('getScheduleLogDetail', async () => {
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
                        const parsedFilters: FilterTuple[] = JSON.parse(queryParams.filters);
                        qb = applyQueryFilters(qb, parsedFilters, 'iot_schedule_log');
                    } catch (parseError) {
                        this.logError('Failed to parse filters', parseError, { filters: queryParams.filters });
                        throw new ApiError(
                            ErrorType.VALIDATION_ERROR,
                            'Invalid filters format',
                            400
                        );
                    }
                }

                // Apply ordering - support complex ordering like "tabiot_schedule_plan.label ASC"
                if (queryParams.order_by) {
                    const orderParts = queryParams.order_by.trim().split(' ');
                    const field = orderParts[0];
                    const direction = orderParts[1]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

                    // Handle complex field paths
                    if (field.includes('.')) {
                        qb.orderBy(field, direction);
                    } else {
                        qb.orderBy(`iot_schedule_log.${field}`, direction);
                    }
                } else {
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
                const scheduleData: SchedulePlan[] = [];

                for (const log of scheduleLogs) {
                    if (!log.schedule?.schedulePlan) {
                        continue; // Skip logs without proper schedule plan data
                    }

                    const schedulePlan = log.schedule.schedulePlan;
                    const schedule = log.schedule;

                    // Format dates and times
                    const startTimeUnix = this.formatToUnixTime(log.start_time, schedulePlan.start_date);
                    const endTimeUnix = this.formatToUnixTime(log.end_time, schedulePlan.end_date);

                    // Get notifications for this schedule/device
                    const notifications = await this.getNotificationsForSchedule(
                        notificationRepo,
                        schedule.device_id,
                        log.start_time,
                        log.end_time
                    );

                    // Get telemetry data grouped by key
                    const dataByKey = await this.getTelemetryDataByKey(
                        telemetryRepo,
                        schedule.device_id,
                        startTimeUnix,
                        endTimeUnix
                    );

                    const schedulePlanData: SchedulePlan = {
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
                        notifications: notifications.filter((n: Notification) => n.severity !== 'error' && n.severity !== 'warning'),
                        errors: notifications.filter((n: Notification) => n.severity === 'error'),
                        warnings: notifications.filter((n: Notification) => n.severity === 'warning'),
                        data_by_key: dataByKey
                    };

                    scheduleData.push(schedulePlanData);
                }

                const response: ScheduleLogDetailResponse = {
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
            } catch (error) {
                this.logError('Error retrieving schedule log detail', error);
                if (error instanceof ApiError) {
                    throw error;
                }
                throw new ApiError(
                    ErrorType.DATABASE_ERROR,
                    `Failed to retrieve schedule log detail: ${(error as Error).message}`,
                    500
                );
            }
        }, { userId, filters: queryParams });
    }



    /**
     * Generate unique name for schedule log
     */
    private generateScheduleLogName(scheduleId: string): string {
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `schedule_log_${scheduleId}_${timestamp}_${randomSuffix}`;
    }

    /**
     * Format time for database storage (MySQL time format)
     */
    private formatTimeForDatabase(date: Date): string {
        return date.toISOString().slice(11, 19); // Extract HH:MM:SS from ISO string
    }

    /**
     * Format time to Unix timestamp string
     */
    private formatToUnixTime(time: string | null, date: string | null): string {
        if (!time || !date) {
            return new Date().toISOString();
        }

        try {
            // Combine date and time
            const dateTimeString = `${date}T${time}`;
            const dateTime = new Date(dateTimeString);
            return dateTime.toISOString();
        } catch (error) {
            this.logWarn('Failed to format time to Unix', { time, date, error });
            return new Date().toISOString();
        }
    }

    /**
     * Format date to string format
     */
    private formatDateTime(date: Date | string | null): string {
        if (!date) {
            return '';
        }

        try {
            const dateObj = typeof date === 'string' ? new Date(date) : date;
            return dateObj.toISOString().slice(0, 19).replace('T', ' ');
        } catch (error) {
            this.logWarn('Failed to format date time', { date, error });
            return '';
        }
    }

    /**
     * Get notifications for a specific schedule/device within time range
     */
    private async getNotificationsForSchedule(
        notificationRepo: any,
        deviceId: string,
        startTime: string | null,
        endTime: string | null
    ): Promise<Notification[]> {
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

            return notifications.map((n: any) => ({
                name: n.id || n.name || '',
                message: n.message || '',
                severity: n.severity || 'notification',
                created_at: this.formatDateTime(n.created_at),
                type: n.type || 'device'
            }));
        } catch (error) {
            this.logWarn('Failed to get notifications for schedule', { deviceId, error });
            return [];
        }
    }

    /**
     * Calculate average device data from telemetry within time range
     */
    private async calculateAverageDeviceData(
        telemetryRepo: any,
        deviceId: string,
        startTimeUnix: string,
        endTimeUnix: string
    ): Promise<{ [key: string]: number } | null> {
        try {
            if (!deviceId || !startTimeUnix || !endTimeUnix) {
                return null;
            }

            const telemetryData = await telemetryRepo.createQueryBuilder('telemetry')
                .where('telemetry.device_id = :deviceId', { deviceId })
                .andWhere('telemetry.timestamp >= :startTime', { startTime: new Date(startTimeUnix) })
                .andWhere('telemetry.timestamp <= :endTime', { endTime: new Date(endTimeUnix) })
                .andWhere('telemetry.value_type IN (:...types)', { types: ['int', 'float'] })
                .getMany();

            if (telemetryData.length === 0) {
                return null;
            }

            // Group by key_name and calculate averages
            const averages: { [key: string]: number } = {};
            const counts: { [key: string]: number } = {};
            const sums: { [key: string]: number } = {};

            for (const data of telemetryData) {
                const keyName = data.key_name || 'unknown';
                let value = 0;

                if (data.value_type === 'int' && data.int_value !== null) {
                    value = data.int_value;
                } else if (data.value_type === 'float' && data.float_value !== null) {
                    value = data.float_value;
                } else {
                    continue; // Skip non-numeric values
                }

                if (!sums[keyName]) {
                    sums[keyName] = 0;
                    counts[keyName] = 0;
                }

                sums[keyName] += value;
                counts[keyName] += 1;
            }

            // Calculate averages
            for (const keyName in sums) {
                if (counts[keyName] > 0) {
                    averages[keyName] = Math.round((sums[keyName] / counts[keyName]) * 100) / 100; // Round to 2 decimal places
                }
            }

            return Object.keys(averages).length > 0 ? averages : null;
        } catch (error) {
            this.logWarn('Failed to calculate average device data', { deviceId, error });
            return null;
        }
    }

    /**
     * Get telemetry data grouped by key for a device within time range
     */
    private async getTelemetryDataByKey(
        telemetryRepo: any,
        deviceId: string,
        startTimeUnix: string,
        endTimeUnix: string
    ): Promise<Record<string, DataPoint[]>> {
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
            const groupedData: Record<string, DataPoint[]> = {};

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
        } catch (error) {
            this.logWarn('Failed to get telemetry data by key', { deviceId, error });
            return {};
        }
    }

    /**
     * Health check for schedule log service
     */
    protected async onHealthCheck(): Promise<any> {
        const repositoryConnected = !!this.scheduleLogRepository;

        return {
            repositoryConnected,
            status: repositoryConnected ? 'healthy' : 'degraded'
        };
    }
}

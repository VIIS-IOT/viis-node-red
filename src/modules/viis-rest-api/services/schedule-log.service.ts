/**
 * @fileoverview Schedule Log Service for VIIS REST API
 * Handles schedule log creation and management
 */

import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { Node } from 'node-red';
import { BaseService, ServiceContext } from './base.service';
import { DatabaseService } from './database.service';
import { TabiotScheduleLog } from '../../../orm/entities/schedule/TabiotSchedule';
import { ApiError, ErrorType } from '../types/common.types';
import { logger } from '../utils/logger';

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
        context: ServiceContext,
        databaseService: DatabaseService
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

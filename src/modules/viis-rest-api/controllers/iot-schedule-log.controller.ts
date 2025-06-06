/**
 * @fileoverview IoT Schedule Log management controller
 */

import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, QueryParams, Body, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { DatabaseService } from '../services/database.service';
import { ScheduleLogService } from '../services/schedule-log.service';
import {
    IotScheduleLogQueryDto,
    CreateIotScheduleLogDto,
    UpdateIotScheduleLogDto,
    ScheduleLogWithTelemetryDto,
    ScheduleLogDetailResponse
} from '../dto/iot-schedule-log.dto';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { NODE_TOKEN } from '../container/container.setup';
import { applyQueryFilters, FilterTuple } from '../utils/query-filters.util';

/**
 * IoT Schedule Log management controller class
 * 
 * This controller provides full CRUD operations for IoT schedule logs with advanced querying:
 * - Uses routing-controllers decorators with automatic validation
 * - Implements comprehensive error handling and logging
 * - Supports dynamic filtering and pagination
 * - Integration with device telemetry data
 * - Token-based authentication with @Authorized() decorator
 * - Follows the exact API format: {{serverURL}}/api/v2/scheduleLog?page=1&size=100&order_by=tabiot_schedule_plan.label ASC&filters=[...]
 */
@JsonController('/scheduleLog')
@Service()
export class IotScheduleLogController {
    constructor(
        @Inject() private databaseService: DatabaseService,
        @Inject() private scheduleLogService: ScheduleLogService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        logger.info(this.node, 'IotScheduleLogController initialized');
    }

    /**
     * Get all IoT schedule logs with filtering, pagination, and telemetry integration
     * GET /api/v2/scheduleLog
     * 
     * Supports the exact API format:
     * ?page=1&size=100&order_by=tabiot_schedule_plan.label ASC&filters=[["iot_schedule", "device_id", "like", "acc8cad0-3136-11ef-a8ea-8f79bc1b1c88"],["iot_schedule_log", "start_time", ">=", "2024-11-15 00:05:00"],["iot_schedule_log", "end_time", "<=", "2025-11-15 13:08:00"]]
     */
    // @Get('/')
    // @Authorized()
    // async getAllScheduleLogs(
    //     @QueryParams() queryParams: IotScheduleLogQueryDto,
    //     @CurrentUser() user: any
    // ): Promise<any> {
    //     logger.info(this.node, 'Get all IoT schedule logs request', {
    //         requestedBy: user?.user_id,
    //         filters: queryParams
    //     });

    //     try {
    //         const page = queryParams.page || 1;
    //         const size = Math.min(queryParams.size || 100, 100);
    //         const skip = (page - 1) * size;

    //         const scheduleLogRepo = this.databaseService.getScheduleLogRepository();
    //         let qb = scheduleLogRepo.createQueryBuilder('iot_schedule_log')
    //             .leftJoinAndSelect('iot_schedule_log.schedule', 'iot_schedule')
    //             .leftJoinAndSelect('iot_schedule_log.customerUser', 'customerUser')
    //             .leftJoinAndSelect('iot_schedule.schedulePlan', 'tabiot_schedule_plan');

    //         // Apply dynamic filters if provided
    //         if (queryParams.filters) {
    //             try {
    //                 const parsedFilters: FilterTuple[] = JSON.parse(queryParams.filters);
    //                 qb = applyQueryFilters(qb, parsedFilters, 'iot_schedule_log');
    //             } catch (parseError) {
    //                 logger.error(this.node, 'Failed to parse filters:', { filters: queryParams.filters, error: parseError });
    //                 throw new Error('Invalid filters format');
    //             }
    //         }

    //         // Apply search filter
    //         if (queryParams.search) {
    //             qb.andWhere(
    //                 '(iot_schedule.label ILIKE :search OR iot_schedule.device_id ILIKE :search OR tabiot_schedule_plan.label ILIKE :search)',
    //                 { search: `%${queryParams.search}%` }
    //             );
    //         }

    //         // Apply specific filters
    //         if (queryParams.schedule_id) {
    //             qb.andWhere('iot_schedule_log.schedule_id = :schedule_id', { schedule_id: queryParams.schedule_id });
    //         }

    //         if (queryParams.start_time) {
    //             qb.andWhere('iot_schedule_log.start_time >= :start_time', { start_time: queryParams.start_time });
    //         }

    //         if (queryParams.end_time) {
    //             qb.andWhere('iot_schedule_log.end_time <= :end_time', { end_time: queryParams.end_time });
    //         }

    //         // Apply ordering - support complex ordering like "tabiot_schedule_plan.label ASC"
    //         if (queryParams.order_by) {
    //             const orderParts = queryParams.order_by.trim().split(' ');
    //             const field = orderParts[0];
    //             const direction = orderParts[1]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    //             // Handle complex field paths
    //             if (field.includes('.')) {
    //                 qb.orderBy(field, direction);
    //             } else {
    //                 qb.orderBy(`iot_schedule_log.${field}`, direction);
    //             }
    //         } else {
    //             qb.orderBy('iot_schedule_log.creation', 'DESC');
    //         }

    //         // Get total count
    //         const total = await qb.getCount();

    //         // Apply pagination
    //         const data = await qb.skip(skip).take(size).getMany();
    //         //debug
    //         logger.info(this.node, 'Schedule logs retrieved successfully', {
    //             requestedBy: user?.user_id,
    //             total,
    //             returned: data.length,
    //             page,
    //             size
    //         });

    //         // Transform data to plain objects to avoid serialization issues
    //         const transformedData = data.map(scheduleLog => ({
    //             name: scheduleLog.name,
    //             start_time: scheduleLog.start_time,
    //             end_time: scheduleLog.end_time,
    //             schedule_id: scheduleLog.schedule_id,
    //             customer_user: scheduleLog.customer_user,
    //             schedule: scheduleLog.schedule ? {
    //                 name: scheduleLog.schedule.name,
    //                 device_id: scheduleLog.schedule.device_id,
    //                 label: scheduleLog.schedule.label,
    //                 action: scheduleLog.schedule.action,
    //                 enable: scheduleLog.schedule.enable,
    //                 schedule_plan_id: scheduleLog.schedule.schedule_plan_id
    //             } : null,
    //             customerUser: scheduleLog.customerUser ? {
    //                 name: scheduleLog.customerUser.name,
    //                 user_name: scheduleLog.customerUser.user_name,
    //                 email: scheduleLog.customerUser.email,
    //                 full_name: scheduleLog.customerUser.full_name
    //             } : null,
    //             schedulePlan: scheduleLog.schedule?.schedulePlan ? {
    //                 name: scheduleLog.schedule.schedulePlan.name,
    //                 label: scheduleLog.schedule.schedulePlan.label,
    //                 schedule_count: scheduleLog.schedule.schedulePlan.schedule_count,
    //                 status: scheduleLog.schedule.schedulePlan.status,
    //                 enable: scheduleLog.schedule.schedulePlan.enable,
    //                 device_id: scheduleLog.schedule.schedulePlan.device_id,
    //                 start_date: scheduleLog.schedule.schedulePlan.start_date,
    //                 end_date: scheduleLog.schedule.schedulePlan.end_date
    //             } : null
    //         }));

    //         logger.info(this.node, 'IoT schedule logs retrieved successfully', {
    //             requestedBy: user?.user_id,
    //             total,
    //             returned: transformedData.length,
    //             page,
    //             size
    //         });

    //         return {
    //             data: transformedData,
    //             page,
    //             size,
    //             total,
    //             totalPages: Math.ceil(total / size)
    //         };
    //     } catch (error: any) {
    //         logger.error(this.node, 'Error retrieving IoT schedule logs:', error);
    //         throw error;
    //     }
    // }

    /**
     * Get schedule logs with telemetry data for a specific time range
     * GET /api/v2/scheduleLog/with-telemetry
     */
    @Get('/')
    @Authorized()
    async getScheduleLogsWithTelemetry(
        @QueryParams() queryParams: IotScheduleLogQueryDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get schedule logs with telemetry request', {
            requestedBy: user?.user_id,
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
                    const parsedFilters: FilterTuple[] = JSON.parse(queryParams.filters);
                    qb = applyQueryFilters(qb, parsedFilters, 'iot_schedule_log');
                } catch (parseError) {
                    logger.error(this.node, 'Failed to parse filters:', { filters: queryParams.filters, error: parseError });
                    throw new Error('Invalid filters format');
                }
            }

            // Apply time range filters
            if (queryParams.start_date) {
                qb.andWhere('DATE(iot_schedule_log.start_time) >= :start_date', { start_date: queryParams.start_date });
            }

            if (queryParams.end_date) {
                qb.andWhere('DATE(iot_schedule_log.end_time) <= :end_date', { end_date: queryParams.end_date });
            }
            //debug
            logger.info(this.node, 'Querying schedule logs with telemetry', {
                requestedBy: user?.user_id,
                filters: queryParams
            });
            const total = await qb.getCount();
            const scheduleLogs = await qb.skip(skip).take(size).getMany();
            //debug
            logger.info(this.node, 'Schedule logs retrieved successfully', {
                requestedBy: user?.user_id,
                total,
                returned: scheduleLogs.length,
                page,
                size
            });

            // For each schedule log, get associated telemetry data
            const enrichedData: ScheduleLogWithTelemetryDto[] = [];

            for (const log of scheduleLogs) {
                const enrichedLog: ScheduleLogWithTelemetryDto = {
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
                if (log.schedule?.device_id && log.start_time && log.end_time) {
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
                    } catch (telemetryError) {
                        logger.warn(this.node, 'Failed to fetch telemetry data', {
                            device_id: log.schedule.device_id,
                            error: telemetryError
                        });
                    }
                }

                enrichedData.push(enrichedLog);
            }

            logger.info(this.node, 'Schedule logs with telemetry retrieved successfully', {
                requestedBy: user?.user_id,
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
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving schedule logs with telemetry:', error);
            throw error;
        }
    }

    /**
     * Get detailed schedule logs with comprehensive data
     * GET /api/v2/scheduleLog/detail
     *
     * Supports the exact API format:
     * ?page=1&size=1&filters=[["iot_schedule", "device_id", "like", "acc8cad0-3136-11ef-a8ea-8f79bc1b1c88"],["iot_schedule_log", "start_time", ">=", "2024-11-15 00:05:00"],["iot_schedule_log", "end_time", "<=", "2025-11-15 13:08:00"]]&order_by=tabiot_schedule_plan.label ASC
     */
    @Get('/detail')
    @Authorized()
    async getScheduleLogDetail(
        @QueryParams() queryParams: IotScheduleLogQueryDto,
        @CurrentUser() user: any
    ): Promise<ScheduleLogDetailResponse> {
        logger.info(this.node, 'Get schedule log detail request', {
            requestedBy: user?.user_id,
            filters: queryParams
        });

        try {
            return await this.scheduleLogService.getScheduleLogDetail(queryParams, user?.user_id);
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving schedule log detail:', error);
            throw error;
        }
    }



    /**
     * Get a specific IoT schedule log by name
     * GET /api/v2/scheduleLog/:name
     */
    @Get('/:name')
    @Authorized()
    async getScheduleLog(
        @Param('name') name: string,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get IoT schedule log request', {
            requestedBy: user?.user_id,
            scheduleLogName: name
        });

        try {
            const scheduleLogRepo = this.databaseService.getScheduleLogRepository();
            const scheduleLog = await scheduleLogRepo.findOne({
                where: { name: name },
                relations: ['schedule', 'customerUser']
            });

            if (!scheduleLog) {
                logger.warn(this.node, 'IoT schedule log not found', { name: name });
                throw new Error('IoT schedule log not found');
            }

            logger.info(this.node, 'IoT schedule log retrieved successfully', {
                requestedBy: user?.user_id,
                scheduleLogName: name
            });

            // Transform to plain object to avoid serialization issues
            return {
                name: scheduleLog.name,
                start_time: scheduleLog.start_time,
                end_time: scheduleLog.end_time,
                schedule_id: scheduleLog.schedule_id,
                customer_user: scheduleLog.customer_user,
                schedule: scheduleLog.schedule ? {
                    name: scheduleLog.schedule.name,
                    device_id: scheduleLog.schedule.device_id,
                    label: scheduleLog.schedule.label,
                    action: scheduleLog.schedule.action,
                    enable: scheduleLog.schedule.enable
                } : null,
                customerUser: scheduleLog.customerUser ? {
                    name: scheduleLog.customerUser.name,
                    user_name: scheduleLog.customerUser.user_name,
                    email: scheduleLog.customerUser.email,
                    full_name: scheduleLog.customerUser.full_name
                } : null
            };
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving IoT schedule log:', error);
            throw error;
        }
    }

    /**
     * Create a new IoT schedule log
     * POST /api/v2/scheduleLog
     */
    @Post('/')
    @Authorized()
    async createScheduleLog(
        @Body() scheduleLogData: CreateIotScheduleLogDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Create IoT schedule log request', {
            requestedBy: user?.user_id,
            scheduleLogName: scheduleLogData.name
        });

        try {
            const scheduleLogRepo = this.databaseService.getScheduleLogRepository();

            // Check if schedule log already exists
            const existingLog = await scheduleLogRepo.findOne({
                where: { name: scheduleLogData.name }
            });

            if (existingLog) {
                logger.warn(this.node, 'IoT schedule log already exists', { name: scheduleLogData.name });
                throw new Error('IoT schedule log with this name already exists');
            }

            // Create new schedule log
            const newScheduleLog = scheduleLogRepo.create(scheduleLogData);
            const savedScheduleLog = await scheduleLogRepo.save(newScheduleLog);

            logger.info(this.node, 'IoT schedule log created successfully', {
                requestedBy: user?.user_id,
                scheduleLogName: savedScheduleLog.name
            });

            // Transform to plain object to avoid serialization issues
            return {
                name: savedScheduleLog.name,
                start_time: savedScheduleLog.start_time,
                end_time: savedScheduleLog.end_time,
                schedule_id: savedScheduleLog.schedule_id,
                customer_user: savedScheduleLog.customer_user
            };
        } catch (error: any) {
            logger.error(this.node, 'Error creating IoT schedule log:', error);
            throw error;
        }
    }

    /**
     * Update an existing IoT schedule log
     * PUT /api/v2/scheduleLog/:name
     */
    @Put('/:name')
    @Authorized()
    async updateScheduleLog(
        @Param('name') name: string,
        @Body() scheduleLogData: UpdateIotScheduleLogDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Update IoT schedule log request', {
            requestedBy: user?.user_id,
            scheduleLogName: name
        });

        try {
            const scheduleLogRepo = this.databaseService.getScheduleLogRepository();

            // Check if schedule log exists
            const existingLog = await scheduleLogRepo.findOne({
                where: { name: name }
            });

            if (!existingLog) {
                logger.warn(this.node, 'IoT schedule log not found for update', { name: name });
                throw new Error('IoT schedule log not found');
            }

            // Update schedule log
            await scheduleLogRepo.update({ name: name }, scheduleLogData);

            // Fetch updated schedule log
            const updatedScheduleLog = await scheduleLogRepo.findOne({
                where: { name: name },
                relations: ['schedule', 'customerUser']
            });

            logger.info(this.node, 'IoT schedule log updated successfully', {
                requestedBy: user?.user_id,
                scheduleLogName: name
            });

            // Transform to plain object to avoid serialization issues
            return updatedScheduleLog ? {
                name: updatedScheduleLog.name,
                start_time: updatedScheduleLog.start_time,
                end_time: updatedScheduleLog.end_time,
                schedule_id: updatedScheduleLog.schedule_id,
                customer_user: updatedScheduleLog.customer_user,
                schedule: updatedScheduleLog.schedule ? {
                    name: updatedScheduleLog.schedule.name,
                    device_id: updatedScheduleLog.schedule.device_id,
                    label: updatedScheduleLog.schedule.label,
                    action: updatedScheduleLog.schedule.action,
                    enable: updatedScheduleLog.schedule.enable
                } : null,
                customerUser: updatedScheduleLog.customerUser ? {
                    name: updatedScheduleLog.customerUser.name,
                    user_name: updatedScheduleLog.customerUser.user_name,
                    email: updatedScheduleLog.customerUser.email,
                    full_name: updatedScheduleLog.customerUser.full_name
                } : null
            } : null;
        } catch (error: any) {
            logger.error(this.node, 'Error updating IoT schedule log:', error);
            throw error;
        }
    }

    /**
     * Delete an IoT schedule log
     * DELETE /api/v2/scheduleLog/:name
     */
    @Delete('/:name')
    @Authorized()
    async deleteScheduleLog(
        @Param('name') name: string,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Delete IoT schedule log request', {
            requestedBy: user?.user_id,
            scheduleLogName: name
        });

        try {
            const scheduleLogRepo = this.databaseService.getScheduleLogRepository();

            // Check if schedule log exists
            const existingLog = await scheduleLogRepo.findOne({
                where: { name: name }
            });

            if (!existingLog) {
                logger.warn(this.node, 'IoT schedule log not found for deletion', { name: name });
                throw new Error('IoT schedule log not found');
            }

            // Delete schedule log
            await scheduleLogRepo.delete({ name: name });

            logger.info(this.node, 'IoT schedule log deleted successfully', {
                requestedBy: user?.user_id,
                scheduleLogName: name
            });

            return { message: 'IoT schedule log deleted successfully' };
        } catch (error: any) {
            logger.error(this.node, 'Error deleting IoT schedule log:', error);
            throw error;
        }
    }
}

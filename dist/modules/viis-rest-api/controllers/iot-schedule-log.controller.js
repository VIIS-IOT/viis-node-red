"use strict";
/**
 * @fileoverview IoT Schedule Log management controller
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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IotScheduleLogController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const database_service_1 = require("../services/database.service");
const schedule_log_service_1 = require("../services/schedule-log.service");
const iot_schedule_log_dto_1 = require("../dto/iot-schedule-log.dto");
const logger_1 = require("../utils/logger");
const container_setup_1 = require("../container/container.setup");
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
let IotScheduleLogController = class IotScheduleLogController {
    constructor(databaseService, scheduleLogService, node) {
        this.databaseService = databaseService;
        this.scheduleLogService = scheduleLogService;
        this.node = node;
        logger_1.logger.info(this.node, 'IotScheduleLogController initialized');
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
     * GET /api/v2/scheduleLog
     */
    async getScheduleLogsWithTelemetry(queryParams, user) {
        logger_1.logger.info(this.node, 'Get schedule logs with telemetry request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            filters: queryParams
        });
        try {
            return await this.scheduleLogService.getScheduleLogsWithTelemetry(queryParams, user === null || user === void 0 ? void 0 : user.user_id);
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving schedule logs with telemetry:', error);
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
    async getScheduleLogDetail(queryParams, user) {
        logger_1.logger.info(this.node, 'Get schedule log detail request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            filters: queryParams
        });
        try {
            return await this.scheduleLogService.getScheduleLogDetail(queryParams, user === null || user === void 0 ? void 0 : user.user_id);
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving schedule log detail:', error);
            throw error;
        }
    }
    /**
     * Get a specific IoT schedule log by name
     * GET /api/v2/scheduleLog/:name
     */
    async getScheduleLog(name, user) {
        logger_1.logger.info(this.node, 'Get IoT schedule log request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            scheduleLogName: name
        });
        try {
            const scheduleLogRepo = this.databaseService.getScheduleLogRepository();
            const scheduleLog = await scheduleLogRepo.findOne({
                where: { name: name },
                relations: ['schedule', 'customerUser']
            });
            if (!scheduleLog) {
                logger_1.logger.warn(this.node, 'IoT schedule log not found', { name: name });
                throw new Error('IoT schedule log not found');
            }
            logger_1.logger.info(this.node, 'IoT schedule log retrieved successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
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
                    full_name: scheduleLog.customerUser.full_name,
                    first_name: scheduleLog.customerUser.first_name,
                    last_name: scheduleLog.customerUser.last_name
                } : null
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving IoT schedule log:', error);
            throw error;
        }
    }
    /**
     * Create a new IoT schedule log
     * POST /api/v2/scheduleLog
     */
    async createScheduleLog(scheduleLogData, user) {
        logger_1.logger.info(this.node, 'Create IoT schedule log request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            scheduleLogName: scheduleLogData.name
        });
        try {
            const scheduleLogRepo = this.databaseService.getScheduleLogRepository();
            // Check if schedule log already exists
            const existingLog = await scheduleLogRepo.findOne({
                where: { name: scheduleLogData.name }
            });
            if (existingLog) {
                logger_1.logger.warn(this.node, 'IoT schedule log already exists', { name: scheduleLogData.name });
                throw new Error('IoT schedule log with this name already exists');
            }
            // Create new schedule log
            const newScheduleLog = scheduleLogRepo.create(Object.assign(Object.assign({}, scheduleLogData), { customer_user: user === null || user === void 0 ? void 0 : user.user_id // Automatically set customer_user from current user
             }));
            const savedScheduleLog = await scheduleLogRepo.save(newScheduleLog);
            logger_1.logger.info(this.node, 'IoT schedule log created successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
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
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error creating IoT schedule log:', error);
            throw error;
        }
    }
    /**
     * Update an existing IoT schedule log
     * PUT /api/v2/scheduleLog/:name
     */
    async updateScheduleLog(name, scheduleLogData, user) {
        logger_1.logger.info(this.node, 'Update IoT schedule log request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            scheduleLogName: name
        });
        try {
            const scheduleLogRepo = this.databaseService.getScheduleLogRepository();
            // Check if schedule log exists
            const existingLog = await scheduleLogRepo.findOne({
                where: { name: name }
            });
            if (!existingLog) {
                logger_1.logger.warn(this.node, 'IoT schedule log not found for update', { name: name });
                throw new Error('IoT schedule log not found');
            }
            // Update schedule log
            await scheduleLogRepo.update({ name: name }, scheduleLogData);
            // Fetch updated schedule log
            const updatedScheduleLog = await scheduleLogRepo.findOne({
                where: { name: name },
                relations: ['schedule', 'customerUser']
            });
            logger_1.logger.info(this.node, 'IoT schedule log updated successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
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
                    full_name: updatedScheduleLog.customerUser.full_name,
                    first_name: updatedScheduleLog.customerUser.first_name,
                    last_name: updatedScheduleLog.customerUser.last_name
                } : null
            } : null;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error updating IoT schedule log:', error);
            throw error;
        }
    }
    /**
     * Delete an IoT schedule log
     * DELETE /api/v2/scheduleLog/:name
     */
    async deleteScheduleLog(name, user) {
        logger_1.logger.info(this.node, 'Delete IoT schedule log request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            scheduleLogName: name
        });
        try {
            const scheduleLogRepo = this.databaseService.getScheduleLogRepository();
            // Check if schedule log exists
            const existingLog = await scheduleLogRepo.findOne({
                where: { name: name }
            });
            if (!existingLog) {
                logger_1.logger.warn(this.node, 'IoT schedule log not found for deletion', { name: name });
                throw new Error('IoT schedule log not found');
            }
            // Delete schedule log
            await scheduleLogRepo.delete({ name: name });
            logger_1.logger.info(this.node, 'IoT schedule log deleted successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                scheduleLogName: name
            });
            return { message: 'IoT schedule log deleted successfully' };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error deleting IoT schedule log:', error);
            throw error;
        }
    }
};
exports.IotScheduleLogController = IotScheduleLogController;
__decorate([
    (0, routing_controllers_1.Get)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.QueryParams)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [iot_schedule_log_dto_1.IotScheduleLogQueryDto, Object]),
    __metadata("design:returntype", Promise)
], IotScheduleLogController.prototype, "getScheduleLogsWithTelemetry", null);
__decorate([
    (0, routing_controllers_1.Get)('/detail'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.QueryParams)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [iot_schedule_log_dto_1.IotScheduleLogQueryDto, Object]),
    __metadata("design:returntype", Promise)
], IotScheduleLogController.prototype, "getScheduleLogDetail", null);
__decorate([
    (0, routing_controllers_1.Get)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], IotScheduleLogController.prototype, "getScheduleLog", null);
__decorate([
    (0, routing_controllers_1.Post)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [iot_schedule_log_dto_1.CreateIotScheduleLogDto, Object]),
    __metadata("design:returntype", Promise)
], IotScheduleLogController.prototype, "createScheduleLog", null);
__decorate([
    (0, routing_controllers_1.Put)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.Body)()),
    __param(2, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, iot_schedule_log_dto_1.UpdateIotScheduleLogDto, Object]),
    __metadata("design:returntype", Promise)
], IotScheduleLogController.prototype, "updateScheduleLog", null);
__decorate([
    (0, routing_controllers_1.Delete)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], IotScheduleLogController.prototype, "deleteScheduleLog", null);
exports.IotScheduleLogController = IotScheduleLogController = __decorate([
    (0, routing_controllers_1.JsonController)('/scheduleLog'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)()),
    __param(2, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        schedule_log_service_1.ScheduleLogService, Object])
], IotScheduleLogController);

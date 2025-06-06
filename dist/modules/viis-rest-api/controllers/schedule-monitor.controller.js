"use strict";
/**
 * @fileoverview Schedule Monitoring Controller for VIIS REST API
 * Provides endpoints for schedule lifecycle monitoring and management
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
exports.ScheduleMonitorController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const logger_1 = require("../utils/logger");
const schedule_completion_monitor_service_1 = require("../services/schedule-completion-monitor.service");
const schedule_activation_service_1 = require("../services/schedule-activation.service");
const container_setup_1 = require("../container/container.setup");
const common_types_1 = require("../types/common.types");
/**
 * Schedule Monitoring controller class
 * Provides endpoints for managing schedule lifecycle monitoring
 */
let ScheduleMonitorController = class ScheduleMonitorController {
    constructor(node, scheduleCompletionMonitor, scheduleActivationService) {
        this.node = node;
        this.scheduleCompletionMonitor = scheduleCompletionMonitor;
        this.scheduleActivationService = scheduleActivationService;
    }
    /**
     * Get monitoring status
     * GET /api/v2/schedule-monitor/status
     */
    async getMonitoringStatus() {
        logger_1.logger.info(this.node, 'Schedule monitoring status requested');
        try {
            const healthInfo = await this.scheduleCompletionMonitor.healthCheck();
            const activeSchedules = this.scheduleCompletionMonitor.getActiveSchedules();
            const response = {
                success: true,
                isMonitoring: healthInfo.isMonitoring,
                activeSchedulesCount: activeSchedules.size,
                monitoringIntervalMs: healthInfo.monitoringIntervalMs,
                serviceHealth: healthInfo
            };
            logger_1.logger.info(this.node, 'Schedule monitoring status retrieved', {
                isMonitoring: response.isMonitoring,
                activeSchedulesCount: response.activeSchedulesCount
            });
            return response;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to get monitoring status', {
                error: error.message
            });
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, `Failed to get monitoring status: ${error.message}`, 500);
        }
    }
    /**
     * Get active schedules being monitored
     * GET /api/v2/schedule-monitor/active-schedules
     */
    async getActiveSchedules() {
        logger_1.logger.info(this.node, 'Active schedules requested');
        try {
            const activeSchedulesMap = this.scheduleCompletionMonitor.getActiveSchedules();
            const activeSchedules = Array.from(activeSchedulesMap.values());
            const healthInfo = await this.scheduleCompletionMonitor.healthCheck();
            const response = {
                success: true,
                activeSchedules,
                totalCount: activeSchedules.length,
                monitoringStatus: {
                    isMonitoring: healthInfo.isMonitoring,
                    monitoringIntervalMs: healthInfo.monitoringIntervalMs
                }
            };
            logger_1.logger.info(this.node, 'Active schedules retrieved', {
                totalCount: response.totalCount,
                isMonitoring: response.monitoringStatus.isMonitoring
            });
            return response;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to get active schedules', {
                error: error.message
            });
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, `Failed to get active schedules: ${error.message}`, 500);
        }
    }
    /**
     * Get specific active schedule details
     * GET /api/v2/schedule-monitor/active-schedules/:scheduleId
     */
    async getActiveSchedule(scheduleId) {
        logger_1.logger.info(this.node, 'Active schedule details requested', { scheduleId });
        try {
            this.validateScheduleId(scheduleId);
            const activeSchedulesMap = this.scheduleCompletionMonitor.getActiveSchedules();
            const scheduleInfo = activeSchedulesMap.get(scheduleId);
            if (!scheduleInfo) {
                throw new common_types_1.ApiError(common_types_1.ErrorType.NOT_FOUND, `Active schedule not found: ${scheduleId}`, 404);
            }
            logger_1.logger.info(this.node, 'Active schedule details retrieved', {
                scheduleId,
                deviceId: scheduleInfo.deviceId
            });
            return {
                success: true,
                schedule: scheduleInfo
            };
        }
        catch (error) {
            if (error instanceof common_types_1.ApiError) {
                throw error;
            }
            logger_1.logger.error(this.node, 'Failed to get active schedule details', {
                error: error.message,
                scheduleId
            });
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, `Failed to get active schedule details: ${error.message}`, 500);
        }
    }
    /**
     * Remove schedule from active monitoring
     * DELETE /api/v2/schedule-monitor/active-schedules/:scheduleId
     */
    async removeActiveSchedule(scheduleId, user) {
        logger_1.logger.info(this.node, 'Remove active schedule requested', {
            scheduleId,
            userId: user === null || user === void 0 ? void 0 : user.user_id
        });
        try {
            this.validateScheduleId(scheduleId);
            const activeSchedulesMap = this.scheduleCompletionMonitor.getActiveSchedules();
            const scheduleInfo = activeSchedulesMap.get(scheduleId);
            if (!scheduleInfo) {
                throw new common_types_1.ApiError(common_types_1.ErrorType.NOT_FOUND, `Active schedule not found: ${scheduleId}`, 404);
            }
            this.scheduleCompletionMonitor.removeActiveSchedule(scheduleId);
            logger_1.logger.info(this.node, 'Active schedule removed from monitoring', {
                scheduleId,
                deviceId: scheduleInfo.deviceId,
                userId: user === null || user === void 0 ? void 0 : user.user_id
            });
            return {
                success: true,
                message: `Schedule ${scheduleId} removed from active monitoring`,
                removedSchedule: scheduleInfo
            };
        }
        catch (error) {
            if (error instanceof common_types_1.ApiError) {
                throw error;
            }
            logger_1.logger.error(this.node, 'Failed to remove active schedule', {
                error: error.message,
                scheduleId,
                userId: user === null || user === void 0 ? void 0 : user.user_id
            });
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, `Failed to remove active schedule: ${error.message}`, 500);
        }
    }
    /**
     * Get service health information
     * GET /api/v2/schedule-monitor/health
     */
    async getServiceHealth() {
        logger_1.logger.debug(this.node, 'Schedule monitoring service health check requested');
        try {
            const monitorHealthInfo = await this.scheduleCompletionMonitor.healthCheck();
            const activationHealthInfo = await this.scheduleActivationService.healthCheck();
            const response = {
                service: 'Schedule Monitoring',
                status: (monitorHealthInfo.status === 'healthy' && activationHealthInfo.status === 'healthy') ? 'healthy' : 'degraded',
                timestamp: new Date().toISOString(),
                details: {
                    scheduleCompletionMonitor: monitorHealthInfo,
                    scheduleActivationService: activationHealthInfo
                }
            };
            logger_1.logger.debug(this.node, 'Schedule monitoring service health check completed', {
                status: response.status
            });
            return response;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Schedule monitoring service health check failed', {
                error: error.message
            });
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, `Health check failed: ${error.message}`, 500);
        }
    }
    /**
     * Validate schedule ID format and constraints
     */
    validateScheduleId(scheduleId) {
        if (!scheduleId || typeof scheduleId !== 'string') {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Schedule ID is required and must be a string', 400);
        }
        if (scheduleId.trim().length === 0) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Schedule ID cannot be empty', 400);
        }
        if (scheduleId.length > 255) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Schedule ID cannot exceed 255 characters', 400);
        }
    }
};
exports.ScheduleMonitorController = ScheduleMonitorController;
__decorate([
    (0, routing_controllers_1.Get)('/status'),
    (0, routing_controllers_1.Authorized)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScheduleMonitorController.prototype, "getMonitoringStatus", null);
__decorate([
    (0, routing_controllers_1.Get)('/active-schedules'),
    (0, routing_controllers_1.Authorized)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScheduleMonitorController.prototype, "getActiveSchedules", null);
__decorate([
    (0, routing_controllers_1.Get)('/active-schedules/:scheduleId'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('scheduleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ScheduleMonitorController.prototype, "getActiveSchedule", null);
__decorate([
    (0, routing_controllers_1.Delete)('/active-schedules/:scheduleId'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('scheduleId')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ScheduleMonitorController.prototype, "removeActiveSchedule", null);
__decorate([
    (0, routing_controllers_1.Get)('/health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScheduleMonitorController.prototype, "getServiceHealth", null);
exports.ScheduleMonitorController = ScheduleMonitorController = __decorate([
    (0, routing_controllers_1.JsonController)('/api/v2/schedule-monitor'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [Object, schedule_completion_monitor_service_1.ScheduleCompletionMonitorService,
        schedule_activation_service_1.ScheduleActivationService])
], ScheduleMonitorController);

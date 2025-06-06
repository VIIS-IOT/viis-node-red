/**
 * @fileoverview Schedule Monitoring Controller for VIIS REST API
 * Provides endpoints for schedule lifecycle monitoring and management
 */

import 'reflect-metadata';
import { JsonController, Get, Post, Delete, Param, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { ScheduleCompletionMonitorService, ActiveScheduleInfo } from '../services/schedule-completion-monitor.service';
import { ScheduleActivationService } from '../services/schedule-activation.service';
import { NODE_TOKEN } from '../container/container.setup';
import { ApiError, ErrorType } from '../types/common.types';

/**
 * Response DTO for active schedules
 */
export interface ActiveSchedulesResponse {
    success: boolean;
    activeSchedules: ActiveScheduleInfo[];
    totalCount: number;
    monitoringStatus: {
        isMonitoring: boolean;
        monitoringIntervalMs: number;
    };
}

/**
 * Response DTO for monitoring status
 */
export interface MonitoringStatusResponse {
    success: boolean;
    isMonitoring: boolean;
    activeSchedulesCount: number;
    monitoringIntervalMs: number;
    serviceHealth: any;
}

/**
 * Schedule Monitoring controller class
 * Provides endpoints for managing schedule lifecycle monitoring
 */
@JsonController('/api/v2/schedule-monitor')
@Service()
export class ScheduleMonitorController {
    constructor(
        @Inject(NODE_TOKEN) private node: Node,
        private scheduleCompletionMonitor: ScheduleCompletionMonitorService,
        private scheduleActivationService: ScheduleActivationService
    ) { }

    /**
     * Get monitoring status
     * GET /api/v2/schedule-monitor/status
     */
    @Get('/status')
    @Authorized()
    async getMonitoringStatus(): Promise<MonitoringStatusResponse> {
        logger.info(this.node, 'Schedule monitoring status requested');

        try {
            const healthInfo = await this.scheduleCompletionMonitor.healthCheck();
            const activeSchedules = this.scheduleCompletionMonitor.getActiveSchedules();

            const response: MonitoringStatusResponse = {
                success: true,
                isMonitoring: healthInfo.details?.isMonitoring || false,
                activeSchedulesCount: activeSchedules.size,
                monitoringIntervalMs: healthInfo.details?.monitoringIntervalMs || 5000,
                serviceHealth: healthInfo
            };

            logger.info(this.node, 'Schedule monitoring status retrieved', {
                isMonitoring: response.isMonitoring,
                activeSchedulesCount: response.activeSchedulesCount
            });

            return response;

        } catch (error) {
            logger.error(this.node, 'Failed to get monitoring status', {
                error: (error as Error).message
            });
            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                `Failed to get monitoring status: ${(error as Error).message}`,
                500
            );
        }
    }

    /**
     * Get active schedules being monitored
     * GET /api/v2/schedule-monitor/active-schedules
     */
    @Get('/active-schedules')
    @Authorized()
    async getActiveSchedules(): Promise<ActiveSchedulesResponse> {
        logger.info(this.node, 'Active schedules requested');

        try {
            const activeSchedulesMap = this.scheduleCompletionMonitor.getActiveSchedules();
            const activeSchedules = Array.from(activeSchedulesMap.values());
            const healthInfo = await this.scheduleCompletionMonitor.healthCheck();

            const response: ActiveSchedulesResponse = {
                success: true,
                activeSchedules,
                totalCount: activeSchedules.length,
                monitoringStatus: {
                    isMonitoring: healthInfo.details?.isMonitoring || false,
                    monitoringIntervalMs: healthInfo.details?.monitoringIntervalMs || 5000
                }
            };

            logger.info(this.node, 'Active schedules retrieved', {
                totalCount: response.totalCount,
                isMonitoring: response.monitoringStatus.isMonitoring
            });

            return response;

        } catch (error) {
            logger.error(this.node, 'Failed to get active schedules', {
                error: (error as Error).message
            });
            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                `Failed to get active schedules: ${(error as Error).message}`,
                500
            );
        }
    }

    /**
     * Get specific active schedule details
     * GET /api/v2/schedule-monitor/active-schedules/:scheduleId
     */
    @Get('/active-schedules/:scheduleId')
    @Authorized()
    async getActiveSchedule(@Param('scheduleId') scheduleId: string): Promise<any> {
        logger.info(this.node, 'Active schedule details requested', { scheduleId });

        try {
            this.validateScheduleId(scheduleId);

            const activeSchedulesMap = this.scheduleCompletionMonitor.getActiveSchedules();
            const scheduleInfo = activeSchedulesMap.get(scheduleId);

            if (!scheduleInfo) {
                throw new ApiError(
                    ErrorType.NOT_FOUND_ERROR,
                    `Active schedule not found: ${scheduleId}`,
                    404
                );
            }

            logger.info(this.node, 'Active schedule details retrieved', {
                scheduleId,
                deviceId: scheduleInfo.deviceId
            });

            return {
                success: true,
                schedule: scheduleInfo
            };

        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }

            logger.error(this.node, 'Failed to get active schedule details', {
                error: (error as Error).message,
                scheduleId
            });
            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                `Failed to get active schedule details: ${(error as Error).message}`,
                500
            );
        }
    }

    /**
     * Remove schedule from active monitoring
     * DELETE /api/v2/schedule-monitor/active-schedules/:scheduleId
     */
    @Delete('/active-schedules/:scheduleId')
    @Authorized()
    async removeActiveSchedule(
        @Param('scheduleId') scheduleId: string,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Remove active schedule requested', {
            scheduleId,
            userId: user?.user_id
        });

        try {
            this.validateScheduleId(scheduleId);

            const activeSchedulesMap = this.scheduleCompletionMonitor.getActiveSchedules();
            const scheduleInfo = activeSchedulesMap.get(scheduleId);

            if (!scheduleInfo) {
                throw new ApiError(
                    ErrorType.NOT_FOUND_ERROR,
                    `Active schedule not found: ${scheduleId}`,
                    404
                );
            }

            this.scheduleCompletionMonitor.removeActiveSchedule(scheduleId);

            logger.info(this.node, 'Active schedule removed from monitoring', {
                scheduleId,
                deviceId: scheduleInfo.deviceId,
                userId: user?.user_id
            });

            return {
                success: true,
                message: `Schedule ${scheduleId} removed from active monitoring`,
                removedSchedule: scheduleInfo
            };

        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }

            logger.error(this.node, 'Failed to remove active schedule', {
                error: (error as Error).message,
                scheduleId,
                userId: user?.user_id
            });
            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                `Failed to remove active schedule: ${(error as Error).message}`,
                500
            );
        }
    }

    /**
     * Get service health information
     * GET /api/v2/schedule-monitor/health
     */
    @Get('/health')
    async getServiceHealth(): Promise<any> {
        logger.debug(this.node, 'Schedule monitoring service health check requested');

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

            logger.debug(this.node, 'Schedule monitoring service health check completed', {
                status: response.status
            });

            return response;

        } catch (error) {
            logger.error(this.node, 'Schedule monitoring service health check failed', {
                error: (error as Error).message
            });
            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                `Health check failed: ${(error as Error).message}`,
                500
            );
        }
    }

    /**
     * Validate schedule ID format and constraints
     */
    private validateScheduleId(scheduleId: string): void {
        if (!scheduleId || typeof scheduleId !== 'string') {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                'Schedule ID is required and must be a string',
                400
            );
        }

        if (scheduleId.trim().length === 0) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                'Schedule ID cannot be empty',
                400
            );
        }

        if (scheduleId.length > 255) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                'Schedule ID cannot exceed 255 characters',
                400
            );
        }
    }
}

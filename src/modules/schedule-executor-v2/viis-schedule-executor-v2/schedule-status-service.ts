/**
 * Schedule Status Service V2
 * Responsibility: DB status updates, schedule log sync, status history, HTTP notification
 *
 * Extracted from V1's ScheduleService status/notification methods
 */

import { Node } from "node-red";
import { TabiotSchedule, TabiotScheduleLog } from "../../../orm/entities/schedule/TabiotSchedule";
import { AppDataSource } from "../../../orm/dataSource";
import { SyncScheduleService } from "../../../services/syncSchedule/SyncScheduleService";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";
import moment from "moment";
import axios, { AxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";

export class ScheduleStatusService {
    private node: Node;
    private globalHelper: GlobalContextHelper;
    private debugEnable: boolean;
    private syncScheduleService: SyncScheduleService;
    private readonly STATUS_HISTORY_KEY = "scheduleStatusHistoryV2";

    constructor(node: Node, debugEnable: boolean = false) {
        this.node = node;
        this.debugEnable = debugEnable;
        this.globalHelper = new GlobalContextHelper(node.context());

        try {
            this.syncScheduleService = new SyncScheduleService(node.context());
            this.debugLog("SyncScheduleService initialized");
        } catch (error) {
            console.error(`Failed to init SyncScheduleService: ${(error as Error).message}`);
            this.syncScheduleService = undefined as any;
        }
    }

    private debugLog(message: string): void {
        if (this.debugEnable && this.node) {
            this.node.warn(message);
        }
    }

    // ==================== STATUS HISTORY ====================

    /**
     * Check if schedule status has changed compared to last known status
     * Returns true if status actually changed (or first time tracking)
     */
    hasStatusChanged(scheduleName: string, newStatus: string): boolean {
        const statusHistory: Record<string, string> =
            this.node.context().global.get(this.STATUS_HISTORY_KEY) as Record<string, string> || {};

        const previousStatus = statusHistory[scheduleName];
        const changed = previousStatus !== newStatus;

        if (changed) {
            this.debugLog(`Status changed for ${scheduleName}: ${previousStatus || 'undefined'} -> ${newStatus}`);
        }

        // Update history
        statusHistory[scheduleName] = newStatus;
        this.node.context().global.set(this.STATUS_HISTORY_KEY, statusHistory);

        return changed;
    }

    /**
     * Clear status history for a schedule (call after successful finish)
     */
    clearStatusHistory(scheduleName: string): void {
        const statusHistory: Record<string, string> =
            this.node.context().global.get(this.STATUS_HISTORY_KEY) as Record<string, string> || {};

        if (statusHistory[scheduleName]) {
            this.debugLog(`Clearing status history for ${scheduleName}`);
            delete statusHistory[scheduleName];
            this.node.context().global.set(this.STATUS_HISTORY_KEY, statusHistory);
        }
    }

    // ==================== DB STATUS UPDATE ====================

    /**
     * Update schedule status in DB and sync to server
     */
    async updateScheduleStatus(schedule: TabiotSchedule, status: "running" | "finished"): Promise<void> {
        try {
            if (!AppDataSource.isInitialized) {
                this.debugLog("Initializing AppDataSource...");
                await AppDataSource.initialize();
            }

            const repository = AppDataSource.getRepository(TabiotSchedule);
            const previousStatus = schedule.status;

            schedule.status = status;

            const statusIcon = status === 'running' ? '▶️' : '⏹️';
            if (this.node) {
                this.node.warn(`${statusIcon} STATUS: ${schedule.name} | ${previousStatus || 'none'} → ${status}`);
            }

            // Set modified time (UTC+7)
            schedule.modified = moment().utc().add(7, 'hours').toDate();

            await repository.save(schedule);
            this.debugLog(`Updated ${schedule.name} status to ${status}`);

            // Sync to server
            if (this.syncScheduleService) {
                try {
                    await this.syncScheduleService.syncScheduleFromLocalToServer([schedule]);
                    if (this.node) {
                        this.node.warn(`✅ SERVER SYNC: ${schedule.name} | ${status}`);
                    }
                } catch (syncError) {
                    if (this.node) {
                        this.node.warn(`❌ SERVER SYNC FAILED: ${schedule.name} | ${(syncError as Error).message}`);
                    }
                }
            }
        } catch (error) {
            if (this.node) {
                this.node.warn(`❌ DB ERROR: ${schedule.name} | ${(error as Error).message}`);
            }
        }
    }

    // ==================== SCHEDULE LOG SYNC ====================

    /**
     * Sync schedule execution log to backend
     */
    async syncScheduleLog(schedule: TabiotSchedule, success: boolean): Promise<void> {
        try {
            if (!this.syncScheduleService) {
                if (this.node) {
                    this.node.warn(`⚠️ LOG SYNC SKIPPED: ${schedule.name} | SyncScheduleService not available`);
                }
                return;
            }

            const now = moment();
            const todayDate = now.format('YYYY-MM-DD');

            const startTime = moment(`${todayDate} ${schedule.start_time}`, 'YYYY-MM-DD HH:mm').toISOString();
            const endTime = moment(`${todayDate} ${schedule.end_time}`, 'YYYY-MM-DD HH:mm').toISOString();

            const scheduleLogBody: TabiotScheduleLog = {
                start_time: startTime,
                end_time: endTime,
                schedule_id: schedule.name,
                deleted: null
            };

            await this.syncScheduleService.logSchedule(scheduleLogBody);

            if (this.node) {
                this.node.warn(`📝 LOG SYNCED: ${schedule.name} | ${success ? 'Success' : 'Failed'}`);
            }
        } catch (error) {
            if (this.node) {
                this.node.warn(`❌ LOG SYNC ERROR: ${schedule.name} | ${(error as Error).message}`);
            }
        }
    }

    // ==================== HTTP NOTIFICATION ====================

    /**
     * Send notification to backend via HTTP API
     */
    async sendNotificationToBackend(
        schedule: TabiotSchedule,
        action: 'start' | 'end',
        success: boolean = true,
        options?: {
            maxRetries?: number;
            baseDelay?: number;
            timeout?: number;
        }
    ): Promise<boolean> {
        const {
            maxRetries = 3,
            baseDelay = 1000,
            timeout = 10000
        } = options || {};

        // Skip error notifications when debug is disabled
        if (!success && !this.debugEnable) {
            this.debugLog(`Error notification skipped (debug disabled): ${schedule.name}`);
            return true;
        }

        const backendUrl = this.globalHelper ? this.globalHelper.getEnvVar('VIIS_BACKEND', '') : '';
        const deviceAccessToken = this.globalHelper ? this.globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '') : '';
        const deviceId = this.globalHelper ? this.globalHelper.getEnvVar('DEVICE_ID', 'unknown') : 'unknown';

        if (!backendUrl || !deviceAccessToken) {
            if (this.node) {
                this.node.warn('⚠️ HTTP NOTIFICATION SKIPPED: Missing VIIS_BACKEND or DEVICE_ACCESS_TOKEN');
            }
            return false;
        }

        const isStart = action === 'start';
        const severity = !success ? 'error' : 'notification';
        const alarmStatus = isStart ? 'Pending' : 'Clear';

        let message: string;
        let messageKey: string | null = null;
        let messageParams: Record<string, any> | null = null;
        const retryCount = this.globalHelper?.getEnvVar('MODBUS_MAX_RETRIES', 3) || 3;

        if (isStart) {
            if (success) {
                message = `Lịch trình "${schedule.label || schedule.name}" đã bắt đầu chạy thành công`;
                messageKey = 'iot.notification.schedule.started';
                messageParams = { scheduleName: schedule.label || schedule.name };
            } else {
                message = `Lịch trình "${schedule.label || schedule.name}" không thể bắt đầu - Lỗi ghi Modbus sau ${retryCount} lần retry`;
                messageKey = 'iot.notification.schedule.failed';
                messageParams = { scheduleName: schedule.label || schedule.name, retryCount };
            }
        } else {
            if (success) {
                message = `Lịch trình "${schedule.label || schedule.name}" đã hoàn thành`;
                messageKey = 'iot.notification.schedule.completed';
                messageParams = { scheduleName: schedule.label || schedule.name };
            } else {
                message = `Lịch trình "${schedule.label || schedule.name}" đã kết thúc nhưng KHÔNG THỂ TẮT thiết bị - Lỗi ghi Modbus sau retry`;
                messageKey = 'iot.notification.schedule.failed';
                messageParams = { scheduleName: schedule.label || schedule.name };
            }
        }

        const payload = {
            alarm_name: schedule.label || schedule.name,
            id: deviceId,
            msg: message,
            message_key: messageKey,
            message_params: messageParams,
            message_locale: 'vi-VN',
            severity: severity,
            trigger_time: new Date().toISOString(),
            tb_alarm_id: schedule.name,
            alarm_status: alarmStatus,
            clear_by: isStart ? '' : 'Value',
            clear_by_user_id: '',
            entity: deviceId
        };

        const url = `${backendUrl}/api/v2/alarm/notification-by-token`;

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios.post(url, payload, {
                    params: { device_access_token: deviceAccessToken },
                    headers: { 'Content-Type': 'application/json' },
                    timeout: timeout
                });

                if (response.status === 200 || response.status === 201) {
                    if (this.node) {
                        this.node.warn(`📡 HTTP NOTIFICATION: ${schedule.name} | ${action} | ${alarmStatus}`);
                    }
                    return true;
                }

                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            } catch (error) {
                lastError = error as Error;

                if (attempt < maxRetries) {
                    const delayMs = baseDelay * Math.pow(2, attempt - 1);
                    this.debugLog(`HTTP notification retry ${attempt}/${maxRetries} in ${delayMs}ms`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        }

        if (this.node) {
            this.node.warn(`❌ HTTP NOTIFICATION FAILED: ${schedule.name} | ${lastError?.message}`);
        }
        return false;
    }
}

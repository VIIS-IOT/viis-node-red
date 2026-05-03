"use strict";
/**
 * Schedule Status Service V2
 * Responsibility: DB status updates, schedule log sync, status history, HTTP notification
 *
 * Extracted from V1's ScheduleService status/notification methods
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleStatusService = void 0;
const TabiotSchedule_1 = require("../../../orm/entities/schedule/TabiotSchedule");
const dataSource_1 = require("../../../orm/dataSource");
const SyncScheduleService_1 = require("../../../services/syncSchedule/SyncScheduleService");
const global_context_helper_1 = require("../../../ultils/global-context-helper");
const moment_1 = __importDefault(require("moment"));
const axios_1 = __importDefault(require("axios"));
class ScheduleStatusService {
    constructor(node, debugEnable = false) {
        this.STATUS_HISTORY_KEY = "scheduleStatusHistoryV2";
        this.node = node;
        this.debugEnable = debugEnable;
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        try {
            this.syncScheduleService = new SyncScheduleService_1.SyncScheduleService(node.context());
            this.debugLog("SyncScheduleService initialized");
        }
        catch (error) {
            console.error(`Failed to init SyncScheduleService: ${error.message}`);
            this.syncScheduleService = undefined;
        }
    }
    debugLog(message) {
        if (this.debugEnable && this.node) {
            this.node.warn(message);
        }
    }
    // ==================== STATUS HISTORY ====================
    /**
     * Check if schedule status has changed compared to last known status
     * Returns true if status actually changed (or first time tracking)
     */
    hasStatusChanged(scheduleName, newStatus) {
        const statusHistory = this.node.context().global.get(this.STATUS_HISTORY_KEY) || {};
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
    clearStatusHistory(scheduleName) {
        const statusHistory = this.node.context().global.get(this.STATUS_HISTORY_KEY) || {};
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
    async updateScheduleStatus(schedule, status) {
        try {
            if (!dataSource_1.AppDataSource.isInitialized) {
                this.debugLog("Initializing AppDataSource...");
                await dataSource_1.AppDataSource.initialize();
            }
            const repository = dataSource_1.AppDataSource.getRepository(TabiotSchedule_1.TabiotSchedule);
            const previousStatus = schedule.status;
            schedule.status = status;
            const statusIcon = status === 'running' ? '▶️' : '⏹️';
            if (this.node) {
                this.node.warn(`${statusIcon} STATUS: ${schedule.name} | ${previousStatus || 'none'} → ${status}`);
            }
            // Set modified time (UTC+7)
            schedule.modified = (0, moment_1.default)().utc().add(7, 'hours').toDate();
            await repository.save(schedule);
            this.debugLog(`Updated ${schedule.name} status to ${status}`);
            // Sync to server
            if (this.syncScheduleService) {
                try {
                    await this.syncScheduleService.syncScheduleFromLocalToServer([schedule]);
                    if (this.node) {
                        this.node.warn(`✅ SERVER SYNC: ${schedule.name} | ${status}`);
                    }
                }
                catch (syncError) {
                    if (this.node) {
                        this.node.warn(`❌ SERVER SYNC FAILED: ${schedule.name} | ${syncError.message}`);
                    }
                }
            }
        }
        catch (error) {
            if (this.node) {
                this.node.warn(`❌ DB ERROR: ${schedule.name} | ${error.message}`);
            }
        }
    }
    // ==================== SCHEDULE LOG SYNC ====================
    /**
     * Sync schedule execution log to backend
     */
    async syncScheduleLog(schedule, success) {
        try {
            if (!this.syncScheduleService) {
                if (this.node) {
                    this.node.warn(`⚠️ LOG SYNC SKIPPED: ${schedule.name} | SyncScheduleService not available`);
                }
                return;
            }
            const now = (0, moment_1.default)();
            const todayDate = now.format('YYYY-MM-DD');
            const startTime = (0, moment_1.default)(`${todayDate} ${schedule.start_time}`, 'YYYY-MM-DD HH:mm').toISOString();
            const endTime = (0, moment_1.default)(`${todayDate} ${schedule.end_time}`, 'YYYY-MM-DD HH:mm').toISOString();
            const scheduleLogBody = {
                start_time: startTime,
                end_time: endTime,
                schedule_id: schedule.name,
                deleted: null
            };
            await this.syncScheduleService.logSchedule(scheduleLogBody);
            if (this.node) {
                this.node.warn(`📝 LOG SYNCED: ${schedule.name} | ${success ? 'Success' : 'Failed'}`);
            }
        }
        catch (error) {
            if (this.node) {
                this.node.warn(`❌ LOG SYNC ERROR: ${schedule.name} | ${error.message}`);
            }
        }
    }
    // ==================== HTTP NOTIFICATION ====================
    /**
     * Send notification to backend via HTTP API
     */
    async sendNotificationToBackend(schedule, action, success = true, options) {
        var _a;
        const { maxRetries = 3, baseDelay = 1000, timeout = 10000 } = options || {};
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
        let message;
        let messageKey = null;
        let messageParams = null;
        const retryCount = ((_a = this.globalHelper) === null || _a === void 0 ? void 0 : _a.getEnvVar('MODBUS_MAX_RETRIES', 3)) || 3;
        if (isStart) {
            if (success) {
                message = `Lịch trình "${schedule.label || schedule.name}" đã bắt đầu chạy thành công`;
                messageKey = 'iot.notification.schedule.started';
                messageParams = { scheduleName: schedule.label || schedule.name };
            }
            else {
                message = `Lịch trình "${schedule.label || schedule.name}" không thể bắt đầu - Lỗi ghi Modbus sau ${retryCount} lần retry`;
                messageKey = 'iot.notification.schedule.failed';
                messageParams = { scheduleName: schedule.label || schedule.name, retryCount };
            }
        }
        else {
            if (success) {
                message = `Lịch trình "${schedule.label || schedule.name}" đã hoàn thành`;
                messageKey = 'iot.notification.schedule.completed';
                messageParams = { scheduleName: schedule.label || schedule.name };
            }
            else {
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
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios_1.default.post(url, payload, {
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
            }
            catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    const delayMs = baseDelay * Math.pow(2, attempt - 1);
                    this.debugLog(`HTTP notification retry ${attempt}/${maxRetries} in ${delayMs}ms`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        }
        if (this.node) {
            this.node.warn(`❌ HTTP NOTIFICATION FAILED: ${schedule.name} | ${lastError === null || lastError === void 0 ? void 0 : lastError.message}`);
        }
        return false;
    }
}
exports.ScheduleStatusService = ScheduleStatusService;

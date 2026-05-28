"use strict";
/**
 * Schedule Trigger Service V2
 * Responsibility: Check timing and determine which schedules are due
 *
 * This service extracts the timing/due checking logic from the original ScheduleExecutor
 * It focuses ONLY on determining which schedules should run based on time
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleTriggerService = void 0;
const schedule_utils_1 = require("../common/schedule-utils");
const dataSource_1 = require("../../../orm/dataSource");
const global_context_helper_1 = require("../../../ultils/global-context-helper");
const moment_1 = __importDefault(require("moment"));
class ScheduleTriggerService {
    constructor(node, debugEnable = false) {
        this.node = node;
        this.debugEnable = debugEnable;
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
    }
    /**
     * Debug logging helper
     */
    debugLog(message) {
        if (this.debugEnable) {
            this.node.warn(message);
        }
    }
    /**
     * Get all enabled schedules from database
     * @returns Array of enabled schedules
     */
    async getDueSchedules() {
        try {
            if (!dataSource_1.AppDataSource.isInitialized) {
                this.debugLog("Initializing AppDataSource...");
                await dataSource_1.AppDataSource.initialize();
                this.debugLog("AppDataSource initialized successfully");
            }
            // Get device_id from global variable
            const deviceId = this.globalHelper.getEnvVar("DEVICE_ID", "");
            if (!deviceId) {
                this.node.warn("No DEVICE_ID found in global variable, returning empty schedules");
                return [];
            }
            const repository = dataSource_1.AppDataSource.getRepository('TabiotSchedule');
            const schedules = await repository
                .createQueryBuilder("schedule")
                .leftJoin("tabiot_device", "device", "schedule.device_id = device.name")
                .leftJoin("schedule.schedulePlan", "schedulePlan")
                .addSelect("device.label", "device_label")
                .where("schedule.enable = :enable", { enable: 1 })
                .andWhere("schedulePlan.enable = :planEnable", { planEnable: 1 })
                .andWhere("schedule.is_deleted = :isDeleted", { isDeleted: 0 })
                .andWhere("schedule.device_id = :deviceId", { deviceId: deviceId })
                .getMany();
            this.debugLog(`Retrieved ${schedules.length} schedules from DB for device_id: ${deviceId}`);
            return schedules;
        }
        catch (error) {
            console.error(`Error in getDueSchedules: ${error.message}`);
            return [];
        }
    }
    /**
     * Check if a single schedule is due
     * @param schedule - Schedule to check
     * @returns true if schedule should execute
     */
    checkScheduleDue(schedule) {
        return (0, schedule_utils_1.isScheduleDue)(schedule, this.debugEnable ? (msg) => this.node.warn(msg) : undefined);
    }
    /**
     * Filter schedules to find which ones are currently due
     * @param schedules - Array of schedules to check
     * @returns Array of schedules that are currently due
     */
    filterDueSchedules(schedules) {
        const dueSchedules = [];
        for (const schedule of schedules) {
            if (this.checkScheduleDue(schedule)) {
                dueSchedules.push(schedule);
                this.debugLog(`✓ Schedule ${schedule.name} is DUE`);
            }
            else {
                this.debugLog(`✗ Schedule ${schedule.name} is not due`);
            }
        }
        return dueSchedules;
    }
    /**
     * Check last check timestamps to avoid duplicate triggers
     * @param scheduleName - Name of schedule to check
     * @param checkIntervalMinutes - Minimum interval between checks
     * @returns true if schedule can be checked again
     */
    canCheckSchedule(scheduleName, checkIntervalMinutes = 1) {
        const globalContext = this.node.context().global;
        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
        const now = (0, schedule_utils_1.getCurrentTimestamp)();
        const lastCheck = lastCheckTimestamps[scheduleName] || 0;
        const minInterval = checkIntervalMinutes * 60 * 1000;
        if (now - lastCheck < minInterval) {
            this.debugLog(`Schedule ${scheduleName} checked too recently (${Math.floor((now - lastCheck) / 1000)}s ago)`);
            return false;
        }
        return true;
    }
    /**
     * Update last check timestamp for a schedule
     * @param scheduleName - Name of schedule
     */
    updateLastCheckTimestamp(scheduleName) {
        const globalContext = this.node.context().global;
        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
        lastCheckTimestamps[scheduleName] = (0, schedule_utils_1.getCurrentTimestamp)();
        globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
    }
    /**
     * Main trigger check - get all due schedules
     * This is the primary entry point for the trigger node
     * @param checkIntervalMinutes - Minimum interval between checks
     * @returns ScheduleTriggerOutput with due schedules
     */
    async checkTriggers(checkIntervalMinutes = 1) {
        const timestamp = (0, schedule_utils_1.getCurrentTimestamp)();
        // Get all enabled schedules
        const allSchedules = await this.getDueSchedules();
        // Filter to only due schedules
        const dueSchedules = this.filterDueSchedules(allSchedules);
        // Update timestamps for due schedules
        dueSchedules.forEach(schedule => {
            this.updateLastCheckTimestamp(schedule.name);
        });
        this.debugLog(`Trigger check complete: ${dueSchedules.length}/${allSchedules.length} schedules are due`);
        return {
            schedules: dueSchedules,
            timestamp,
            checkInterval: checkIntervalMinutes
        };
    }
    /**
     * Clear last check timestamp for a schedule (e.g., when schedule is disabled)
     * @param scheduleName - Name of schedule
     */
    clearLastCheckTimestamp(scheduleName) {
        const globalContext = this.node.context().global;
        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
        if (lastCheckTimestamps[scheduleName]) {
            delete lastCheckTimestamps[scheduleName];
            globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
            this.debugLog(`Cleared last check timestamp for ${scheduleName}`);
        }
    }
    /**
     * Clear all last check timestamps (useful for testing or reset)
     */
    clearAllTimestamps() {
        const globalContext = this.node.context().global;
        globalContext.set("scheduleLastCheckTimestamps", {});
        this.debugLog("Cleared all last check timestamps");
    }
    // ==================== STUCK SCHEDULE RECOVERY ====================
    /**
     * Check for schedules that are "running" but past their end time (stuck).
     * Returns array of schedules that need recovery (status change to "finished").
     * The actual Modbus reset is handled by downstream nodes.
     */
    async checkAndRecoverStuckSchedules() {
        var _a;
        try {
            const allSchedules = await this.getDueSchedules();
            const globalContext = this.node.context().global;
            const activeCommands = globalContext.get("activeModbusCommands") || {};
            const recoveredSchedules = [];
            // Also check all schedules (not just enabled) for stuck "running" status
            if (!dataSource_1.AppDataSource.isInitialized) {
                await dataSource_1.AppDataSource.initialize();
            }
            const repository = dataSource_1.AppDataSource.getRepository('TabiotSchedule');
            const runningSchedules = await repository
                .createQueryBuilder("schedule")
                .where("schedule.status = :status", { status: "running" })
                .andWhere("schedule.is_deleted = :isDeleted", { isDeleted: 0 })
                .getMany();
            const now = (0, moment_1.default)().utc().add(7, 'hours');
            for (const schedule of runningSchedules) {
                if (!schedule.end_time)
                    continue;
                const endTime = (0, moment_1.default)(schedule.end_time, "HH:mm:ss");
                const today = now.clone().startOf('day');
                let endDateTime = today.clone().set({
                    hour: endTime.hour(),
                    minute: endTime.minute(),
                    second: endTime.second(),
                });
                // Handle cross-midnight
                if (endDateTime.isBefore(today.clone().set({ hour: 0, minute: 0, second: 0 }))) {
                    endDateTime.add(1, 'day');
                }
                // Add 2-minute grace period
                const graceEndTime = endDateTime.clone().add(2, 'minutes');
                if (now.isAfter(graceEndTime)) {
                    // Schedule is past end time + grace period
                    const hasActiveCommands = ((_a = activeCommands[schedule.name]) === null || _a === void 0 ? void 0 : _a.length) > 0;
                    if (!hasActiveCommands) {
                        // No active commands = stuck after power outage or error
                        this.debugLog(`🔄 STUCK RECOVERY: ${schedule.name} is "running" but has no active commands past end time`);
                        schedule.status = "finished";
                        schedule.enable = 0;
                        recoveredSchedules.push(schedule);
                    }
                    else {
                        // Has active commands but past end time for > 3 minutes
                        const threeMinPastEnd = endDateTime.clone().add(3, 'minutes');
                        if (now.isAfter(threeMinPastEnd)) {
                            this.debugLog(`🔄 STUCK RECOVERY: ${schedule.name} is "running" for 3+ minutes past end time`);
                            schedule.status = "finished";
                            schedule.enable = 0;
                            recoveredSchedules.push(schedule);
                        }
                    }
                }
            }
            if (recoveredSchedules.length > 0) {
                this.node.warn(`🔄 RECOVERY: Found ${recoveredSchedules.length} stuck schedule(s) to recover`);
            }
            return recoveredSchedules;
        }
        catch (error) {
            console.error(`Error in checkAndRecoverStuckSchedules: ${error.message}`);
            return [];
        }
    }
}
exports.ScheduleTriggerService = ScheduleTriggerService;

/**
 * Schedule Trigger Service V2
 * Responsibility: Check timing and determine which schedules are due
 * 
 * This service extracts the timing/due checking logic from the original ScheduleExecutor
 * It focuses ONLY on determining which schedules should run based on time
 */

import { ScheduleTriggerOutput, TabiotSchedule } from "../common/types";
import { isScheduleDue, getCurrentTimestamp } from "../common/schedule-utils";
import { AppDataSource } from "../../../orm/dataSource";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";
import { Node } from "node-red";
import { Repository } from "typeorm";

export class ScheduleTriggerService {
    private node: Node;
    private globalHelper: GlobalContextHelper;
    private debugEnable: boolean;

    constructor(node: Node, debugEnable: boolean = false) {
        this.node = node;
        this.debugEnable = debugEnable;
        this.globalHelper = new GlobalContextHelper(node.context());
    }

    /**
     * Debug logging helper
     */
    private debugLog(message: string): void {
        if (this.debugEnable) {
            this.node.warn(message);
        }
    }

    /**
     * Get all enabled schedules from database
     * @returns Array of enabled schedules
     */
    async getDueSchedules(): Promise<TabiotSchedule[]> {
        try {
            if (!AppDataSource.isInitialized) {
                this.debugLog("Initializing AppDataSource...");
                await AppDataSource.initialize();
                this.debugLog("AppDataSource initialized successfully");
            }

            // Get device_id from global variable
            const deviceId = this.globalHelper.getEnvVar("DEVICE_ID", "");
            if (!deviceId) {
                this.node.warn("No DEVICE_ID found in global variable, returning empty schedules");
                return [];
            }

            const repository: Repository<any> = AppDataSource.getRepository('TabiotSchedule' as any);
            const schedules: any[] = await repository
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
            return schedules as TabiotSchedule[];
        } catch (error) {
            console.error(`Error in getDueSchedules: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Check if a single schedule is due
     * @param schedule - Schedule to check
     * @returns true if schedule should execute
     */
    checkScheduleDue(schedule: TabiotSchedule): boolean {
        return isScheduleDue(schedule, this.debugEnable ? (msg) => this.node.warn(msg) : undefined);
    }

    /**
     * Filter schedules to find which ones are currently due
     * @param schedules - Array of schedules to check
     * @returns Array of schedules that are currently due
     */
    filterDueSchedules(schedules: TabiotSchedule[]): TabiotSchedule[] {
        const dueSchedules: TabiotSchedule[] = [];

        for (const schedule of schedules) {
            if (this.checkScheduleDue(schedule)) {
                dueSchedules.push(schedule);
                this.debugLog(`✓ Schedule ${schedule.name} is DUE`);
            } else {
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
    canCheckSchedule(scheduleName: string, checkIntervalMinutes: number = 1): boolean {
        const globalContext = this.node.context().global;
        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
        const now = getCurrentTimestamp();
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
    updateLastCheckTimestamp(scheduleName: string): void {
        const globalContext = this.node.context().global;
        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
        lastCheckTimestamps[scheduleName] = getCurrentTimestamp();
        globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
    }

    /**
     * Main trigger check - get all due schedules
     * This is the primary entry point for the trigger node
     * @param checkIntervalMinutes - Minimum interval between checks
     * @returns ScheduleTriggerOutput with due schedules
     */
    async checkTriggers(checkIntervalMinutes: number = 1): Promise<ScheduleTriggerOutput> {
        const timestamp = getCurrentTimestamp();
        
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
    clearLastCheckTimestamp(scheduleName: string): void {
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
    clearAllTimestamps(): void {
        const globalContext = this.node.context().global;
        globalContext.set("scheduleLastCheckTimestamps", {});
        this.debugLog("Cleared all last check timestamps");
    }
}

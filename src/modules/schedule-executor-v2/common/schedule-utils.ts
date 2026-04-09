/**
 * Shared utility functions for Schedule Executor V2
 * Includes cron parsing, schedule due checking, and time utilities
 */

import moment from "moment";
import { TabiotSchedule } from "./types";

/**
 * Check if a value is falsy (should be skipped during schedule execution)
 * Falsy values: 0, "0", false, "false", null, undefined, ""
 */
export function isFalsyValue(value: any): boolean {
    // Explicit null/undefined check
    if (value === null || value === undefined) {
        return true;
    }

    // Empty string check
    if (value === "") {
        return true;
    }

    // Boolean check (including string "false")
    if (value === false || value === "false") {
        return true;
    }

    // Number check (including 0 and "0")
    if (value === 0 || value === "0") {
        return true;
    }

    // For string numbers like "0.0", "0.00", etc.
    if (typeof value === 'string') {
        const trimmed = value.trim();
        // Check if it's a numeric string that equals 0
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            const num = parseFloat(trimmed);
            if (num === 0) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Check if a schedule is due based on time, date, and interval
 * @param schedule - The schedule to check
 * @param debugLog - Optional debug logging function
 * @returns true if schedule should execute
 */
export function isScheduleDue(schedule: TabiotSchedule, debugLog?: (msg: string) => void): boolean {
    const log = debugLog || (() => {});

    try {
        if (!schedule.start_time || !schedule.end_time) {
            console.warn(`Schedule ${schedule.name} missing start_time or end_time`);
            return false;
        }

        if (schedule.enable !== 1) {
            log(`Schedule ${schedule.name} is not enabled`);
            return false;
        }

        // Get current time in UTC+7
        const now = moment().utc().add(7, 'hours');
        const today = now.clone().startOf('day');

        // Check date range if specified
        if (schedule.start_date && schedule.end_date) {
            const startDate = moment(schedule.start_date, "YYYY-MM-DD");
            const endDate = moment(schedule.end_date, "YYYY-MM-DD");
            if (!now.isBetween(startDate, endDate, 'day', '[]')) {
                log(`Schedule ${schedule.name} is outside enabled range (${startDate.format('YYYY-MM-DD')} - ${endDate.format('YYYY-MM-DD')})`);
                return false;
            }
        }

        // Check interval (day of week)
        if (schedule.interval && schedule.interval.trim() !== '') {
            const currentDayOfWeek = now.day(); // 0=Sunday, 1=Monday, ..., 6=Saturday
            let allowedDays: number[] = [];

            try {
                const trimmedInterval = schedule.interval.trim();

                if (trimmedInterval.startsWith('[') && trimmedInterval.endsWith(']')) {
                    // JSON array format
                    allowedDays = JSON.parse(trimmedInterval);
                } else if (trimmedInterval.includes(',')) {
                    // Comma-separated format
                    allowedDays = trimmedInterval.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                } else {
                    // Single number format
                    const dayNum = parseInt(trimmedInterval);
                    if (!isNaN(dayNum)) {
                        allowedDays = [dayNum];
                    }
                }

                // Check if current day is in allowed days
                if (allowedDays.length > 0 && !allowedDays.includes(currentDayOfWeek)) {
                    log(`Schedule ${schedule.name} skipped: current day ${currentDayOfWeek} not in interval ${JSON.stringify(allowedDays)}`);
                    return false;
                }

                log(`Schedule ${schedule.name} interval check passed: day ${currentDayOfWeek} in ${JSON.stringify(allowedDays)}`);
            } catch (error) {
                console.error(`Error parsing interval for schedule ${schedule.name}: ${(error as Error).message}`);
                // If parse fails, allow schedule to run (fallback)
            }
        }

        // Parse start_time and end_time
        const startTime = moment(schedule.start_time, "HH:mm:ss");
        const endTime = moment(schedule.end_time, "HH:mm:ss");

        // Assign date to startTime and endTime
        let startDateTime = today.clone().set({
            hour: startTime.hour(),
            minute: startTime.minute(),
            second: startTime.second(),
        });
        let endDateTime = today.clone().set({
            hour: endTime.hour(),
            minute: endTime.minute(),
            second: endTime.second(),
        });

        // Handle cross-midnight schedules
        if (startDateTime.isAfter(endDateTime)) {
            if (now.isBefore(endDateTime)) {
                // Current time is after midnight but before endTime, schedule started yesterday
                startDateTime.subtract(1, 'day');
            } else {
                // Current time is after startTime, endTime is tomorrow
                endDateTime.add(1, 'day');
            }
        }

        // Check if current time is within range [start, end)
        const isDue = now.isBetween(startDateTime, endDateTime, undefined, "[)");
        log(`Schedule ${schedule.name} isDue: ${isDue}`);
        return isDue;
    } catch (error) {
        console.error(`Error in isScheduleDue for ${schedule.name}: ${(error as Error).message}`);
        return false;
    }
}

/**
 * Normalize string numbers to actual numbers
 * Handles formats like "1,800.00", "1800", "1800.25"
 */
export function normalizeNumericValue(val: any): any {
    if (typeof val === 'string') {
        const trimmed = val.trim();
        // Match e.g. "1,800.00", "1800", "1800.25"
        if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) {
            const num = parseFloat(trimmed.replace(/,/g, ''));
            if (!isNaN(num)) {
                return num;
            }
        }
    }
    return val;
}

/**
 * Calculate duration in seconds between two time strings
 * @param startTime - Start time in HH:mm:ss format
 * @param endTime - End time in HH:mm:ss format
 * @returns Duration in seconds
 */
export function calculateDurationSeconds(startTime: string, endTime: string): number {
    const startMoment = moment(startTime, "HH:mm:ss");
    const endMoment = moment(endTime, "HH:mm:ss");
    let diff = endMoment.diff(startMoment, 'seconds');

    // Handle cross-midnight
    if (diff < 0) {
        diff += 24 * 3600;
    }

    return diff;
}

/**
 * Get current timestamp
 */
export function getCurrentTimestamp(): number {
    return Date.now();
}

/**
 * Sleep/delay utility
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after delay
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

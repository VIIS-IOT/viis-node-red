"use strict";
/**
 * Shared utility functions for Schedule Executor V2
 * Includes cron parsing, schedule due checking, and time utilities
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFalsyValue = isFalsyValue;
exports.isScheduleDue = isScheduleDue;
exports.normalizeNumericValue = normalizeNumericValue;
exports.calculateDurationSeconds = calculateDurationSeconds;
exports.getCurrentTimestamp = getCurrentTimestamp;
exports.delay = delay;
const moment_1 = __importDefault(require("moment"));
const farm_time_1 = require("../../../core/farm-time");
const schedule_run_window_1 = require("../../../core/schedule-run-window");
/**
 * Check if a value is falsy (should be skipped during schedule execution)
 * Falsy values: 0, "0", false, "false", null, undefined, ""
 */
function isFalsyValue(value) {
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
 * Check if a schedule is due. Same rule as executor v1 and the mobile app: start/end time, the
 * schedule's and the plan's date ranges, and the weekday of the day the window starts
 * (see core/schedule-run-window.ts).
 * @param schedule - The schedule to check (with its schedulePlan loaded)
 * @param debugLog - Optional debug logging function
 * @returns true if schedule should execute
 */
function isScheduleDue(schedule, debugLog) {
    var _a;
    const log = debugLog || (() => { });
    try {
        if (schedule.enable !== 1) {
            log(`Schedule ${schedule.name} is not enabled`);
            return false;
        }
        const decision = (0, schedule_run_window_1.evaluateScheduleRun)(schedule, (_a = schedule.schedulePlan) !== null && _a !== void 0 ? _a : null, (0, farm_time_1.unixMsNow)());
        if ('reason' in decision && decision.reason === 'missing_time') {
            console.warn(`Schedule ${schedule.name} missing start_time or end_time`);
        }
        log(`Schedule ${schedule.name} isDue: ${JSON.stringify(decision)}`);
        return decision.due;
    }
    catch (error) {
        console.error(`Error in isScheduleDue for ${schedule.name}: ${error.message}`);
        return false;
    }
}
/**
 * Normalize string numbers to actual numbers
 * Handles formats like "1,800.00", "1800", "1800.25"
 */
function normalizeNumericValue(val) {
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
function calculateDurationSeconds(startTime, endTime) {
    const startMoment = (0, moment_1.default)(startTime, "HH:mm:ss");
    const endMoment = (0, moment_1.default)(endTime, "HH:mm:ss");
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
function getCurrentTimestamp() {
    return Date.now();
}
/**
 * Sleep/delay utility
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after delay
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

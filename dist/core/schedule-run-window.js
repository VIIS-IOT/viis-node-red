"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.civilDateOnly = civilDateOnly;
exports.civilTimeOnly = civilTimeOnly;
exports.parseIntervalDays = parseIntervalDays;
exports.evaluateScheduleRun = evaluateScheduleRun;
const farm_time_1 = require("./farm-time");
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
const TIME_PART = /(\d{2}:\d{2}:\d{2})/;
/** `YYYY-MM-DD` from a DATE column value (string or Date), '' when absent or unreadable. */
function civilDateOnly(value) {
    if (value == null || value === '')
        return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const match = String(value).match(DATE_PREFIX);
    return match ? match[1] : '';
}
/** `HH:mm:ss` from a TIME column value, '' when absent. */
function civilTimeOnly(value) {
    if (value == null || value === '')
        return '';
    const match = String(value).match(TIME_PART);
    return match ? match[1] : String(value);
}
/** Weekdays (0 = Sunday) allowed by `interval`; an empty list means every day. */
function parseIntervalDays(interval) {
    const trimmed = (interval || '').trim();
    if (!trimmed)
        return [];
    try {
        if (trimmed.startsWith('[') && trimmed.endsWith(']'))
            return JSON.parse(trimmed);
        if (trimmed.includes(',')) {
            return trimmed.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        }
        const day = parseInt(trimmed);
        return isNaN(day) ? [] : [day];
    }
    catch (error) {
        // Unreadable interval: run every day, but say so — it is a configuration error.
        console.error(`Error parsing interval "${trimmed}": ${error.message}`);
        return [];
    }
}
function inDateRange(date, start, end) {
    const first = civilDateOnly(start);
    if (first && date < first)
        return false;
    const last = civilDateOnly(end);
    if (last && date > last)
        return false;
    return true;
}
function weekdayOf(date) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
/** The farm date on which the window containing `nowMs` started, or null when now is outside every window. */
function windowStartDate(nowMs, startTime, endTime, tz) {
    const today = (0, farm_time_1.unixMsToCivil)(nowMs, tz).date;
    const todays = (0, farm_time_1.plannedWindowUnixMs)(today, startTime, endTime, tz);
    if (nowMs >= todays.startMs && nowMs < todays.endMs)
        return today;
    if (endTime <= startTime) {
        const yesterday = (0, farm_time_1.unixMsToCivil)((0, farm_time_1.civilToUnixMs)(today, '12:00:00', tz) - 24 * 60 * 60 * 1000, tz).date;
        const yesterdays = (0, farm_time_1.plannedWindowUnixMs)(yesterday, startTime, endTime, tz);
        if (nowMs >= yesterdays.startMs && nowMs < yesterdays.endMs)
            return yesterday;
    }
    return null;
}
function evaluateScheduleRun(schedule, plan, nowMs, tz = farm_time_1.DEFAULT_FARM_TIMEZONE) {
    const startTime = civilTimeOnly(schedule.start_time);
    const endTime = civilTimeOnly(schedule.end_time);
    if (!startTime || !endTime)
        return { due: false, reason: 'missing_time' };
    const runDate = windowStartDate(nowMs, startTime, endTime, tz);
    if (!runDate)
        return { due: false, reason: 'outside_window' };
    if (!inDateRange(runDate, schedule.start_date, schedule.end_date))
        return { due: false, reason: 'schedule_dates' };
    if (plan && !inDateRange(runDate, plan.start_date, plan.end_date))
        return { due: false, reason: 'plan_dates' };
    const days = parseIntervalDays(schedule.interval);
    if (days.length > 0 && !days.includes(weekdayOf(runDate)))
        return { due: false, reason: 'weekday' };
    return { due: true, runDate };
}

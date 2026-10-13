import { DEFAULT_FARM_TIMEZONE, civilToUnixMs, plannedWindowUnixMs, unixMsToCivil } from './farm-time';

/**
 * Whether a schedule runs now — the single rule shared by the executors and mirrored by the mobile app.
 *
 * A run is the window [start_time, end_time) that starts on farm date D (end <= start ends on D + 1,
 * end == start is 24 h). It runs when D is inside the schedule's own date range AND the plan's date
 * range (inclusive; a missing bound is open on that side) and D's weekday is in `interval`.
 * Enable flags are the caller's job (the query already filters schedule and plan `enable`).
 */

export interface ScheduleRunFields {
    start_time?: string | null;
    end_time?: string | null;
    start_date?: unknown;
    end_date?: unknown;
    interval?: string | null;
}

export interface PlanDateRange {
    start_date?: unknown;
    end_date?: unknown;
}

export type ScheduleRunDecision =
    | { due: true; runDate: string }
    | { due: false; reason: 'missing_time' | 'outside_window' | 'schedule_dates' | 'plan_dates' | 'weekday' };

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
const TIME_PART = /(\d{2}:\d{2}:\d{2})/;

/** `YYYY-MM-DD` from a DATE column value (string or Date), '' when absent or unreadable. */
export function civilDateOnly(value: unknown): string {
    if (value == null || value === '') return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const match = String(value).match(DATE_PREFIX);
    return match ? match[1] : '';
}

/** `HH:mm:ss` from a TIME column value, '' when absent. */
export function civilTimeOnly(value: unknown): string {
    if (value == null || value === '') return '';
    const match = String(value).match(TIME_PART);
    return match ? match[1] : String(value);
}

/** Weekdays (0 = Sunday) allowed by `interval`; an empty list means every day. */
export function parseIntervalDays(interval: string | null | undefined): number[] {
    const trimmed = (interval || '').trim();
    if (!trimmed) return [];
    try {
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) return JSON.parse(trimmed);
        if (trimmed.includes(',')) {
            return trimmed.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        }
        const day = parseInt(trimmed);
        return isNaN(day) ? [] : [day];
    } catch (error) {
        // Unreadable interval: run every day, but say so — it is a configuration error.
        console.error(`Error parsing interval "${trimmed}": ${(error as Error).message}`);
        return [];
    }
}

function inDateRange(date: string, start: unknown, end: unknown): boolean {
    const first = civilDateOnly(start);
    if (first && date < first) return false;
    const last = civilDateOnly(end);
    if (last && date > last) return false;
    return true;
}

function weekdayOf(date: string): number {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The farm date on which the window containing `nowMs` started, or null when now is outside every window. */
function windowStartDate(nowMs: number, startTime: string, endTime: string, tz: string): string | null {
    const today = unixMsToCivil(nowMs, tz).date;
    const todays = plannedWindowUnixMs(today, startTime, endTime, tz);
    if (nowMs >= todays.startMs && nowMs < todays.endMs) return today;
    if (endTime <= startTime) {
        const yesterday = unixMsToCivil(civilToUnixMs(today, '12:00:00', tz) - 24 * 60 * 60 * 1000, tz).date;
        const yesterdays = plannedWindowUnixMs(yesterday, startTime, endTime, tz);
        if (nowMs >= yesterdays.startMs && nowMs < yesterdays.endMs) return yesterday;
    }
    return null;
}

export function evaluateScheduleRun(
    schedule: ScheduleRunFields,
    plan: PlanDateRange | null | undefined,
    nowMs: number,
    tz: string = DEFAULT_FARM_TIMEZONE,
): ScheduleRunDecision {
    const startTime = civilTimeOnly(schedule.start_time);
    const endTime = civilTimeOnly(schedule.end_time);
    if (!startTime || !endTime) return { due: false, reason: 'missing_time' };

    const runDate = windowStartDate(nowMs, startTime, endTime, tz);
    if (!runDate) return { due: false, reason: 'outside_window' };
    if (!inDateRange(runDate, schedule.start_date, schedule.end_date)) return { due: false, reason: 'schedule_dates' };
    if (plan && !inDateRange(runDate, plan.start_date, plan.end_date)) return { due: false, reason: 'plan_dates' };

    const days = parseIntervalDays(schedule.interval);
    if (days.length > 0 && !days.includes(weekdayOf(runDate))) return { due: false, reason: 'weekday' };

    return { due: true, runDate };
}

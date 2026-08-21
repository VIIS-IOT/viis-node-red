"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FARM_TIMEZONE = void 0;
exports.unixMsNow = unixMsNow;
exports.unixMsToCivil = unixMsToCivil;
exports.civilToUnixMs = civilToUnixMs;
exports.civilNow = civilNow;
exports.plannedWindowUnixMs = plannedWindowUnixMs;
exports.isoUtcToMysqlUtcDatetime = isoUtcToMysqlUtcDatetime;
exports.mysqlUtcDatetimeToIso = mysqlUtcDatetimeToIso;
exports.debugClocks = debugClocks;
exports.DEFAULT_FARM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const WEEKDAY = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};
function pad(n) {
    return String(n).padStart(2, '0');
}
function parseTime(time) {
    const [h, m, rawS] = String(time || '00:00:00').split(':');
    return { h: Number(h) || 0, m: Number(m) || 0, s: Math.floor(Number(rawS) || 0) };
}
function formatHhmmss(h, m, s) {
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function formatParts(ms, tz) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
    });
    const map = {};
    for (const part of dtf.formatToParts(new Date(ms))) {
        if (part.type !== 'literal')
            map[part.type] = part.value;
    }
    return map;
}
function offsetMsAt(ms, tz) {
    const p = formatParts(ms, tz);
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    return asUtc - ms;
}
function unixMsNow() {
    return Date.now();
}
function unixMsToCivil(ms, tz = exports.DEFAULT_FARM_TIMEZONE) {
    const p = formatParts(ms, tz);
    return {
        date: `${p.year}-${p.month}-${p.day}`,
        time: formatHhmmss(Number(p.hour), Number(p.minute), Number(p.second)),
    };
}
function civilToUnixMs(date, time, tz = exports.DEFAULT_FARM_TIMEZONE) {
    const [year, month, day] = String(date).split('-').map(Number);
    const { h, m, s } = parseTime(time);
    const utcGuess = Date.UTC(year, month - 1, day, h, m, s);
    let result = utcGuess - offsetMsAt(utcGuess, tz);
    const check = unixMsToCivil(result, tz);
    const wantTime = formatHhmmss(h, m, s);
    if (check.date !== date || check.time !== wantTime) {
        result = utcGuess - offsetMsAt(result, tz);
    }
    return result;
}
function civilNow(tz = exports.DEFAULT_FARM_TIMEZONE) {
    var _a;
    const ms = unixMsNow();
    const { date, time } = unixMsToCivil(ms, tz);
    const weekdayName = formatParts(ms, tz).weekday || 'Sun';
    return { date, time, weekday: (_a = WEEKDAY[weekdayName]) !== null && _a !== void 0 ? _a : 0 };
}
function nextFarmDate(date, tz) {
    const noon = civilToUnixMs(date, '12:00:00', tz);
    return unixMsToCivil(noon + 24 * 60 * 60 * 1000, tz).date;
}
function plannedWindowUnixMs(date, startTime, endTime, tz = exports.DEFAULT_FARM_TIMEZONE) {
    const startNorm = formatHhmmss(parseTime(startTime).h, parseTime(startTime).m, parseTime(startTime).s);
    const endNorm = formatHhmmss(parseTime(endTime).h, parseTime(endTime).m, parseTime(endTime).s);
    const startMs = civilToUnixMs(date, startTime, tz);
    const endDate = endNorm <= startNorm ? nextFarmDate(date, tz) : date;
    return { startMs, endMs: civilToUnixMs(endDate, endTime, tz) };
}
function isoUtcToMysqlUtcDatetime(value) {
    if (value === null || value === undefined || value === '')
        return null;
    if (value instanceof Date)
        return isoUtcToMysqlUtcDatetime(value.toISOString());
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw))
        return raw.slice(0, 19);
    const withoutZone = raw.replace('T', ' ').replace(/Z$/i, '');
    return withoutZone.split('.')[0];
}
function mysqlUtcDatetimeToIso(value) {
    if (value === null || value === undefined || value === '')
        return null;
    if (value instanceof Date)
        return value.toISOString();
    const raw = String(value).trim();
    if (/T.*Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw))
        return new Date(raw).toISOString();
    const naive = raw.includes('T') ? raw : raw.replace(' ', 'T');
    return new Date(`${naive}Z`).toISOString();
}
function debugClocks(ms, tz = exports.DEFAULT_FARM_TIMEZONE) {
    const utc = new Date(ms).toISOString();
    const civil = unixMsToCivil(ms, tz);
    const offsetHours = Math.round(offsetMsAt(ms, tz) / 3600000);
    const sign = offsetHours >= 0 ? '+' : '-';
    return `utc=${utc} farm=${civil.date} ${civil.time}${sign}${pad(Math.abs(offsetHours))}`;
}

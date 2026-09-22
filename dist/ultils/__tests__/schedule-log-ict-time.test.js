"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const moment_1 = __importDefault(require("moment"));
const schedule_log_ict_time_1 = require("../schedule-log-ict-time");
describe('buildScheduleLogIctDateTime', () => {
    it('writes naive ICT wall, not ISO-Z', () => {
        const now = moment_1.default.utc('2026-09-21T09:05:10.000Z');
        expect((0, schedule_log_ict_time_1.buildScheduleLogIctDateTime)('16:05:00', now)).toBe('2026-09-21 16:05:00');
        expect((0, schedule_log_ict_time_1.buildScheduleLogIctDateTime)('16:07', now)).toBe('2026-09-21 16:07:00');
    });
    it('does not emit a trailing Z', () => {
        const value = (0, schedule_log_ict_time_1.buildScheduleLogIctDateTime)('08:00:00', moment_1.default.utc('2026-09-22T01:00:00.000Z'));
        expect(value).toBe('2026-09-22 08:00:00');
        expect(value.includes('Z')).toBe(false);
        expect(value.includes('T')).toBe(false);
    });
});
describe('normalizeScheduleClock', () => {
    it('pads HH:mm to HH:mm:ss', () => {
        expect((0, schedule_log_ict_time_1.normalizeScheduleClock)('16:05')).toBe('16:05:00');
    });
});

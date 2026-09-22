"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_LOG_ICT_WALL_FORMAT = exports.SCHEDULE_LOG_ICT_OFFSET_HOURS = void 0;
exports.ictNow = ictNow;
exports.normalizeScheduleClock = normalizeScheduleClock;
exports.buildScheduleLogIctDateTime = buildScheduleLogIctDateTime;
const moment_1 = __importDefault(require("moment"));
/** Same UTC+7 clock the executor uses to decide whether a schedule is due. */
exports.SCHEDULE_LOG_ICT_OFFSET_HOURS = 7;
exports.SCHEDULE_LOG_ICT_WALL_FORMAT = 'YYYY-MM-DD HH:mm:ss';
function ictNow(now) {
    return (now ? now.clone() : (0, moment_1.default)()).utc().add(exports.SCHEDULE_LOG_ICT_OFFSET_HOURS, 'hours');
}
function normalizeScheduleClock(clock) {
    const parsed = (0, moment_1.default)(clock || '00:00:00', ['HH:mm:ss', 'HH:mm'], true);
    return parsed.isValid() ? parsed.format('HH:mm:ss') : '00:00:00';
}
/**
 * Naive ICT datetime for tabiot_schedule_log.start_time / end_time.
 * Do not use toISOString() — that tags the ICT clock with Z and breaks TB avg queries.
 */
function buildScheduleLogIctDateTime(clock, now) {
    return `${ictNow(now).format('YYYY-MM-DD')} ${normalizeScheduleClock(clock)}`;
}

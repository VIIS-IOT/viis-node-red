"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUE_SCHEDULE_CONDITION = void 0;
exports.isScheduleRunnable = isScheduleRunnable;
exports.isOrphanRunningSchedule = isOrphanRunningSchedule;
/**
 * Whether a schedule may run at all: it and its plan are enabled and neither is deleted. A running schedule that
 * stops being runnable (plan deleted, program disabled) is finished by the executor instead of being left ON.
 */
function isScheduleRunnable(schedule) {
    if (schedule.enable !== 1 || schedule.is_deleted === 1)
        return false;
    const plan = schedule.schedulePlan;
    // undefined: the relation was not loaded, so the caller's query already filtered plans. null: no plan row.
    if (plan === undefined)
        return true;
    if (plan === null)
        return false;
    return plan.enable === 1 && plan.is_deleted !== 1;
}
/**
 * A schedule still marked running that is no longer runnable and that this process never started (no active commands,
 * though it has outputs to write). Finishing it would write OFF to outputs another schedule or the farmer may be using,
 * so the executor only marks it finished. Config-only schedules never store commands and take the normal finish path.
 */
function isOrphanRunningSchedule(schedule, activeCommandCount, hasWritableCommands) {
    if (schedule.status !== 'running' || isScheduleRunnable(schedule))
        return false;
    return activeCommandCount === 0 && hasWritableCommands();
}
/**
 * SQL for `getDueSchedules`: runnable schedules, plus running ones so a schedule whose plan was deleted or disabled
 * mid-run still gets its OFF.
 */
exports.DUE_SCHEDULE_CONDITION = "((schedule.enable = 1 AND schedule.is_deleted = 0 AND schedulePlan.enable = 1 " +
    "AND COALESCE(schedulePlan.is_deleted, 0) = 0) OR schedule.status = 'running')";

import { TabiotSchedule } from "../../orm/entities/schedule/TabiotSchedule";

/**
 * Whether a schedule may run at all: it and its plan are enabled and neither is deleted. A running schedule that
 * stops being runnable (plan deleted, program disabled) is finished by the executor instead of being left ON.
 */
export function isScheduleRunnable(schedule: TabiotSchedule): boolean {
    if (schedule.enable !== 1 || schedule.is_deleted === 1) return false;
    const plan = schedule.schedulePlan;
    // undefined: the relation was not loaded, so the caller's query already filtered plans. null: no plan row.
    if (plan === undefined) return true;
    if (plan === null) return false;
    return plan.enable === 1 && plan.is_deleted !== 1;
}

/**
 * SQL for `getDueSchedules`: runnable schedules, plus running ones so a schedule whose plan was deleted or disabled
 * mid-run still gets its OFF.
 */
export const DUE_SCHEDULE_CONDITION =
    "((schedule.enable = 1 AND schedule.is_deleted = 0 AND schedulePlan.enable = 1 " +
    "AND COALESCE(schedulePlan.is_deleted, 0) = 0) OR schedule.status = 'running')";

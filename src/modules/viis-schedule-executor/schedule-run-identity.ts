import { TabiotSchedule } from '../../orm/entities/schedule/TabiotSchedule';

/**
 * ADR-033: every schedule event names its schedule, plan and run. One run keeps the runId its start
 * report was cut with, through verify-fail, finish and stop, so the backend can pair the events.
 */

type ContextStore = {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
};

/** Global-context key: schedule name → runId of its active run. */
export const SCHEDULE_ACTIVE_RUN_IDS_KEY = 'scheduleActiveRunIds';

function readRunIds(store: ContextStore): Record<string, string> {
    return { ...((store.get(SCHEDULE_ACTIVE_RUN_IDS_KEY) as Record<string, string>) || {}) };
}

export function rememberRunId(store: ContextStore, scheduleName: string, runId: string): void {
    const runIds = readRunIds(store);
    runIds[scheduleName] = runId;
    store.set(SCHEDULE_ACTIVE_RUN_IDS_KEY, runIds);
}

export function activeRunId(store: ContextStore, scheduleName: string): string | null {
    return readRunIds(store)[scheduleName] ?? null;
}

export function forgetRunId(store: ContextStore, scheduleName: string): void {
    const runIds = readRunIds(store);
    if (!(scheduleName in runIds)) return;
    delete runIds[scheduleName];
    store.set(SCHEDULE_ACTIVE_RUN_IDS_KEY, runIds);
}

export interface ScheduleEventParams {
    scheduleName: string;
    scheduleId: string;
    planId: string | null;
    runId: string | null;
}

/** `scheduleId` is the backend schedule UUID, which the gateway stores as `name`. */
export function scheduleEventParams(schedule: TabiotSchedule, runId: string | null): ScheduleEventParams {
    return {
        scheduleName: schedule.label || schedule.name,
        scheduleId: schedule.name,
        planId: schedule.schedule_plan_id || null,
        runId: runId ?? null,
    };
}

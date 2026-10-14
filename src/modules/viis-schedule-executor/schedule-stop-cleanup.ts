import { TabiotSchedule } from '../../orm/entities/schedule/TabiotSchedule';
import { activeRunId, forgetRunId } from './schedule-run-identity';

/** Why a run ended before its window (ADR-033 D2). */
export type StopReason = 'schedule_disabled' | 'plan_disabled' | 'deleted' | 'unknown';

type ContextStore = {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
};

export interface StopCleanupDeps {
    /** Live map of schedule name → commands it still holds on the device. */
    activeCommands(): Record<string, unknown[]>;
    /** Turn the commands off; true when every write succeeded. */
    resetCommands(scheduleName: string, commands: unknown[]): Promise<boolean>;
    clearActiveCommands(scheduleName: string): void;
    /** The local schedule row (null when it is gone) and why it left the enabled list. */
    loadStopped(scheduleName: string): Promise<{ schedule: TabiotSchedule | null; reason: StopReason }>;
    /** Mark the run finished locally and on the server. */
    finishSchedule(schedule: TabiotSchedule): Promise<unknown>;
    sendStopped(schedule: TabiotSchedule, reason: StopReason, runId: string | null): Promise<unknown>;
    runIds: ContextStore;
}

/**
 * A schedule that left the enabled list (plan turned off, schedule turned off by sync, deleted)
 * while it still held outputs: turn them off, finish the run and report it as stopped — once,
 * because a successful reset clears its commands. A failed reset keeps the commands and reports
 * nothing; the next tick retries.
 */
export async function stopRunsNoLongerEnabled(
    deps: StopCleanupDeps,
    /** null = the enabled list is unknown (the local query failed): stop nothing this tick. */
    enabledScheduleNames: string[] | null
): Promise<void> {
    if (enabledScheduleNames === null) return;
    const active = deps.activeCommands();
    for (const scheduleName of Object.keys(active)) {
        if (enabledScheduleNames.includes(scheduleName)) continue;
        const reset = await deps.resetCommands(scheduleName, active[scheduleName]);
        if (!reset) continue;
        deps.clearActiveCommands(scheduleName);

        const { schedule, reason } = await deps.loadStopped(scheduleName);
        const runId = activeRunId(deps.runIds, scheduleName);
        // A deleted row is not written back: syncing it to the server could undo the delete.
        if (schedule && reason !== 'deleted') {
            schedule.status = 'finished';
            await deps.finishSchedule(schedule);
        }
        await deps.sendStopped(schedule ?? ({ name: scheduleName, label: '' } as TabiotSchedule), reason, runId);
        forgetRunId(deps.runIds, scheduleName);
    }
}

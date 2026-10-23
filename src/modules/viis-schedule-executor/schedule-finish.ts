import { ExecutionReport, KeyOutcome } from './schedule-execution-types';
import { ModbusCmd } from './type';

/**
 * A run is `completed` only after its OFF writes passed. A failed OFF keeps the run `running`
 * with only the failed commands active; the next tick re-enters the finish branch and retries them.
 */

type ContextStore = {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
};

export interface FinishOutcome {
    done: boolean;
    /** Commands whose OFF did not pass: they stay active and are retried next tick. */
    retainCommands: ModbusCmd[];
    failedKeys: string[];
}

/** OFF writes bypass the protection gate, so `blocked` should not happen; if it does, the coil is not OFF. */
export function offFailures(report: ExecutionReport): KeyOutcome[] {
    return report.steps.flatMap(step => step.keys.filter(k => k.status === 'fail' || k.status === 'blocked'));
}

export function decideFinish(
    reset: { allSuccessful: boolean; report: ExecutionReport },
    commands: ModbusCmd[]
): FinishOutcome {
    const failed = offFailures(reset.report);
    if (reset.allSuccessful && failed.length === 0) {
        return { done: true, retainCommands: [], failedKeys: [] };
    }
    const unitid = commands[0]?.unitid ?? 1;
    const retainCommands = failed.map(outcome =>
        commands.find(c => c.key === outcome.key && c.fc === outcome.fc)
        // An implied pump-off is added by the reset itself, so it is not in the list.
        ?? { key: outcome.key, fc: outcome.fc, address: outcome.address, value: outcome.expected, unitid, quantity: 1 }
    );
    return { done: false, retainCommands, failedKeys: failed.map(outcome => outcome.key) };
}

export function offFailedAlarmKey(scheduleId: string): string {
    return `schedule_off_failed:${scheduleId}`;
}

/** Global-context key: schedule name → the run whose OFF failed, with that run's first full reset list. */
export const SCHEDULE_OFF_FAILED_KEY = 'scheduleOffFailedRuns';

export interface OffRetryState {
    runId: string | null;
    /** The first attempt's full reset list, reported at the end instead of only the retried keys. */
    commands: ModbusCmd[];
}

function readMarkers(store: ContextStore): Record<string, OffRetryState> {
    return { ...((store.get(SCHEDULE_OFF_FAILED_KEY) as Record<string, OffRetryState>) || {}) };
}

/** The pending OFF retry of this run, or null. A marker left by an earlier run does not count. */
export function pendingOffRetry(store: ContextStore, scheduleName: string, runId: string | null): OffRetryState | null {
    const marker = readMarkers(store)[scheduleName];
    return marker && marker.runId === runId ? marker : null;
}

/** Record a failed OFF; true only on the first failed attempt of this run (notify once). */
export function noteOffFailure(store: ContextStore, scheduleName: string, runId: string | null, commands: ModbusCmd[]): boolean {
    if (pendingOffRetry(store, scheduleName, runId)) return false;
    const markers = readMarkers(store);
    markers[scheduleName] = { runId, commands };
    store.set(SCHEDULE_OFF_FAILED_KEY, markers);
    return true;
}

/** Forget the OFF failure once the OFF passed; true when an earlier attempt had failed. */
export function clearOffFailure(store: ContextStore, scheduleName: string): boolean {
    const markers = readMarkers(store);
    if (!(scheduleName in markers)) return false;
    delete markers[scheduleName];
    store.set(SCHEDULE_OFF_FAILED_KEY, markers);
    return true;
}

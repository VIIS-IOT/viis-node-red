import { isValveKey } from './schedule-coil-classify';
import { ExecutionReport, ExecutionStep, KeyOutcome } from './schedule-execution-types';
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
    /** Commands whose OFF did not pass, at their OFF value: they stay active and are retried next tick. */
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
    // Kept at the OFF value, not the start value: stuck recovery reads a register that still holds
    // its start value as OFF when the active command carries that value.
    const retainCommands = failed.map(outcome => {
        const cmd = commands.find(c => c.key === outcome.key && c.fc === outcome.fc);
        // An implied pump-off is added by the reset itself, so it is not in the list.
        return cmd
            ? { ...cmd, value: outcome.expected }
            : { key: outcome.key, fc: outcome.fc, address: outcome.address, value: outcome.expected, unitid, quantity: 1 };
    });
    return { done: false, retainCommands, failedKeys: failed.map(outcome => outcome.key) };
}

/**
 * A retry writes the implied pump-off of every mapped pump only when a valve is retried, so the
 * pumps are off before it closes. Retrying a register or another coil each tick must not keep
 * stopping pumps that other schedules or the PLC run.
 */
export function retryNeedsImpliedPumps(commands: ModbusCmd[]): boolean {
    return commands.some(cmd => cmd.fc === 5 && isValveKey(cmd.key));
}

/**
 * The OFF of a run whose active commands were lost (a restart clears them) is rebuilt from the
 * schedule: every mapped coil OFF, every mapped register 0, in mapping order.
 */
export function rebuildOffCommands(mapped: { coilCommands: ModbusCmd[]; holdingCommands: ModbusCmd[] }): ModbusCmd[] {
    return [
        ...mapped.coilCommands.map(cmd => ({ ...cmd, value: false })),
        ...mapped.holdingCommands.map(cmd => ({ ...cmd, value: 0 })),
    ];
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
    /** The keys that passed on the failed attempts, so the end audit shows every key once. */
    passedSteps: ExecutionStep[];
}

/** The steps of a failed attempt with only their passed keys; a step with none left is dropped. */
function passedSteps(report: ExecutionReport): ExecutionStep[] {
    return report.steps
        .map(step => ({ step, keys: step.keys.filter(k => k.status === 'pass') }))
        .filter(({ step, keys }) => keys.length > 0 || (step.keys.length === 0 && step.ok))
        .map(({ step, keys }) => ({ ...step, ok: true, keys }));
}

function readMarkers(store: ContextStore): Record<string, OffRetryState> {
    return { ...((store.get(SCHEDULE_OFF_FAILED_KEY) as Record<string, OffRetryState>) || {}) };
}

/** The pending OFF retry of this run, or null. A marker left by an earlier run does not count. */
export function pendingOffRetry(store: ContextStore, scheduleName: string, runId: string | null): OffRetryState | null {
    const marker = readMarkers(store)[scheduleName];
    return marker && marker.runId === runId ? marker : null;
}

/** Record a failed OFF attempt; true only on the first failed attempt of this run (notify once). */
export function noteOffFailure(
    store: ContextStore,
    scheduleName: string,
    runId: string | null,
    commands: ModbusCmd[],
    report: ExecutionReport
): boolean {
    const pending = pendingOffRetry(store, scheduleName, runId);
    const markers = readMarkers(store);
    markers[scheduleName] = pending
        ? { ...pending, passedSteps: [...(pending.passedSteps ?? []), ...passedSteps(report)] }
        : { runId, commands, passedSteps: passedSteps(report) };
    store.set(SCHEDULE_OFF_FAILED_KEY, markers);
    return !pending;
}

/** The end audit after retries: the keys that passed earlier, then the attempt that finished the OFF. */
export function offReportForAudit(retry: OffRetryState | null, finalReport: ExecutionReport): ExecutionReport {
    if (!retry) return finalReport;
    return { ...finalReport, steps: [...(retry.passedSteps ?? []), ...finalReport.steps] };
}

/** Forget the OFF failure once the OFF passed; true when an earlier attempt had failed. */
export function clearOffFailure(store: ContextStore, scheduleName: string): boolean {
    const markers = readMarkers(store);
    if (!(scheduleName in markers)) return false;
    delete markers[scheduleName];
    store.set(SCHEDULE_OFF_FAILED_KEY, markers);
    return true;
}

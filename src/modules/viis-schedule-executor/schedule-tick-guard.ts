export const SCHEDULE_IN_FLIGHT_KEY = "scheduleTransitionsInFlight";

export type ScheduleTransitionKind = "start" | "finish";

type ContextStore = {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
};

export interface SerializedQueueOptions {
    /**
     * Watchdog: a tick still running after this long is abandoned so the next tick can run.
     * Its work keeps going in the background; the per-schedule transition guard still stops a
     * second START/FINISH for the schedule it holds.
     */
    jobTimeoutMs?: number;
    onJobTimeout?: (timeoutMs: number) => void;
}

/** Reject with `message` after `timeoutMs`; `clear` stops the timer once the race is decided. */
function deadline(timeoutMs: number, message: string): { promise: Promise<never>; clear: () => void } {
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return { promise, clear: () => { if (timer) clearTimeout(timer); } };
}

/**
 * Serialize Node-RED input ticks so START/FINISH (including the 7s water-hammer)
 * cannot overlap when inject repeats every few seconds.
 */
export function createSerializedQueue(options: SerializedQueueOptions = {}) {
    let tail: Promise<void> = Promise.resolve();

    const guarded = <T>(work: () => Promise<T>) => async (): Promise<T> => {
        if (!options.jobTimeoutMs) return work();
        const job = work();
        job.catch(() => undefined);
        const limit = deadline(options.jobTimeoutMs, `Schedule executor tick exceeded ${options.jobTimeoutMs}ms`);
        try {
            return await Promise.race([job, limit.promise]);
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('Schedule executor tick exceeded')) {
                options.onJobTimeout?.(options.jobTimeoutMs);
            }
            throw error;
        } finally {
            limit.clear();
        }
    };

    return function enqueue<T>(work: () => Promise<T>): Promise<T> {
        const step = guarded(work);
        const run = tail.then(step, step);
        tail = run.then(() => undefined, () => undefined);
        return run;
    };
}

/**
 * Run a reporting side effect (notification, schedule log, telemetry, audit) without letting it
 * stall the tick: it may fail or take at most `timeoutMs`. Device control never waits longer.
 * Resolves `true` when it completed, `false` (after calling `onFailure`) otherwise; never rejects.
 */
export async function runBoundedSideEffect(
    label: string,
    work: () => Promise<unknown>,
    timeoutMs: number,
    onFailure: (message: string) => void
): Promise<boolean> {
    const limit = deadline(timeoutMs, `timed out after ${timeoutMs}ms`);
    try {
        const job = work();
        job.catch(() => undefined);
        await Promise.race([job, limit.promise]);
        return true;
    } catch (error) {
        onFailure(`${label} failed: ${(error as Error)?.message ?? String(error)}`);
        return false;
    } finally {
        limit.clear();
    }
}

function readInFlight(store: ContextStore): Record<string, ScheduleTransitionKind> {
    return { ...((store.get(SCHEDULE_IN_FLIGHT_KEY) as Record<string, ScheduleTransitionKind>) || {}) };
}

export function tryBeginScheduleTransition(
    store: ContextStore,
    scheduleName: string,
    kind: ScheduleTransitionKind
): boolean {
    const current = readInFlight(store);
    if (current[scheduleName]) {
        return false;
    }
    current[scheduleName] = kind;
    store.set(SCHEDULE_IN_FLIGHT_KEY, current);
    return true;
}

export function endScheduleTransition(store: ContextStore, scheduleName: string): void {
    const current = readInFlight(store);
    delete current[scheduleName];
    store.set(SCHEDULE_IN_FLIGHT_KEY, current);
}

export function isScheduleTransitionInFlight(store: ContextStore, scheduleName: string): boolean {
    const current = (store.get(SCHEDULE_IN_FLIGHT_KEY) as Record<string, ScheduleTransitionKind>) || {};
    return Boolean(current[scheduleName]);
}

export function clearAllScheduleTransitions(store: ContextStore): void {
    store.set(SCHEDULE_IN_FLIGHT_KEY, {});
}

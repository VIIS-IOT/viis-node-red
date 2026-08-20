export const SCHEDULE_IN_FLIGHT_KEY = "scheduleTransitionsInFlight";

export type ScheduleTransitionKind = "start" | "finish";

type ContextStore = {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
};

/**
 * Serialize Node-RED input ticks so START/FINISH (including the 7s water-hammer)
 * cannot overlap when inject repeats every few seconds.
 */
export function createSerializedQueue() {
    let tail: Promise<void> = Promise.resolve();

    return function enqueue<T>(work: () => Promise<T>): Promise<T> {
        const run = tail.then(work, work);
        tail = run.then(() => undefined, () => undefined);
        return run;
    };
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

import {
    SCHEDULE_IN_FLIGHT_KEY,
    clearAllScheduleTransitions,
    createSerializedQueue,
    endScheduleTransition,
    isScheduleTransitionInFlight,
    runBoundedSideEffect,
    tryBeginScheduleTransition,
} from '../schedule-tick-guard';

function memoryStore(initial: Record<string, unknown> = {}) {
    const data = { ...initial };
    return {
        get: (key: string) => data[key],
        set: (key: string, value: unknown) => {
            data[key] = value;
        },
        data,
    };
}

describe('createSerializedQueue', () => {
    test('runs overlapping work one at a time', async () => {
        const enqueue = createSerializedQueue();
        const order: string[] = [];

        const first = enqueue(async () => {
            order.push('first-start');
            await new Promise((resolve) => setTimeout(resolve, 30));
            order.push('first-end');
            return 'a';
        });
        const second = enqueue(async () => {
            order.push('second-start');
            return 'b';
        });

        await expect(Promise.all([first, second])).resolves.toEqual(['a', 'b']);
        expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    });

    test('keeps the queue alive after a rejected tick', async () => {
        const enqueue = createSerializedQueue();

        await expect(enqueue(async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');

        await expect(enqueue(async () => 'ok')).resolves.toBe('ok');
    });
});

describe('schedule transition in-flight guard', () => {
    test('rejects a second start/finish for the same schedule', () => {
        const store = memoryStore();

        expect(tryBeginScheduleTransition(store, 'Lô 11', 'finish')).toBe(true);
        expect(tryBeginScheduleTransition(store, 'Lô 11', 'finish')).toBe(false);
        expect(tryBeginScheduleTransition(store, 'Lô 11', 'start')).toBe(false);
        expect(isScheduleTransitionInFlight(store, 'Lô 11')).toBe(true);
        expect(tryBeginScheduleTransition(store, 'Lô 12', 'start')).toBe(true);
    });

    test('allows the next transition after end', () => {
        const store = memoryStore();

        expect(tryBeginScheduleTransition(store, 'Lô 11', 'finish')).toBe(true);
        endScheduleTransition(store, 'Lô 11');
        expect(isScheduleTransitionInFlight(store, 'Lô 11')).toBe(false);
        expect(tryBeginScheduleTransition(store, 'Lô 11', 'start')).toBe(true);
    });

    test('startup clear removes a stuck lock', () => {
        const store = memoryStore({
            [SCHEDULE_IN_FLIGHT_KEY]: { 'Lô 11': 'finish' },
        });

        clearAllScheduleTransitions(store);
        expect(isScheduleTransitionInFlight(store, 'Lô 11')).toBe(false);
        expect(tryBeginScheduleTransition(store, 'Lô 11', 'finish')).toBe(true);
    });
});

describe('createSerializedQueue tick watchdog', () => {
    test('a hung tick is abandoned after jobTimeoutMs so later ticks still run', async () => {
        const onJobTimeout = jest.fn();
        const enqueue = createSerializedQueue({ jobTimeoutMs: 50, onJobTimeout });

        const hung = enqueue(() => new Promise<string>(() => { /* never settles */ }));
        const next = enqueue(async () => 'next tick ran');

        await expect(hung).rejects.toThrow(/tick exceeded 50ms/);
        await expect(next).resolves.toBe('next tick ran');
        expect(onJobTimeout).toHaveBeenCalledTimes(1);
    });

    test('a tick that finishes in time is unaffected', async () => {
        const onJobTimeout = jest.fn();
        const enqueue = createSerializedQueue({ jobTimeoutMs: 1000, onJobTimeout });

        await expect(enqueue(async () => 'ok')).resolves.toBe('ok');
        expect(onJobTimeout).not.toHaveBeenCalled();
    });
});

describe('runBoundedSideEffect', () => {
    test('gives up on a side effect that never settles and reports it', async () => {
        const onFailure = jest.fn();

        const started = Date.now();
        await expect(
            runBoundedSideEffect('schedule telemetry', () => new Promise(() => { /* never settles */ }), 50, onFailure)
        ).resolves.toBe(false);
        expect(Date.now() - started).toBeLessThan(1000);
        expect(onFailure).toHaveBeenCalledWith(expect.stringMatching(/schedule telemetry.*timed out after 50ms/));
    });

    test('swallows a rejected side effect so the tick continues', async () => {
        const onFailure = jest.fn();

        await expect(
            runBoundedSideEffect('audit log', async () => { throw new Error('broker down'); }, 1000, onFailure)
        ).resolves.toBe(false);
        expect(onFailure).toHaveBeenCalledWith(expect.stringMatching(/audit log.*broker down/));
    });

    test('returns true when the side effect completes', async () => {
        const onFailure = jest.fn();

        await expect(runBoundedSideEffect('notification', async () => undefined, 1000, onFailure)).resolves.toBe(true);
        expect(onFailure).not.toHaveBeenCalled();
    });
});

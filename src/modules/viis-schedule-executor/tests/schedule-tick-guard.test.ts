import {
    SCHEDULE_IN_FLIGHT_KEY,
    clearAllScheduleTransitions,
    createSerializedQueue,
    endScheduleTransition,
    isScheduleTransitionInFlight,
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

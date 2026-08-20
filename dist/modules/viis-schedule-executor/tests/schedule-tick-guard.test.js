"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schedule_tick_guard_1 = require("../schedule-tick-guard");
function memoryStore(initial = {}) {
    const data = Object.assign({}, initial);
    return {
        get: (key) => data[key],
        set: (key, value) => {
            data[key] = value;
        },
        data,
    };
}
describe('createSerializedQueue', () => {
    test('runs overlapping work one at a time', async () => {
        const enqueue = (0, schedule_tick_guard_1.createSerializedQueue)();
        const order = [];
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
        const enqueue = (0, schedule_tick_guard_1.createSerializedQueue)();
        await expect(enqueue(async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');
        await expect(enqueue(async () => 'ok')).resolves.toBe('ok');
    });
});
describe('schedule transition in-flight guard', () => {
    test('rejects a second start/finish for the same schedule', () => {
        const store = memoryStore();
        expect((0, schedule_tick_guard_1.tryBeginScheduleTransition)(store, 'Lô 11', 'finish')).toBe(true);
        expect((0, schedule_tick_guard_1.tryBeginScheduleTransition)(store, 'Lô 11', 'finish')).toBe(false);
        expect((0, schedule_tick_guard_1.tryBeginScheduleTransition)(store, 'Lô 11', 'start')).toBe(false);
        expect((0, schedule_tick_guard_1.isScheduleTransitionInFlight)(store, 'Lô 11')).toBe(true);
        expect((0, schedule_tick_guard_1.tryBeginScheduleTransition)(store, 'Lô 12', 'start')).toBe(true);
    });
    test('allows the next transition after end', () => {
        const store = memoryStore();
        expect((0, schedule_tick_guard_1.tryBeginScheduleTransition)(store, 'Lô 11', 'finish')).toBe(true);
        (0, schedule_tick_guard_1.endScheduleTransition)(store, 'Lô 11');
        expect((0, schedule_tick_guard_1.isScheduleTransitionInFlight)(store, 'Lô 11')).toBe(false);
        expect((0, schedule_tick_guard_1.tryBeginScheduleTransition)(store, 'Lô 11', 'start')).toBe(true);
    });
    test('startup clear removes a stuck lock', () => {
        const store = memoryStore({
            [schedule_tick_guard_1.SCHEDULE_IN_FLIGHT_KEY]: { 'Lô 11': 'finish' },
        });
        (0, schedule_tick_guard_1.clearAllScheduleTransitions)(store);
        expect((0, schedule_tick_guard_1.isScheduleTransitionInFlight)(store, 'Lô 11')).toBe(false);
        expect((0, schedule_tick_guard_1.tryBeginScheduleTransition)(store, 'Lô 11', 'finish')).toBe(true);
    });
});

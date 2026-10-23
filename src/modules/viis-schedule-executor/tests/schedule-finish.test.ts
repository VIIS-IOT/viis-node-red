/**
 * A schedule run is `completed` only after its OFF writes passed. A failed OFF keeps the run
 * `running` with only the failed commands, and the next tick retries them.
 */
import {
    clearOffFailure,
    decideFinish,
    noteOffFailure,
    offFailedAlarmKey,
    pendingOffRetry,
} from '../schedule-finish';
import { ExecutionReport, KeyOutcome } from '../schedule-execution-types';
import { ModbusCmd } from '../type';

function memoryStore() {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => { values.set(key, value); },
    };
}

const cmd = (key: string, fc: number, address: number, value: number | boolean): ModbusCmd =>
    ({ key, fc, address, value, unitid: 1, quantity: 1 });

const outcome = (c: ModbusCmd, status: KeyOutcome['status']): KeyOutcome => ({
    key: c.key, phase: c.fc === 5 ? 'close_valves' : 'reset_holding', fc: c.fc, address: c.address,
    expected: c.fc === 5 ? false : 0, status, attempts: 3,
});

const report = (keys: KeyOutcome[]): ExecutionReport => ({
    runId: 'finish-1', action: 'end', scheduleId: 's1',
    steps: [{ phase: 'close_valves', ts: 0, ok: keys.every(k => k.status === 'pass'), keys }],
});

const valve1 = cmd('valve_1', 5, 3, true);
const pump1 = cmd('pump_1', 5, 0, true);
const timeValve1 = cmd('time_valve_1', 6, 31, 30);

describe('decideFinish', () => {
    test('a failed OFF keeps only the failed command and is not done', () => {
        const result = decideFinish(
            { allSuccessful: false, report: report([outcome(pump1, 'pass'), outcome(valve1, 'fail')]) },
            [pump1, valve1, timeValve1]
        );
        expect(result).toEqual({ done: false, retainCommands: [valve1], failedKeys: ['valve_1'] });
    });

    test('every OFF passed: done with nothing retained', () => {
        const result = decideFinish(
            { allSuccessful: true, report: report([outcome(pump1, 'pass'), outcome(valve1, 'pass')]) },
            [pump1, valve1]
        );
        expect(result).toEqual({ done: true, retainCommands: [], failedKeys: [] });
    });

    test('a failed implied pump-off that is not in the list is retained from its outcome', () => {
        const impliedPump = cmd('main_pump', 5, 7, false);
        const result = decideFinish(
            { allSuccessful: false, report: report([outcome(impliedPump, 'fail'), outcome(valve1, 'pass')]) },
            [valve1]
        );
        expect(result.done).toBe(false);
        expect(result.retainCommands).toEqual([{ key: 'main_pump', fc: 5, address: 7, value: false, unitid: 1, quantity: 1 }]);
    });
});

describe('OFF failure marker', () => {
    test('alarm key names the schedule', () => {
        expect(offFailedAlarmKey('s1')).toBe('schedule_off_failed:s1');
    });

    test('only the first failed attempt of a run notifies; the first full list is kept for the end report', () => {
        const store = memoryStore();
        expect(pendingOffRetry(store, 's1', 'run-1')).toBeNull();

        expect(noteOffFailure(store, 's1', 'run-1', [pump1, valve1])).toBe(true);
        expect(noteOffFailure(store, 's1', 'run-1', [valve1])).toBe(false);
        expect(pendingOffRetry(store, 's1', 'run-1')?.commands).toEqual([pump1, valve1]);

        // A marker left by an earlier run does not count for the next run.
        expect(pendingOffRetry(store, 's1', 'run-2')).toBeNull();
        expect(noteOffFailure(store, 's1', 'run-2', [valve1])).toBe(true);

        expect(clearOffFailure(store, 's1')).toBe(true);
        expect(clearOffFailure(store, 's1')).toBe(false);
        expect(pendingOffRetry(store, 's1', 'run-2')).toBeNull();
    });
});

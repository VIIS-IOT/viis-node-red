/**
 * A schedule run is `completed` only after its OFF writes passed. A failed OFF keeps the run
 * `running` with only the failed commands, and the next tick retries them.
 */
import {
    clearOffFailure,
    decideFinish,
    noteOffFailure,
    offFailedAlarmKey,
    offReportForAudit,
    pendingOffRetry,
    rebuildOffCommands,
    retryNeedsImpliedPumps,
} from '../schedule-finish';
import { ExecutionReport, KeyOutcome } from '../schedule-execution-types';
import { ModbusCmd } from '../type';
import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';

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
    test('a failed OFF keeps only the failed commands, at their OFF value, and is not done', () => {
        const result = decideFinish(
            { allSuccessful: false, report: report([outcome(pump1, 'pass'), outcome(valve1, 'fail'), outcome(timeValve1, 'fail')]) },
            [pump1, valve1, timeValve1]
        );
        // Not the start values (true / 30): stuck recovery would read a register still at 30 as OFF.
        expect(result).toEqual({
            done: false,
            retainCommands: [{ ...valve1, value: false }, { ...timeValve1, value: 0 }],
            failedKeys: ['valve_1', 'time_valve_1'],
        });
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

test('a retry stops every mapped pump only when it has a valve to close', () => {
    expect(retryNeedsImpliedPumps([{ ...valve1, value: false }])).toBe(true);
    expect(retryNeedsImpliedPumps([{ ...timeValve1, value: 0 }, cmd('mixer', 5, 9, false)])).toBe(false);
});

describe('OFF failure marker', () => {
    test('alarm key names the schedule', () => {
        expect(offFailedAlarmKey('s1')).toBe('schedule_off_failed:s1');
    });

    test('only the first failed attempt of a run notifies; the first full list is kept for the end report', () => {
        const store = memoryStore();
        expect(pendingOffRetry(store, 's1', 'run-1')).toBeNull();

        const failed = report([outcome(valve1, 'fail')]);
        expect(noteOffFailure(store, 's1', 'run-1', [pump1, valve1], failed)).toBe(true);
        expect(noteOffFailure(store, 's1', 'run-1', [valve1], failed)).toBe(false);
        expect(pendingOffRetry(store, 's1', 'run-1')?.commands).toEqual([pump1, valve1]);

        // A marker left by an earlier run does not count for the next run.
        expect(pendingOffRetry(store, 's1', 'run-2')).toBeNull();
        expect(noteOffFailure(store, 's1', 'run-2', [valve1], failed)).toBe(true);

        expect(clearOffFailure(store, 's1')).toBe(true);
        expect(clearOffFailure(store, 's1')).toBe(false);
        expect(pendingOffRetry(store, 's1', 'run-2')).toBeNull();
    });
});

test('the end audit after a retry lists every key once, each with its passing outcome', () => {
    const store = memoryStore();
    noteOffFailure(store, 's1', 'run-1', [pump1, valve1, timeValve1],
        report([outcome(pump1, 'pass'), outcome(valve1, 'fail'), outcome(timeValve1, 'fail')]));
    noteOffFailure(store, 's1', 'run-1', [valve1, timeValve1],
        report([outcome(valve1, 'fail'), outcome(timeValve1, 'pass')]));

    const audit = offReportForAudit(pendingOffRetry(store, 's1', 'run-1'), report([outcome(valve1, 'pass')]));
    const keys = audit.steps.flatMap(step => step.keys.map(k => `${k.key}:${k.status}`));
    expect(keys).toEqual(['pump_1:pass', 'time_valve_1:pass', 'valve_1:pass']);
    expect(audit.steps.every(step => step.ok)).toBe(true);
});

describe('OFF after a restart that spanned the window end', () => {
    test('rebuilds every mapped output at its OFF value, coils then holdings, addresses kept', () => {
        // mapScheduleToModbus of `{ valve_1: true, time_valve_1: 30 }`.
        expect(rebuildOffCommands({ coilCommands: [valve1], holdingCommands: [timeValve1] })).toEqual([
            { ...valve1, value: false },
            { ...timeValve1, value: 0 },
        ]);
        expect(rebuildOffCommands({ coilCommands: [], holdingCommands: [] })).toEqual([]);
    });

    function stuckRecoveryService() {
        const store = memoryStore();
        const node = { context: () => ({ global: store }), warn: jest.fn() } as any;
        const service = new ScheduleService(node);
        jest.spyOn(service, 'mapScheduleToModbus').mockReturnValue({ coilCommands: [valve1], holdingCommands: [timeValve1], configParameters: [] });
        jest.spyOn(service, 'updateScheduleStatus').mockResolvedValue(undefined as any);
        jest.spyOn(service, 'sendNotificationToBackend').mockResolvedValue(true as any);
        return service;
    }

    // Past its end date: the restart cleared the active commands, but the coil may still be ON.
    const stuck = { name: 's1', status: 'running', action: '{"valve_1":true,"time_valve_1":30}', end_date: '2020-01-01', start_time: '08:00:00', end_time: '08:01:00' } as unknown as TabiotSchedule;

    test('stuck recovery with no active commands writes the OFF before it finishes the run', async () => {
        const service = stuckRecoveryService();
        const reset = jest.spyOn(service, 'resetModbusCommands')
            .mockResolvedValue({ allSuccessful: true, report: report([outcome(valve1, 'pass'), outcome(timeValve1, 'pass')]) });

        await service.checkAndRecoverStuckSchedules({} as any, [stuck]);

        expect(reset).toHaveBeenCalledWith({}, [{ ...valve1, value: false }, { ...timeValve1, value: 0 }], stuck, true);
        expect(service.updateScheduleStatus).toHaveBeenCalledWith(stuck, 'finished');
    });

    test('stuck recovery whose OFF failed keeps the run running with the failed commands', async () => {
        const service = stuckRecoveryService();
        jest.spyOn(service, 'resetModbusCommands')
            .mockResolvedValue({ allSuccessful: false, report: report([outcome(valve1, 'fail'), outcome(timeValve1, 'pass')]) });

        await service.checkAndRecoverStuckSchedules({} as any, [stuck]);

        expect(service.updateScheduleStatus).not.toHaveBeenCalled();
        expect(service.sendNotificationToBackend).not.toHaveBeenCalled();
        expect(service.getActiveCommands('s1')).toEqual([{ ...valve1, value: false }]);
    });
});

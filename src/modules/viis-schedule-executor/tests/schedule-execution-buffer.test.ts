import { ExecutionStepBuffer } from '../schedule-execution-buffer';
import { failedOutcomes } from '../schedule-execution-types';
import { KeyOutcome } from '../schedule-execution-types';

function outcome(partial: Partial<KeyOutcome> & Pick<KeyOutcome, 'key' | 'status'>): KeyOutcome {
    return {
        phase: 'set_holding',
        fc: 6,
        address: 1,
        expected: 1,
        attempts: 1,
        ...partial,
    };
}

test('push after simulated work only; step order equals push order', () => {
    const buffer = new ExecutionStepBuffer('run-1', 'start', 'sched-1');
    buffer.pushPhase({
        phase: 'set_holding',
        keys: [outcome({ key: 'set_ec', status: 'pass' })],
    });
    buffer.pushPhase({
        phase: 'water_hammer_delay',
        keys: [],
        ok: true,
        duration_ms: 7000,
    });
    buffer.pushPhase({
        phase: 'start_pumps',
        keys: [outcome({ key: 'main_pump', status: 'fail', phase: 'start_pumps', fc: 5 })],
    });

    const report = buffer.toReport();
    expect(report.runId).toBe('run-1');
    expect(report.action).toBe('start');
    expect(report.scheduleId).toBe('sched-1');
    expect(report.steps.map(s => s.phase)).toEqual([
        'set_holding',
        'water_hammer_delay',
        'start_pumps',
    ]);
    expect(report.steps[1].ok).toBe(true);
    expect(report.steps[1].duration_ms).toBe(7000);
    expect(report.steps[1].keys).toEqual([]);
});

test('failedOutcomes ignores pass, skipped, and blocked', () => {
    const buffer = new ExecutionStepBuffer('run-2', 'start', 'sched-2');
    buffer.pushPhase({
        phase: 'set_holding',
        keys: [
            outcome({ key: 'set_ec', status: 'pass' }),
            outcome({ key: 'set_ph', status: 'skipped' }),
            outcome({ key: 'blocked_pump', status: 'blocked', phase: 'start_pumps', fc: 5 }),
            outcome({ key: 'set_flow', status: 'fail' }),
        ],
    });
    const fails = failedOutcomes(buffer.toReport());
    expect(fails.map(k => k.key)).toEqual(['set_flow']);
});

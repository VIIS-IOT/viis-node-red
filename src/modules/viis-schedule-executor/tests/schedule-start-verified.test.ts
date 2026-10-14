/**
 * ADR-033 D1: a run is reported as started only when its start verify passed; a missed output is
 * reported by verify_failed alone.
 */
import fs from 'fs';
import path from 'path';
import { startNotificationDue } from '../schedule-side-effects';
import { ExecutionReport } from '../schedule-execution-types';

const report = (statuses: Array<'pass' | 'fail'>): ExecutionReport => ({
    runId: 'run-1',
    action: 'start',
    scheduleId: 'sched-1',
    steps: [{
        phase: 'set_holding',
        ts: 1,
        ok: statuses.every(s => s === 'pass'),
        keys: statuses.map((status, i) => ({
            key: `k${i}`, phase: 'set_holding', fc: 6, address: i, expected: 1, status, attempts: 1,
        })),
    }],
} as unknown as ExecutionReport);

test('clean verify sends started', () => {
    expect(startNotificationDue(report(['pass', 'pass']))).toBe(true);
});

test('verify miss sends no started', () => {
    expect(startNotificationDue(report(['pass', 'fail']))).toBe(false);
});

test('the executor guards the start notification with the verify result', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'viis-schedule-executor.ts'), 'utf8');
    const start = src.indexOf("sendNotificationToBackend(schedule, 'start'");
    expect(start).toBeGreaterThan(-1);
    const guard = src.lastIndexOf('startNotificationDue(startReport)', start);
    expect(guard).toBeGreaterThan(-1);
    // The guard sits right above the start notification, not somewhere earlier in the file.
    expect(start - guard).toBeLessThan(300);
});

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 2026-10-14 PhuTho: a telemetry publish awaited without a deadline hung the serialized tick queue,
 * and no schedule ran for three hours. Every reporting call in the executor must go through
 * `sideEffect(...)` (or `executeWithTimeout` for config publishes), never a bare `await`.
 */
const REPORTING_CALLS = [
    'scheduleService.sendNotificationToBackend',
    'scheduleService.syncScheduleLog',
    'scheduleService.publishScheduleTelemetry',
    'scheduleService.sendKeyVerifyFailNotification',
    'scheduleService.publishConfigUpdate',
    'emitStartSideEffects',
    'emitEndSideEffects',
];

test('the executor never awaits a reporting side effect without a deadline', () => {
    const source = readFileSync(join(__dirname, '..', 'viis-schedule-executor.ts'), 'utf8');

    const bareAwaits = REPORTING_CALLS.filter((call) => source.includes(`await ${call}(`));

    expect(bareAwaits).toEqual([]);
    for (const call of REPORTING_CALLS) {
        expect(source).toContain(`${call}(`);
    }
});

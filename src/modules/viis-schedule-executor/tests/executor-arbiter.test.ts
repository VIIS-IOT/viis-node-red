/**
 * Plan Task 13: with the actuator arbiter enforcing, a schedule claims its managed coils instead of
 * writing them (owner `schedule:<name>`, until the window end + 5 min) and releases them at the finish.
 * Unmanaged keys and holdings keep today's direct writes.
 */
import { ActuatorArbiter } from '../../viis-actuator-arbiter/arbiter-api';
import type { ActuatorArbiterApi, ClaimInput, ClaimResult } from '../../viis-actuator-arbiter/arbiter-api';
import { coilKeysFromMappings, loadActuatorPolicy } from '../../viis-actuator-arbiter/actuator-policy';
import { classifyActuatorKey } from '../../viis-actuator-arbiter/reconciler';
import { ExecutionReport } from '../schedule-execution-types';
import { startNotificationDue } from '../schedule-side-effects';
import {
    SCHEDULE_CLAIM_GRACE_MS,
    prepareScheduleFinish,
    scheduleWindowEndMs,
    startScheduleCommands,
} from '../schedule-arbiter';
import { ModbusCmd } from '../type';

const cmd = (key: string, fc: number, address: number, value: number | boolean): ModbusCmd =>
    ({ key, fc, address, value, unitid: 1, quantity: 1 });

const valve1 = cmd('valve_1', 5, 0, true);
const pump1 = cmd('pump_1', 5, 3, true);
const timeValve1 = cmd('time_valve_1', 6, 31, 30);

const WINDOW_END = 1_800_000_000_000;

/** Records calls; `managed` keys are arbitrated, `claimAnswer` decides each claim. */
function fakeArbiter(managed: string[], claimAnswer: (c: ClaimInput) => ClaimResult = () => ({ applied: true, actual: true, mode: 'enforce' })) {
    const claims: ClaimInput[] = [];
    const releases: Array<[string, string | undefined]> = [];
    const arbiter: ActuatorArbiterApi = {
        manages: key => managed.includes(key),
        mode: () => 'enforce',
        leaseMs: () => 600_000,
        claim: async c => {
            claims.push(c);
            return claimAnswer(c);
        },
        release: async (ownerId, key) => {
            releases.push([ownerId, key]);
        },
        owners: () => ({}),
    };
    return { arbiter, claims, releases };
}

function directWriter() {
    const calls: Array<{ holdingCommands: ModbusCmd[]; coilCommands: ModbusCmd[] }> = [];
    const execute = async (commands: { holdingCommands: ModbusCmd[]; coilCommands: ModbusCmd[] }): Promise<ExecutionReport> => {
        calls.push(commands);
        return {
            runId: 'run-1',
            action: 'start',
            scheduleId: 's1',
            steps: [...commands.holdingCommands, ...commands.coilCommands].map(c => ({
                phase: c.fc === 6 ? 'set_holding' as const : 'start_pumps' as const,
                ts: 0,
                ok: true,
                keys: [{ key: c.key, phase: c.fc === 6 ? 'set_holding' as const : 'start_pumps' as const, fc: c.fc, address: c.address, expected: c.value, status: 'pass' as const, attempts: 1 }],
            })),
        };
    };
    return { calls, execute };
}

const deps = (arbiter: ActuatorArbiterApi | null, execute: ReturnType<typeof directWriter>['execute'], sleeps: number[] = []) => ({
    arbiter,
    execute,
    sleep: async (ms: number) => { sleeps.push(ms); },
    waterHammerMs: 7000,
    now: () => WINDOW_END - 600_000,
});

describe('schedule START with the arbiter enforcing', () => {
    test('START claims managed keys with schedule source and window-end expiry', async () => {
        const { arbiter, claims } = fakeArbiter(['valve_1']);
        const writer = directWriter();
        const commands = { holdingCommands: [timeValve1], coilCommands: [valve1, pump1] };

        const report = await startScheduleCommands(deps(arbiter, writer.execute), 's1', 'run-1', WINDOW_END, commands);

        expect(claims).toEqual([{
            key: 'valve_1', value: true, source: 'schedule', ownerId: 'schedule:s1',
            expiresAt: WINDOW_END + SCHEDULE_CLAIM_GRACE_MS,
        }]);
        // Holdings first, then the unmanaged coils; the managed valve is never written directly.
        expect(writer.calls).toEqual([
            { holdingCommands: [timeValve1], coilCommands: [] },
            { holdingCommands: [], coilCommands: [pump1] },
        ]);
        const valveOutcome = report.steps.flatMap(s => s.keys).find(k => k.key === 'valve_1');
        expect(valveOutcome).toMatchObject({ phase: 'open_valves', status: 'pass' });
        expect(report.steps.map(s => s.keys[0]?.key)).toEqual(['time_valve_1', 'valve_1', 'pump_1']);
        expect(startNotificationDue(report)).toBe(true);
    });

    test('a blocked managed key fails the start for that key and its claim is withdrawn', async () => {
        const { arbiter, releases } = fakeArbiter(['valve_1'], () => ({ applied: false, actual: false, blockedBy: 'manual', mode: 'enforce' }));
        const writer = directWriter();

        const report = await startScheduleCommands(deps(arbiter, writer.execute), 's1', 'run-1', WINDOW_END, { holdingCommands: [], coilCommands: [valve1] });

        expect(report.steps.flatMap(s => s.keys)).toEqual([
            expect.objectContaining({ key: 'valve_1', status: 'fail', error: 'blocked_by:manual' }),
        ]);
        // ADR-034: no `started` for a key that did not start.
        expect(startNotificationDue(report)).toBe(false);
        expect(releases).toEqual([['schedule:s1', 'valve_1']]);
        expect(writer.calls).toEqual([]);
    });

    test('falsy managed key is not claimed', async () => {
        const { arbiter, claims } = fakeArbiter(['valve_1']);
        const writer = directWriter();

        await startScheduleCommands(deps(arbiter, writer.execute), 's1', 'run-1', WINDOW_END, {
            holdingCommands: [], coilCommands: [{ ...valve1, value: false }, pump1],
        });

        expect(claims).toEqual([]);
        expect(writer.calls).toEqual([{ holdingCommands: [], coilCommands: [pump1] }]);
    });

    test('a managed pump starts after the water-hammer delay that follows a valve opened before it', async () => {
        const { arbiter, claims } = fakeArbiter(['pump_1']);
        const writer = directWriter();
        const sleeps: number[] = [];

        const report = await startScheduleCommands(deps(arbiter, writer.execute, sleeps), 's1', 'run-1', WINDOW_END, {
            holdingCommands: [], coilCommands: [valve1, pump1],
        });

        expect(writer.calls).toEqual([{ holdingCommands: [], coilCommands: [valve1] }]);
        expect(sleeps).toEqual([7000]);
        expect(claims.map(c => c.key)).toEqual(['pump_1']);
        expect(report.steps.map(s => s.phase)).toEqual(['start_pumps', 'water_hammer_delay', 'start_pumps']);
    });

    test('no enforcing arbiter: one direct call with the same commands', async () => {
        const writer = directWriter();
        const commands = { holdingCommands: [timeValve1], coilCommands: [valve1, pump1] };

        await startScheduleCommands(deps(null, writer.execute), 's1', 'run-1', WINDOW_END, commands);

        expect(writer.calls).toHaveLength(1);
        expect(writer.calls[0]).toBe(commands);
    });

    test('window end is the end of the window the schedule runs in (farm time)', () => {
        // 06:00-06:30 Asia/Ho_Chi_Minh on 2026-10-24 = 2026-10-23 23:00-23:30 UTC.
        const now = Date.UTC(2026, 9, 23, 23, 10);
        expect(scheduleWindowEndMs({ start_time: '06:00:00', end_time: '06:30:00' }, null, now)).toBe(Date.UTC(2026, 9, 23, 23, 30));
        expect(scheduleWindowEndMs({ start_time: '07:00:00', end_time: '07:30:00' }, null, now)).toBeNull();
    });
});

describe('schedule finish with the arbiter enforcing', () => {
    test('finish releases once and writes no managed coil', async () => {
        const { arbiter, releases } = fakeArbiter(['valve_1']);

        const writes = await prepareScheduleFinish(arbiter, 's1', [valve1, pump1, timeValve1]);

        expect(releases).toEqual([['schedule:s1', undefined]]);
        expect(writes).toEqual([pump1, timeValve1]);
    });

    test('no enforcing arbiter: the reset list is unchanged', async () => {
        const commands = [valve1, pump1];
        expect(await prepareScheduleFinish(null, 's1', commands)).toBe(commands);
    });

    test("two schedules sharing valve: finishing A keeps B's claim", async () => {
        const state: Record<string, boolean> = {};
        const policy = loadActuatorPolicy(
            { valve_1: 'managed' },
            { manualLeaseS: 1800, coilKeys: coilKeysFromMappings({ board1: { coils: { valve_1: 0 } } }), warn: () => undefined },
        );
        const arbiter = new ActuatorArbiter({
            policy,
            mode: 'enforce',
            scenarioLeaseS: 600,
            tickMs: 60_000,
            debounceMs: 5,
            reconcilerDeps: {
                targets: [{ key: 'valve_1', boardId: 'board1', address: 0, unitId: 1 }],
                readCoil: async t => state[t.key] ?? false,
                writeCoil: async (t, value) => { state[t.key] = value; },
                classify: classifyActuatorKey,
                waterHammerMs: 0,
                sleep: async () => undefined,
            },
            warn: () => undefined,
        });
        await arbiter.start();
        try {
            const writer = directWriter();
            const now = Date.now();
            const start = (name: string) => startScheduleCommands(
                { arbiter, execute: writer.execute, sleep: async () => undefined, waterHammerMs: 0, now: () => now },
                name, `run-${name}`, now + 3_600_000, { holdingCommands: [], coilCommands: [valve1] },
            );
            await start('A');
            await start('B');

            expect(await prepareScheduleFinish(arbiter, 'A', [valve1])).toEqual([]);
            await arbiter.tick();

            expect(arbiter.owners().valve_1?.ownerId).toBe('schedule:B');
            expect(state.valve_1).toBe(true);
            expect(writer.calls).toEqual([]);
        } finally {
            await arbiter.stop();
        }
    });
});

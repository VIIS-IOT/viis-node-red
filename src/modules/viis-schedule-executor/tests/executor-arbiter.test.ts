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
    beginScheduleFinish,
    withoutArbitratedCoils,
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

/** Records calls; `managed` keys are arbitrated, `hold` keys are hold, `claimAnswer` decides each claim. */
function fakeArbiter(
    managed: string[],
    claimAnswer: (c: ClaimInput) => ClaimResult = () => ({ applied: true, actual: true, mode: 'enforce' }),
    hold: string[] = [],
    log: string[] = [],
    mode: 'observe' | 'enforce' = 'enforce',
) {
    const claims: ClaimInput[] = [];
    const releases: Array<[string, string | undefined]> = [];
    const arbiter: ActuatorArbiterApi = {
        manages: key => managed.includes(key) || hold.includes(key),
        keyMode: key => (managed.includes(key) ? 'managed' : hold.includes(key) ? 'hold' : 'unmanaged'),
        target: () => undefined,
        mode: () => mode,
        leaseMs: () => 600_000,
        claim: async c => {
            claims.push(c);
            return claimAnswer(c);
        },
        release: async (ownerId, key) => {
            releases.push([ownerId, key]);
            log.push(`release ${key ?? '*'}`);
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

const finishDeps = (log: string[] = []) => ({
    sleep: async (ms: number) => { log.push(`sleep ${ms}`); },
    waterHammerMs: 7000,
    warn: () => undefined,
});

describe('schedule finish with the arbiter enforcing', () => {
    test('finish releases once and writes no managed coil', async () => {
        const { arbiter, releases } = fakeArbiter(['valve_1']);

        const finish = await beginScheduleFinish(arbiter, 's1', [valve1, pump1, timeValve1], finishDeps());
        expect(finish.commands).toEqual([pump1, timeValve1]);
        await finish.complete(null);
        await finish.complete(null);

        expect(releases).toEqual([['schedule:s1', undefined]]);
    });

    test('no enforcing arbiter: the reset list is unchanged', async () => {
        const commands = [valve1, pump1];
        const log: string[] = [];
        const finish = await beginScheduleFinish(null, 's1', commands, finishDeps(log));
        await finish.complete(null);
        expect(finish.commands).toBe(commands);
        expect(log).toEqual([]);
    });

    test('managed valve, unmanaged pump: the pump OFF is written, then the delay, then the valve is released', async () => {
        const log: string[] = [];
        const { arbiter } = fakeArbiter(['valve_1'], undefined, [], log);

        const finish = await beginScheduleFinish(arbiter, 's1', [valve1, pump1], finishDeps(log));
        expect(log).toEqual([]);
        // The direct reset: pump_1 OFF only (no direct valve, so the reset itself does not wait).
        log.push(...finish.commands.map(c => `write ${c.key}=off`));
        const resetReport: ExecutionReport = {
            runId: 'r', action: 'end', scheduleId: 's1',
            steps: [{ phase: 'stop_pumps', ts: 0, ok: true, keys: [{ key: 'pump_1', phase: 'stop_pumps', fc: 5, address: 3, expected: false, status: 'pass', attempts: 1 }] }],
        };
        await finish.complete(resetReport);

        expect(log).toEqual(['write pump_1=off', 'sleep 7000', 'release *']);
    });

    test('managed pump and valve: the pump is released first, the valve after the delay', async () => {
        const log: string[] = [];
        const { arbiter } = fakeArbiter(['valve_1', 'pump_1'], undefined, [], log);

        const finish = await beginScheduleFinish(arbiter, 's1', [valve1, pump1], finishDeps(log));
        expect(finish.commands).toEqual([]);
        await finish.complete(null);

        expect(log).toEqual(['release pump_1', 'sleep 7000', 'release *']);
    });

    test('a direct valve made the reset wait: no second delay before the managed valve', async () => {
        const log: string[] = [];
        const { arbiter } = fakeArbiter(['valve_1', 'pump_1'], undefined, [], log);
        const valve2 = cmd('valve_2', 5, 1, true);

        const finish = await beginScheduleFinish(arbiter, 's1', [valve1, valve2, pump1], finishDeps(log));
        expect(finish.commands).toEqual([valve2]);
        await finish.complete({
            runId: 'r', action: 'end', scheduleId: 's1',
            steps: [{ phase: 'water_hammer_delay', ts: 0, ok: true, keys: [] }],
        });

        expect(log).toEqual(['release pump_1', 'release *']);
    });

    test('a hold key is not a schedule claim: START writes it and its OFF stays in the reset list', async () => {
        const { arbiter, claims } = fakeArbiter([], undefined, ['valve_1']);
        const writer = directWriter();

        await startScheduleCommands(deps(arbiter, writer.execute), 's1', 'run-1', WINDOW_END, { holdingCommands: [], coilCommands: [valve1] });
        expect(claims).toEqual([]);
        expect(writer.calls).toEqual([{ holdingCommands: [], coilCommands: [valve1] }]);

        const finish = await beginScheduleFinish(arbiter, 's1', [valve1, pump1], finishDeps());
        expect(finish.commands).toEqual([valve1, pump1]);
        expect(withoutArbitratedCoils([pump1], arbiter)).toEqual([pump1]);
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

            const finishA = await beginScheduleFinish(arbiter, 'A', [valve1], finishDeps());
            expect(finishA.commands).toEqual([]);
            await finishA.complete(null);
            await arbiter.tick();

            expect(arbiter.owners().valve_1?.ownerId).toBe('schedule:B');
            expect(state.valve_1).toBe(true);
            expect(writer.calls).toEqual([]);
        } finally {
            await arbiter.stop();
        }
    });
});

describe('schedule with the arbiter observing (FIX-17)', () => {
    test('START records the same claims as enforce and still writes every command directly', async () => {
        const { arbiter, claims } = fakeArbiter(['valve_1'], undefined, [], [], 'observe');
        const writer = directWriter();
        const commands = { holdingCommands: [timeValve1], coilCommands: [valve1, pump1] };

        const report = await startScheduleCommands(deps(arbiter, writer.execute), 's1', 'run-1', WINDOW_END, commands);

        expect(claims).toEqual([{
            key: 'valve_1', value: true, source: 'schedule', ownerId: 'schedule:s1',
            expiresAt: WINDOW_END + SCHEDULE_CLAIM_GRACE_MS,
        }]);
        // Today's behaviour: one direct call with the untouched commands, no claim outcome in the report.
        expect(writer.calls).toHaveLength(1);
        expect(writer.calls[0]).toBe(commands);
        expect(report.steps.flatMap(s => s.keys).map(k => k.key)).toEqual(['time_valve_1', 'valve_1', 'pump_1']);
    });

    test('a claim the arbiter would refuse does not fail the start in observe', async () => {
        const { arbiter } = fakeArbiter(['valve_1'], () => ({ applied: false, actual: false, blockedBy: 'manual', mode: 'observe' }), [], [], 'observe');
        const writer = directWriter();

        const report = await startScheduleCommands(deps(arbiter, writer.execute), 's1', 'run-1', WINDOW_END, { holdingCommands: [], coilCommands: [valve1] });

        expect(report.steps.flatMap(s => s.keys)).toEqual([expect.objectContaining({ key: 'valve_1', status: 'pass' })]);
    });

    test('finish drops the run claims before the direct OFF and leaves every command to be written', async () => {
        const log: string[] = [];
        const { arbiter, releases } = fakeArbiter(['valve_1'], undefined, [], log, 'observe');
        const commands = [valve1, pump1, timeValve1];

        const finish = await beginScheduleFinish(arbiter, 's1', commands, finishDeps(log));
        log.push('direct OFF');
        await finish.complete(null);

        expect(finish.commands).toBe(commands);
        expect(releases).toEqual([['schedule:s1', undefined]]);
        expect(log).toEqual(['release *', 'direct OFF']);
    });
});

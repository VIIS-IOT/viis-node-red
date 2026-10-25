import { ArbiterCore, ActuatorClaim, ClaimSource } from '../arbiter-core';
import { coilKeysFromMappings, loadActuatorPolicy } from '../actuator-policy';
import { classifyActuatorKey, CoilTarget, Reconciler, ReconcilerDeps } from '../reconciler';

const mappings = {
    board1: { coils: { valve_1: 0, valve_2: 1, valve_3: 2, main_pump: 3, light_1: 4 } },
};
const policy = loadActuatorPolicy(
    { valve_1: 'managed', valve_2: 'managed', valve_3: 'hold', main_pump: 'managed', light_1: 'managed' },
    { manualLeaseS: 1800, coilKeys: coilKeysFromMappings(mappings), warn: () => undefined },
);

const NOW = 1_800_000_000_000;
const HAMMER = 7000;

const targets: CoilTarget[] = Object.entries(mappings.board1.coils)
    .map(([key, address]) => ({ key, boardId: 'board1', address, unitId: 1 }));

function claim(key: string, value: boolean, source: ClaimSource = 'manual'): ActuatorClaim {
    return { key, value, source, ownerId: `${source}:${key}`, expiresAt: NOW + 60_000, createdAt: NOW };
}

/** Fake Modbus: coil state per key, optional read/write failures, and one call log in order. */
function fakeDeps(state: Record<string, boolean>, over: Partial<ReconcilerDeps> = {}) {
    const calls: string[] = [];
    const failRead = new Set<string>();
    const failWrite = new Set<string>();
    const deps: ReconcilerDeps = {
        targets,
        readCoil: async t => {
            calls.push(`read:${t.key}`);
            if (failRead.has(t.key)) throw new Error('Timed out');
            return state[t.key] ?? false;
        },
        writeCoil: async (t, value) => {
            calls.push(`write:${t.key}=${value}`);
            if (failWrite.has(t.key)) throw new Error('Port Not Open');
            state[t.key] = value;
        },
        classify: classifyActuatorKey,
        mode: 'enforce',
        waterHammerMs: HAMMER,
        sleep: async ms => {
            calls.push(`sleep:${ms}`);
        },
        now: () => NOW,
        ...over,
    };
    const writes = () => calls.filter(c => c.startsWith('write:') || c.startsWith('sleep:'));
    return { deps, calls, writes, failRead, failWrite };
}

describe('Reconciler', () => {
    test('enforce writes only differing keys', async () => {
        const core = new ArbiterCore(policy);
        core.claim(claim('valve_1', true));
        // valve_2 already OFF (managed, no claim → OFF), light_1 ON with no claim → must go OFF.
        const { deps, writes } = fakeDeps({ valve_1: false, valve_2: false, main_pump: false, light_1: true });

        const report = await new Reconciler(core, deps).tick();

        expect(report.diffs.sort()).toEqual(['light_1', 'valve_1']);
        expect(report.writes).toEqual([
            { key: 'light_1', value: false, ok: true },
            { key: 'valve_1', value: true, ok: true },
        ]);
        // OFF first, a water-hammer pause, then ON.
        expect(writes()).toEqual(['write:light_1=false', `sleep:${HAMMER}`, 'write:valve_1=true']);
        expect(report.desired).toMatchObject({ valve_1: true, valve_2: false, valve_3: null, light_1: false });
        expect(report.actual).toMatchObject({ valve_1: false, valve_2: false, light_1: true });
    });

    test('observe never writes, reports diffs', async () => {
        const core = new ArbiterCore(policy);
        core.claim(claim('valve_1', true));
        const writeCoil = jest.fn();
        const sleep = jest.fn();
        const { deps } = fakeDeps({ valve_1: false, main_pump: true }, { mode: 'observe', writeCoil, sleep });

        const report = await new Reconciler(core, deps).tick();

        expect(writeCoil).not.toHaveBeenCalled();
        expect(sleep).not.toHaveBeenCalled();
        expect(report.writes).toEqual([]);
        expect(report.diffs.sort()).toEqual(['main_pump', 'valve_1']);
    });

    test('read failure → that key not written, listed in readFailed', async () => {
        const core = new ArbiterCore(policy);
        core.claim(claim('valve_1', true));
        core.claim(claim('valve_2', true));
        const { deps, writes, failRead } = fakeDeps({ valve_1: false, valve_2: false });
        failRead.add('valve_1');

        const report = await new Reconciler(core, deps).tick();

        expect(report.readFailed).toEqual(['valve_1']);
        expect(report.actual.valve_1).toBeUndefined();
        expect(report.diffs).toEqual(['valve_2']);
        expect(writes()).toEqual(['write:valve_2=true']);
    });

    test('write failure increments consecutiveFailures, success resets', async () => {
        const core = new ArbiterCore(policy);
        core.claim(claim('valve_1', true));
        const { deps, failWrite } = fakeDeps({ valve_1: false });
        const reconciler = new Reconciler(core, deps);
        failWrite.add('valve_1');

        const first = await reconciler.tick();
        await reconciler.tick();
        expect(first.writes).toEqual([{ key: 'valve_1', value: true, ok: false, error: 'Port Not Open' }]);
        expect(reconciler.consecutiveFailures('valve_1')).toBe(2);
        expect(reconciler.consecutiveFailures('valve_2')).toBe(0);

        failWrite.clear();
        const third = await reconciler.tick();
        expect(third.writes).toEqual([{ key: 'valve_1', value: true, ok: true }]);
        expect(reconciler.consecutiveFailures('valve_1')).toBe(0);
    });

    test('hold (null) never written', async () => {
        const core = new ArbiterCore(policy);
        // valve_3 is hold with no claim: whatever the coil shows, the arbiter leaves it alone.
        const { deps, calls } = fakeDeps({ valve_3: true });

        const report = await new Reconciler(core, deps).tick();

        expect(report.desired.valve_3).toBeNull();
        expect(report.diffs).not.toContain('valve_3');
        expect(calls.filter(c => c.includes('valve_3'))).toEqual([]);

        // With a claim the hold key is arbitrated like a managed one.
        core.claim(claim('valve_3', false));
        await new Reconciler(core, deps).tick();
        expect(calls).toContain('write:valve_3=false');
    });

    test('ON: valves before pumps with sleep(waterHammerMs)', async () => {
        const core = new ArbiterCore(policy);
        core.claim(claim('main_pump', true, 'schedule'));
        core.claim(claim('valve_1', true, 'schedule'));
        core.claim(claim('light_1', true, 'schedule'));
        const { deps, writes } = fakeDeps({});

        await new Reconciler(core, deps).tick();

        expect(writes()).toEqual([
            'write:valve_1=true',
            'write:light_1=true',
            `sleep:${HAMMER}`,
            'write:main_pump=true',
        ]);
    });

    test('switching valves: one pause between OFF and ON, none inside the ON phase', async () => {
        const core = new ArbiterCore(policy);
        core.claim(claim('valve_1', true, 'schedule'));
        core.claim(claim('light_1', true, 'schedule'));
        core.claim(claim('main_pump', true, 'schedule'));
        // valve_2 open from a previous run (no claim now → OFF); pump already running.
        const { deps, writes } = fakeDeps({ valve_2: true, main_pump: true });

        await new Reconciler(core, deps).tick();

        expect(writes()).toEqual([
            'write:valve_2=false',
            `sleep:${HAMMER}`,
            'write:valve_1=true',
            'write:light_1=true',
        ]);
    });

    test('OFF: pumps before valves', async () => {
        const core = new ArbiterCore(policy);
        // No claims: every managed key resolves OFF.
        const { deps, writes } = fakeDeps({ main_pump: true, valve_1: true, valve_2: true, light_1: true });

        await new Reconciler(core, deps).tick();

        expect(writes()).toEqual([
            'write:main_pump=false',
            'write:light_1=false',
            `sleep:${HAMMER}`,
            'write:valve_1=false',
            'write:valve_2=false',
        ]);
    });

    test('the report names the winning claim per read key (observe diff owner)', async () => {
        const core = new ArbiterCore(policy);
        core.claim(claim('valve_1', true, 'schedule'));
        const { deps } = fakeDeps({ valve_1: false, valve_2: false, main_pump: false, light_1: true }, { mode: 'observe' });

        const report = await new Reconciler(core, deps).tick();

        expect(report.winners).toMatchObject({
            valve_1: { source: 'schedule', ownerId: 'schedule:valve_1' },
            light_1: null,
        });
        expect(report.winners.valve_3).toBeUndefined();
    });

    describe('reads per board (FIX-23)', () => {
        const twoBoards: CoilTarget[] = [
            { key: 'valve_1', boardId: 'board1', address: 0 },
            { key: 'valve_2', boardId: 'board1', address: 1 },
            { key: 'main_pump', boardId: 'board2', address: 3 },
            { key: 'light_1', boardId: 'board2', address: 4 },
        ];
        const policyAll = loadActuatorPolicy(
            { valve_1: 'managed', valve_2: 'managed', main_pump: 'managed', light_1: 'managed' },
            { manualLeaseS: 1800, coilKeys: coilKeysFromMappings(mappings), warn: () => undefined },
        );

        test('a board that does not answer does not hold up the others: board1 is read and written while board2 still waits', async () => {
            const core = new ArbiterCore(policyAll);
            core.claim(claim('valve_1', true));
            const state: Record<string, boolean> = { valve_1: false, valve_2: false, main_pump: false, light_1: false };
            const calls: string[] = [];
            let releaseBoard2: () => void = () => undefined;
            const board2Hang = new Promise<void>(resolve => { releaseBoard2 = resolve; });
            const { deps } = fakeDeps(state, {
                targets: twoBoards,
                readCoil: async t => {
                    calls.push(`read:${t.key}`);
                    if (t.boardId === 'board2') await board2Hang;
                    return state[t.key] ?? false;
                },
            });
            const ticking = new Reconciler(core, deps).tick();

            // Board 2 is stuck on its first read, board 1 has read both its keys already (in parallel).
            await new Promise(resolve => setImmediate(resolve));
            expect([...calls].sort()).toEqual(['read:main_pump', 'read:valve_1', 'read:valve_2']);

            releaseBoard2();
            const report = await ticking;
            expect(calls.slice(3)).toEqual(['read:light_1']);
            expect(report.writes).toEqual([{ key: 'valve_1', value: true, ok: true }]);
        });

        test('two timeouts in a row skip the rest of that board for the tick; one alone, or another kind of error, does not', async () => {
            const core = new ArbiterCore(policyAll);
            const calls: string[] = [];
            const threeOnBoard1: CoilTarget[] = [
                { key: 'valve_1', boardId: 'board1', address: 0 },
                { key: 'valve_2', boardId: 'board1', address: 1 },
                { key: 'light_1', boardId: 'board1', address: 4 },
                { key: 'main_pump', boardId: 'board2', address: 3 },
            ];
            const { deps } = fakeDeps({}, {
                targets: threeOnBoard1,
                readCoil: async t => {
                    calls.push(`read:${t.key}`);
                    if (t.key === 'valve_1' || t.key === 'valve_2') throw new Error('Timed out');
                    if (t.key === 'main_pump') throw new Error('Modbus exception 2: illegal data address');
                    return false;
                },
            });

            const report = await new Reconciler(core, deps).tick();

            // board1: two silent reads in a row, light_1 is never asked. board2: its own error is not "silence".
            expect(calls.sort()).toEqual(['read:main_pump', 'read:valve_1', 'read:valve_2']);
            expect(report.readFailed.sort()).toEqual(['light_1', 'main_pump', 'valve_1', 'valve_2']);

            // A single timeout between answers does not skip anything.
            calls.length = 0;
            const { deps: oneTimeout } = fakeDeps({}, {
                targets: threeOnBoard1.slice(0, 3),
                readCoil: async t => {
                    calls.push(`read:${t.key}`);
                    if (t.key === 'valve_1') throw new Error('Timed out');
                    return false;
                },
            });
            const second = await new Reconciler(core, oneTimeout).tick();
            expect(calls).toEqual(['read:valve_1', 'read:valve_2', 'read:light_1']);
            expect(second.readFailed).toEqual(['valve_1']);
        });

        test('a board whose circuit breaker is open is not read; its keys are readFailed, the other boards are reconciled', async () => {
            const core = new ArbiterCore(policyAll);
            core.claim(claim('valve_1', true));
            core.claim(claim('light_1', true));
            const state: Record<string, boolean> = { valve_1: false, valve_2: false, main_pump: false, light_1: false };
            const { deps, calls } = fakeDeps(state, { targets: twoBoards, boardOffline: id => id === 'board1' });

            const report = await new Reconciler(core, deps).tick();

            expect(calls.filter(c => c === 'read:valve_1' || c === 'read:valve_2')).toEqual([]);
            expect(report.offlineBoards).toEqual(['board1']);
            expect(report.readFailed.sort()).toEqual(['valve_1', 'valve_2']);
            expect(report.writes).toEqual([{ key: 'light_1', value: true, ok: true }]);
        });
    });

    test('classifyActuatorKey follows the executor coil groups', () => {
        expect(classifyActuatorKey('main_pump')).toBe('pump');
        expect(classifyActuatorKey('fertigation_control_power_1')).toBe('pump');
        expect(classifyActuatorKey('power')).toBe('pump');
        expect(classifyActuatorKey('valve_1')).toBe('valve');
        expect(classifyActuatorKey('fertigation_control_valve_0')).toBe('valve');
        expect(classifyActuatorKey('light_1')).toBe('other');
    });
});

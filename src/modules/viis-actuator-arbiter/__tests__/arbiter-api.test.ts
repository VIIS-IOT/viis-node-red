/**
 * Plan Task 12: the arbiter behind getArbiter(). Sources submit claims; a debounced tick reconciles the
 * key and only then answers the caller, so the answer says whether this claim won and what the coil reads.
 */
import { ActuatorArbiter, ArbiterOptions, ClaimStoreLike } from '../arbiter-api';
import { ActuatorClaim } from '../arbiter-core';
import { coilKeysFromMappings, loadActuatorPolicy } from '../actuator-policy';
import { classifyActuatorKey, CoilTarget } from '../reconciler';

const mappings = { board1: { coils: { valve_1: 0, valve_2: 1, main_pump: 3 } } };
const policy = loadActuatorPolicy(
    { valve_1: 'managed', valve_2: { mode: 'managed', manualLeaseS: 60 } },
    { manualLeaseS: 1800, coilKeys: coilKeysFromMappings(mappings), warn: () => undefined },
);
const targets: CoilTarget[] = [
    { key: 'valve_1', boardId: 'board1', address: 0, unitId: 1 },
    { key: 'valve_2', boardId: 'board1', address: 1, unitId: 1 },
];

const T0 = 1_800_000_000_000;

class MemoryStore implements ClaimStoreLike {
    rows: ActuatorClaim[] = [];
    saves = 0;
    available = true;
    isAvailable() {
        return this.available;
    }
    async ensureTable() {}
    async load() {
        return this.rows.map(r => ({ ...r }));
    }
    async save(claims: ActuatorClaim[]) {
        this.saves++;
        this.rows = claims.map(c => ({ ...c }));
    }
}

function setup(over: Partial<ArbiterOptions> = {}, state: Record<string, boolean> = {}) {
    let now = T0;
    const writes: string[] = [];
    const failWrite = new Set<string>();
    const ownerEvents: Record<string, unknown>[] = [];
    const arbiter = new ActuatorArbiter({
        policy,
        mode: 'enforce',
        scenarioLeaseS: 600,
        tickMs: 60_000,
        debounceMs: 5,
        now: () => now,
        reconcilerDeps: {
            targets,
            readCoil: async t => state[t.key] ?? false,
            writeCoil: async (t, value) => {
                writes.push(`${t.key}=${value}`);
                if (failWrite.has(t.key)) throw new Error('Port Not Open');
                state[t.key] = value;
            },
            classify: classifyActuatorKey,
            waterHammerMs: 0,
            sleep: async () => undefined,
        },
        onOwnersChange: owners => ownerEvents.push(owners),
        warn: () => undefined,
        ...over,
    });
    return {
        arbiter,
        state,
        writes,
        failWrite,
        ownerEvents,
        advance: (ms: number) => {
            now += ms;
        },
    };
}

describe('ActuatorArbiter', () => {
    test('claim resolves applied=true after reconcile (enforce)', async () => {
        const { arbiter, state, writes } = setup();
        await arbiter.start();

        const result = await arbiter.claim({
            key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:cmd-1', expiresAt: T0 + 60_000,
        });

        expect(result).toEqual({ applied: true, actual: true, mode: 'enforce' });
        expect(writes).toEqual(['valve_1=true']);
        expect(state.valve_1).toBe(true);
        expect(arbiter.owners()).toEqual({
            valve_1: { source: 'manual', ownerId: 'manual:cmd-1', expiresAt: T0 + 60_000 },
        });
        await arbiter.stop();
    });

    test('two claims before one tick: the newest wins, the earlier caller is told blocked_by', async () => {
        const { arbiter, writes } = setup();
        await arbiter.start();

        const first = arbiter.claim({ key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:a', expiresAt: T0 + 60_000 });
        const second = arbiter.claim({ key: 'valve_1', value: false, source: 'manual', ownerId: 'manual:b', expiresAt: T0 + 60_000 });

        expect(await first).toEqual({ applied: false, actual: false, blockedBy: 'manual', mode: 'enforce' });
        expect(await second).toEqual({ applied: true, actual: false, mode: 'enforce' });
        expect(writes).toEqual([]);
        await arbiter.stop();
    });

    test('observe never writes: the claim only records ownership', async () => {
        const { arbiter, writes } = setup({ mode: 'observe' });
        await arbiter.start();

        const result = await arbiter.claim({ key: 'valve_1', value: true, source: 'scenario', ownerId: 'scenario:c', expiresAt: T0 + 600_000 });

        expect(result).toEqual({ applied: true, actual: false, mode: 'observe' });
        expect(writes).toEqual([]);
        expect(arbiter.owners().valve_1?.source).toBe('scenario');
        await arbiter.stop();
    });

    test('restart: saved claims reload, expired dropped', async () => {
        const store = new MemoryStore();
        const first = setup({ store });
        await first.arbiter.start();
        await first.arbiter.claim({ key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:long', expiresAt: T0 + 3_600_000 });
        await first.arbiter.claim({ key: 'valve_2', value: true, source: 'manual', ownerId: 'manual:short', expiresAt: T0 + 60_000 });
        await first.arbiter.stop();
        expect(store.rows.map(r => r.ownerId).sort()).toEqual(['manual:long', 'manual:short']);

        const second = setup({ store }, { valve_1: true, valve_2: true });
        second.advance(120_000);
        await second.arbiter.start();

        expect(second.arbiter.owners()).toEqual({
            valve_1: { source: 'manual', ownerId: 'manual:long', expiresAt: T0 + 3_600_000 },
        });
        await second.arbiter.stop();
    });

    test('owners change emits one message', async () => {
        const { arbiter, ownerEvents } = setup();
        await arbiter.start();
        expect(ownerEvents).toHaveLength(0);

        await arbiter.claim({ key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:x', expiresAt: T0 + 60_000 });
        await arbiter.tick();
        await arbiter.claim({ key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:x', expiresAt: T0 + 60_000 });

        expect(ownerEvents).toEqual([{ valve_1: { source: 'manual', ownerId: 'manual:x', expiresAt: T0 + 60_000 } }]);

        await arbiter.release('manual:*');
        expect(ownerEvents).toHaveLength(2);
        expect(ownerEvents[1]).toEqual({});
        await arbiter.stop();
    });

    test('expired lease: the tick drops the claim and drives a managed key OFF', async () => {
        const { arbiter, state, advance } = setup();
        await arbiter.start();
        await arbiter.claim({ key: 'valve_2', value: true, source: 'manual', ownerId: 'manual:l', expiresAt: T0 + 60_000 });
        expect(state.valve_2).toBe(true);

        advance(60_000);
        await arbiter.tick();

        expect(state.valve_2).toBe(false);
        expect(arbiter.owners()).toEqual({});
        await arbiter.stop();
    });

    test('stop() after the DataSource was closed by another node does not warn and keeps the rows saved while running', async () => {
        const store = new MemoryStore();
        const warns: string[] = [];
        const { arbiter } = setup({ store, warn: m => warns.push(m) });
        await arbiter.start();
        await arbiter.claim({ key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:s', expiresAt: T0 + 600_000 });
        expect(store.saves).toBeGreaterThan(0);

        store.available = false;
        await arbiter.stop();

        expect(warns).toEqual([]);
        expect(store.rows.map(r => r.ownerId)).toEqual(['manual:s']);
    });

    test('leaseMs: manual from the key policy, scenario and alarm_action from ARBITER_SCENARIO_LEASE_S', () => {
        const { arbiter } = setup();
        expect(arbiter.leaseMs('manual', 'valve_1')).toBe(1_800_000);
        expect(arbiter.leaseMs('manual', 'valve_2')).toBe(60_000);
        expect(arbiter.leaseMs('scenario', 'valve_1')).toBe(600_000);
        expect(arbiter.leaseMs('alarm_action', 'valve_1')).toBe(600_000);
    });

    test('3 failed write ticks raise actuator_write_failed once; a good write clears it', async () => {
        const outbox = {
            raise: jest.fn().mockResolvedValue(true),
            clear: jest.fn().mockResolvedValue(true),
            activeAlarms: jest.fn().mockResolvedValue([]),
        };
        const { arbiter, failWrite } = setup({ outbox: () => outbox, deviceId: () => 'device-1' });
        await arbiter.start();
        failWrite.add('valve_1');

        await arbiter.claim({ key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:f', expiresAt: T0 + 600_000 });
        await arbiter.tick();
        expect(outbox.raise).not.toHaveBeenCalled();
        await arbiter.tick();
        await arbiter.tick();

        expect(outbox.raise).toHaveBeenCalledTimes(1);
        expect(outbox.raise).toHaveBeenCalledWith('actuator_write_failed:valve_1', expect.objectContaining({
            alarm_key: 'actuator_write_failed:valve_1',
            message_key: 'iot.notification.device.actuator_write_failed',
            message_params: expect.objectContaining({ key: 'valve_1' }),
            severity: 'error',
            id: 'device-1',
        }));

        failWrite.clear();
        await arbiter.tick();
        expect(outbox.clear).toHaveBeenCalledTimes(1);
        expect(outbox.clear).toHaveBeenCalledWith('actuator_write_failed:valve_1', expect.objectContaining({
            alarm_key: 'actuator_write_failed:valve_1',
        }));
        await arbiter.stop();
    });

    test('no event outbox (null): failing writes raise nothing and never throw', async () => {
        const { arbiter, failWrite } = setup({ outbox: () => null });
        await arbiter.start();
        failWrite.add('valve_1');

        const result = await arbiter.claim({ key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:n', expiresAt: T0 + 600_000 });
        await arbiter.tick();
        await arbiter.tick();
        await arbiter.tick();

        expect(result).toEqual({ applied: true, actual: false, mode: 'enforce' });
        await arbiter.stop();
    });
});

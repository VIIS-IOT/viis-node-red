/**
 * Plan Task 13: with the actuator arbiter enforcing, an OFFLINE scenario write (the intent chain into
 * viis-modbus-flex) to a managed coil becomes the claim `offline:<intentId>` (source `scenario`) instead of
 * a Modbus write. Every other write is written as today.
 */
import { ActuatorArbiter } from '../../viis-actuator-arbiter/arbiter-api';
import { coilKeysFromMappings, loadActuatorPolicy } from '../../viis-actuator-arbiter/actuator-policy';
import { registerArbiter, unregisterArbiter } from '../../viis-actuator-arbiter/arbiter-registry';
import { classifyActuatorKey } from '../../viis-actuator-arbiter/reconciler';
import { ModbusGetterService, offlineWriteOrigin } from '../services/modbusGetterService';

const T0 = 1_800_000_000_000;

function setup() {
    let now = T0;
    // The writer stamps expiresAt with Date.now(), the arbiter resolves with its own clock: one clock for both.
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const coils: Record<string, boolean> = {};
    const policy = loadActuatorPolicy(
        { valve_1: 'managed' },
        { manualLeaseS: 1800, coilKeys: coilKeysFromMappings({ board1: { coils: { valve_1: 0, valve_2: 1 } } }), warn: () => undefined },
    );
    const arbiter = new ActuatorArbiter({
        policy,
        mode: 'enforce',
        scenarioLeaseS: 600,
        tickMs: 60_000,
        debounceMs: 5,
        reconcilerDeps: {
            targets: [{ key: 'valve_1', boardId: 'board1', address: 0, unitId: 1 }],
            readCoil: async t => coils[t.key] ?? false,
            writeCoil: async (t, value) => { coils[t.key] = value; },
            classify: classifyActuatorKey,
            waterHammerMs: 0,
            sleep: async () => undefined,
        },
        warn: () => undefined,
    });
    const node = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const client = { isConnectedCheck: jest.fn(() => true), writeCoil: jest.fn(async () => undefined) };
    const service = new ModbusGetterService({ node: node as any, nodeId: 'n1', enableLogging: false }, client as any);
    return { arbiter, coils, client, service, advance: (ms: number) => { now += ms; } };
}

const intentMsg = (key: string, value: boolean, intentId = 'intent-7') => ({
    payload: { fc: 5, unitid: 1, address: key === 'valve_1' ? 0 : 1, value, boardId: 'board1' },
    offlineKey: key,
    offlineIntentId: intentId,
});

describe('viis-modbus-flex OFFLINE writes with the arbiter enforcing', () => {
    let ctx: ReturnType<typeof setup>;

    beforeEach(async () => {
        ctx = setup();
        await ctx.arbiter.start();
        registerArbiter(ctx.arbiter);
    });

    afterEach(async () => {
        unregisterArbiter(ctx.arbiter);
        await ctx.arbiter.stop();
        jest.restoreAllMocks();
    });

    test('offline write on managed key becomes a scenario claim; repeat refreshes', async () => {
        const { arbiter, client, service, coils, advance } = ctx;
        const msg = intentMsg('valve_1', true);

        const first: any = await service.processRequest(msg.payload, offlineWriteOrigin(msg, 'intent'));

        expect(first).toMatchObject({ success: true, address: 0, functionCode: 5, value: true });
        expect(client.writeCoil).not.toHaveBeenCalled();
        expect(coils.valve_1).toBe(true);
        expect(arbiter.owners().valve_1).toEqual({ source: 'scenario', ownerId: 'offline:intent-7', expiresAt: T0 + 600_000 });

        advance(60_000);
        await service.processRequest(msg.payload, offlineWriteOrigin(msg, 'intent'));

        // Same owner: the claim is replaced with a new lease, not added.
        expect(arbiter.owners().valve_1).toEqual({ source: 'scenario', ownerId: 'offline:intent-7', expiresAt: T0 + 60_000 + 600_000 });
        expect(client.writeCoil).not.toHaveBeenCalled();
    });

    test('a write the arbiter blocked answers blocked_by and leaves no claim behind', async () => {
        const { arbiter, client, service, coils } = ctx;
        await arbiter.claim({ key: 'valve_1', value: false, source: 'manual', ownerId: 'manual:c1', expiresAt: T0 + 60_000 });
        const msg = { ...intentMsg('valve_1', true), source: 'intent' };

        const response: any = await service.processRequest(msg.payload, offlineWriteOrigin(msg, ''));

        expect(response.error).toBe('blocked_by:manual');
        expect(coils.valve_1).not.toBe(true);
        expect(arbiter.owners().valve_1?.ownerId).toBe('manual:c1');
        await arbiter.release('manual:c1');
        expect(arbiter.owners().valve_1).toBeUndefined();
        expect(client.writeCoil).not.toHaveBeenCalled();
    });

    test('unmanaged key and writes from outside the intent chain are written as today', async () => {
        const { client, service } = ctx;
        const unmanaged = intentMsg('valve_2', true);
        await service.processRequest(unmanaged.payload, offlineWriteOrigin(unmanaged, 'intent'));
        const other = { payload: { fc: 5, unitid: 1, address: 0, value: true } };
        await service.processRequest(other.payload, offlineWriteOrigin(other, ''));

        expect(client.writeCoil.mock.calls).toEqual([[1, true], [0, true]]);
    });

    test('a managed key whose action targets another coil is written directly to that address', async () => {
        const { arbiter, client, service } = ctx;
        const explicit = { ...intentMsg('valve_1', true), payload: { fc: 5, unitid: 1, address: 7, value: true, boardId: 'board1' } };
        await service.processRequest(explicit.payload, offlineWriteOrigin(explicit, 'intent', 'board1'));
        const otherBoard = intentMsg('valve_1', true);
        await service.processRequest(otherBoard.payload, offlineWriteOrigin(otherBoard, 'intent', 'board2'));

        expect(client.writeCoil.mock.calls).toEqual([[7, true], [0, true]]);
        expect(arbiter.owners().valve_1).toBeUndefined();
    });
});

describe('offlineWriteOrigin', () => {
    test('intent chain by msg.source or by the node config; anything else is not', () => {
        expect(offlineWriteOrigin({ source: 'intent', offlineKey: 'valve_1', offlineIntentId: 'i1' }, '')).toEqual({ key: 'valve_1', intentId: 'i1' });
        expect(offlineWriteOrigin({ offlineKey: 'valve_1' }, 'intent')).toEqual({ key: 'valve_1', intentId: null });
        expect(offlineWriteOrigin({ offlineKey: 'valve_1' }, '')).toBeNull();
    });
});

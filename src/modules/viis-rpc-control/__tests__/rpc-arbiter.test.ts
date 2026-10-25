/**
 * Plan Task 12: with the arbiter in `enforce`, an RPC write to a managed coil (fc=5) becomes a claim
 * (source from the envelope, missing = manual) and the ACK says whether that claim won. Unmanaged keys,
 * holdings and `ARBITER_MODE` off keep today's direct write.
 */
import { RpcHandler } from '../handlers/rpcHandler';
import { registerArbiter, unregisterArbiter } from '../../viis-actuator-arbiter/arbiter-registry';
import type { ActuatorArbiterApi, ClaimResult } from '../../viis-actuator-arbiter/arbiter-api';

const CMD = '11111111-2222-4333-8444-555555555555';
const NOW = 1_800_000_000_000;

function fakeArbiter(mode: 'observe' | 'enforce', result: Partial<ClaimResult> = {}) {
    const arbiter = {
        manages: jest.fn((key: string) => key === 'valve_1'),
        keyMode: jest.fn((key: string) => (key === 'valve_1' ? 'managed' as const : 'unmanaged' as const)),
        target: jest.fn((key: string) => (key === 'valve_1' ? { key, boardId: 'board1', address: 0 } : undefined)),
        mode: jest.fn(() => mode),
        leaseMs: jest.fn((source: string) => (source === 'manual' ? 1_800_000 : source === 'alarm_action' ? null : 600_000)),
        claim: jest.fn().mockResolvedValue({ applied: true, actual: true, mode, ...result }),
        release: jest.fn().mockResolvedValue(undefined),
        owners: jest.fn(() => ({})),
    };
    return arbiter;
}

function createHandler() {
    const mqtt = {
        publishRpcResponse: jest.fn().mockResolvedValue(undefined),
        publishResult: jest.fn().mockResolvedValue(undefined),
        publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
        publishError: jest.fn().mockResolvedValue(undefined),
        isConnected: () => true,
    };
    const modbus = {
        getModbusHoldingRegisters: () => ({}),
        getModbusCoils: () => ({ valve_1: 0, main_pump: 3 }),
        findModbusMapping: (key: string) =>
            ({ valve_1: { address: 0, fc: 5, value: false, boardId: 'board1' }, main_pump: { address: 3, fc: 5, value: false, boardId: 'board1' } } as any)[key] ?? null,
        writeToModbus: jest.fn().mockResolvedValue(undefined),
        readFromModbus: jest.fn().mockResolvedValue(true),
        updateGlobalContextCacheAfterVerification: jest.fn(),
        checkConnection: jest.fn(),
    };
    const node = {
        status: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn(),
        context: () => ({ global: { get: () => undefined }, get: jest.fn(), set: jest.fn() }),
    };
    const handler = new RpcHandler(
        { node, flowContext: {}, globalContext: {} } as any,
        {} as any,
        { validateAndConvertValue: (_key: string, value: unknown) => value } as any,
        modbus as any,
        mqtt as any,
        { processRpcBody: jest.fn().mockResolvedValue(false), luoiMapping: {} } as any,
    );
    return { handler, mqtt, modbus };
}

let registered: ActuatorArbiterApi | null = null;
function use<T extends ActuatorArbiterApi>(arbiter: T): T {
    registered = arbiter;
    registerArbiter(arbiter);
    return arbiter;
}

beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
    if (registered) unregisterArbiter(registered);
    registered = null;
    jest.restoreAllMocks();
});

describe('RPC through the actuator arbiter', () => {
    test('managed key ON → claim with manual lease, writeCoil not called by rpc', async () => {
        const arbiter = use(fakeArbiter('enforce'));
        const { handler, mqtt, modbus } = createHandler();

        await handler.handleRpcRequest({ method: 'set_state', command_id: CMD, params: { valve_1: true } });

        expect(arbiter.claim).toHaveBeenCalledWith({
            key: 'valve_1', value: true, source: 'manual', ownerId: `manual:${CMD}`, expiresAt: NOW + 1_800_000,
        });
        expect(modbus.writeToModbus).not.toHaveBeenCalled();
        expect(mqtt.publishResult).toHaveBeenCalledWith('valve_1', true);
        expect(mqtt.publishRpcResponse).toHaveBeenCalledWith(CMD, expect.objectContaining({ success: true, status: 'ACKED' }));
    });

    test('missing source → manual; a remote caller cannot claim as safety', async () => {
        const arbiter = use(fakeArbiter('enforce'));
        const { handler } = createHandler();

        await handler.handleRpcRequest({ method: 'set_state', command_id: CMD, source: 'safety', params: { valve_1: true } });

        expect(arbiter.claim).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual', ownerId: `manual:${CMD}` }));
    });

    test('source scenario keeps scenario (also through the mobile `control` method)', async () => {
        const arbiter = use(fakeArbiter('enforce'));
        const { handler } = createHandler();

        await handler.handleRpcRequest({ method: 'control', command_id: CMD, source: 'scenario', params: { key: 'valve_1', value: true } });

        expect(arbiter.claim).toHaveBeenCalledWith({
            key: 'valve_1', value: true, source: 'scenario', ownerId: `scenario:${CMD}`, expiresAt: NOW + 600_000,
        });
    });

    test('an alarm_action claim never lapses: expiresAt null', async () => {
        const arbiter = use(fakeArbiter('enforce'));
        const { handler } = createHandler();

        await handler.handleRpcRequest({ method: 'set_state', command_id: CMD, source: 'alarm_action', params: { valve_1: false } });

        expect(arbiter.claim).toHaveBeenCalledWith({
            key: 'valve_1', value: false, source: 'alarm_action', ownerId: `alarm_action:${CMD}`, expiresAt: null,
        });
    });

    test('earlier caller gets FAILED blocked_by (manual claim exists, scenario claim loses)', async () => {
        const arbiter = use(fakeArbiter('enforce', { applied: false, actual: false, blockedBy: 'manual' }));
        const { handler, mqtt, modbus } = createHandler();

        await handler.handleRpcRequest({ method: 'set_state', command_id: CMD, source: 'scenario', params: { valve_1: true } });

        expect(mqtt.publishRpcResponse).toHaveBeenCalledTimes(1);
        expect(mqtt.publishRpcResponse).toHaveBeenCalledWith(CMD, expect.objectContaining({
            success: false, status: 'FAILED', error: 'blocked_by:manual',
        }));
        // Told FAILED, so the losing claim is withdrawn and never takes effect later.
        expect(arbiter.release).toHaveBeenCalledWith(`scenario:${CMD}`, 'valve_1');
        expect(arbiter.claim).toHaveBeenCalledTimes(1);
        expect(modbus.writeToModbus).not.toHaveBeenCalled();
    });

    test('won but the coil did not follow (Modbus down) → FAILED and the claim is withdrawn (never applied later)', async () => {
        const arbiter = use(fakeArbiter('enforce', { applied: true, actual: undefined }));
        const { handler, mqtt } = createHandler();

        await handler.handleRpcRequest({ method: 'set_state', command_id: CMD, params: { valve_1: true } });

        expect(mqtt.publishRpcResponse).toHaveBeenCalledWith(CMD, expect.objectContaining({
            status: 'FAILED', error: expect.stringContaining('not_confirmed:valve_1'),
        }));
        expect(arbiter.release).toHaveBeenCalledWith(`manual:${CMD}`, 'valve_1');
    });

    test('device protection held the ON back at the tick → FAILED Protection blocked and the claim is withdrawn', async () => {
        const arbiter = use(fakeArbiter('enforce', { applied: true, actual: false, gateBlocked: 'Force OFF active' }));
        const { handler, mqtt } = createHandler();

        await handler.handleRpcRequest({ method: 'set_state', command_id: CMD, params: { valve_1: true } });

        expect(mqtt.publishRpcResponse).toHaveBeenCalledWith(CMD, expect.objectContaining({
            status: 'FAILED', error: 'Protection blocked: Force OFF active',
        }));
        expect(arbiter.release).toHaveBeenCalledWith(`manual:${CMD}`, 'valve_1');
    });

    test('deadline passed while the claim was waiting → the claim is withdrawn even if it won', async () => {
        const arbiter = use(fakeArbiter('enforce', { applied: true, actual: true }));
        arbiter.claim.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ applied: true, actual: true, mode: 'enforce' }), 4000)));
        const { handler, mqtt } = createHandler();
        jest.useFakeTimers();
        try {
            const done = handler.handleRpcRequest({ method: 'set', command_id: CMD, params: { key: 'valve_1', value: true }, timeout: 5000 });
            await jest.advanceTimersByTimeAsync(10000);
            await done;
        } finally {
            jest.useRealTimers();
        }

        expect(mqtt.publishRpcResponse).toHaveBeenCalledTimes(1);
        expect(mqtt.publishRpcResponse).toHaveBeenCalledWith(CMD, expect.objectContaining({ status: 'FAILED' }));
        expect(arbiter.release).toHaveBeenCalledWith(`manual:${CMD}`, 'valve_1');
    });

    test('unmanaged key → direct write as today', async () => {
        const arbiter = use(fakeArbiter('enforce'));
        const { handler, modbus, mqtt } = createHandler();

        await handler.handleRpcRequest({ method: 'set_state', command_id: CMD, params: { main_pump: true } });

        expect(arbiter.claim).not.toHaveBeenCalled();
        expect(modbus.writeToModbus).toHaveBeenCalledWith('main_pump', expect.objectContaining({ fc: 5 }), true);
        expect(mqtt.publishRpcResponse).toHaveBeenCalledWith(CMD, expect.objectContaining({ status: 'ACKED' }));
    });

    test('ARBITER_MODE off (no arbiter) → direct write; release_claims stays an unsupported method', async () => {
        const { handler, modbus, mqtt } = createHandler();

        await handler.handleRpcRequest({ method: 'set_state', command_id: CMD, params: { valve_1: true } });
        expect(modbus.writeToModbus).toHaveBeenCalledWith('valve_1', expect.objectContaining({ fc: 5 }), true);

        mqtt.publishRpcResponse.mockClear();
        await handler.handleRpcRequest({ method: 'release_claims', command_id: '21111111-2222-4333-8444-555555555555', params: {} });
        expect(mqtt.publishRpcResponse).not.toHaveBeenCalled();
    });

    test('observe → writes as today and records the claim', async () => {
        const arbiter = use(fakeArbiter('observe'));
        const { handler, modbus } = createHandler();

        await handler.handleRpcRequest({ method: 'set_state', command_id: CMD, params: { valve_1: true } });

        expect(modbus.writeToModbus).toHaveBeenCalledWith('valve_1', expect.objectContaining({ fc: 5 }), true);
        expect(arbiter.claim).toHaveBeenCalledWith(expect.objectContaining({ key: 'valve_1', source: 'manual', value: true }));
    });

    test('release_claims drops manual claims (given keys or all) and ACKs', async () => {
        const arbiter = use(fakeArbiter('enforce'));
        const { handler, mqtt } = createHandler();

        await handler.handleRpcRequest({ method: 'release_claims', command_id: CMD, params: { keys: ['valve_1'] } });
        expect(arbiter.release).toHaveBeenCalledWith('manual:*', 'valve_1');
        expect(mqtt.publishRpcResponse).toHaveBeenCalledWith(CMD, expect.objectContaining({ success: true, status: 'ACKED', method: 'release_claims' }));

        arbiter.release.mockClear();
        await handler.handleRpcRequest({ method: 'release_claims', command_id: '31111111-2222-4333-8444-555555555555' });
        expect(arbiter.release).toHaveBeenCalledWith('manual:*');
    });

    test('release_claims with source alarm_action drops only alarm_action claims; another source is refused', async () => {
        const arbiter = use(fakeArbiter('enforce'));
        const { handler, mqtt } = createHandler();

        await handler.handleRpcRequest({ method: 'release_claims', command_id: CMD, params: { source: 'alarm_action', keys: ['valve_1'] } });
        expect(arbiter.release).toHaveBeenCalledWith('alarm_action:*', 'valve_1');
        expect(arbiter.release).not.toHaveBeenCalledWith('manual:*', expect.anything());
        expect(mqtt.publishRpcResponse).toHaveBeenCalledWith(CMD, expect.objectContaining({ success: true, status: 'ACKED' }));

        arbiter.release.mockClear();
        await handler.handleRpcRequest({ method: 'release_claims', command_id: '41111111-2222-4333-8444-555555555555', params: { source: 'alarm_action' } });
        expect(arbiter.release).toHaveBeenCalledWith('alarm_action:*');

        arbiter.release.mockClear();
        await handler.handleRpcRequest({ method: 'release_claims', command_id: '51111111-2222-4333-8444-555555555555', params: { source: 'safety' } });
        expect(arbiter.release).not.toHaveBeenCalled();
        expect(mqtt.publishRpcResponse).toHaveBeenLastCalledWith('51111111-2222-4333-8444-555555555555', expect.objectContaining({ success: false, status: 'FAILED' }));
    });
});

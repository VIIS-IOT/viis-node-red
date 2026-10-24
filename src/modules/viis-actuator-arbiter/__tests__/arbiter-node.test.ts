/**
 * Plan Task 12: the viis-actuator-arbiter node. With ARBITER_MODE off (the default) it registers nothing,
 * so getArbiter() stays null and every writer keeps today's direct writes. In observe/enforce it builds
 * the managed coil targets from MODBUS_BOARDS + per-board coils and registers the arbiter until it closes.
 */
import { EventEmitter } from 'events';
import ClientRegistry from '../../../core/client-registry';
import { DataSourceManager } from '../../../orm/dataSource';
import { getArbiter } from '../arbiter-registry';
import { buildCoilTargets } from '../arbiter-targets';

jest.mock('../../../core/client-registry', () => ({
    __esModule: true,
    default: {
        initializeMultiBoardConfig: jest.fn(),
        getModbusClientV2: jest.fn(),
        releaseClientV2: jest.fn(),
    },
}));
jest.mock('../../../orm/dataSource', () => ({
    DataSourceManager: { acquire: jest.fn(), release: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../ultils/device-config-file', () => ({ getDeviceConfigFileValue: jest.fn(() => undefined) }));

const registerArbiterNode = require('../viis-actuator-arbiter') as (RED: any) => void;

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** globals get this run's env-loader stamp unless the test sets env_loader_loaded_at itself. */
function startNode(input: Record<string, unknown>) {
    const globals: Record<string, unknown> = { env_loader_loaded_at: Date.now(), ...input };
    let NodeType: any;
    const events = new EventEmitter();
    const node: any = {};
    const RED = {
        nodes: {
            createNode(target: any, config: any) {
                target.id = config.id;
                target.on = events.on.bind(events);
                target.status = jest.fn();
                target.send = jest.fn();
                for (const method of ['log', 'warn', 'error', 'debug']) target[method] = jest.fn();
                target.context = () => ({
                    global: { get: (key: string) => globals[key], set: jest.fn() },
                    get: jest.fn(),
                    set: jest.fn(),
                });
            },
            registerType: (_name: string, ctor: any) => {
                NodeType = ctor;
            },
        },
    };
    registerArbiterNode(RED);
    NodeType.call(node, { id: 'arbiter-1', debugEnable: false });
    const close = () =>
        new Promise<void>(resolve => {
            const listeners = events.listeners('close');
            if (listeners.length === 0) return resolve();
            (listeners[0] as any)(() => resolve());
        });
    return { node, close, globals };
}

const BOARDS = JSON.stringify([{ id: 'board1', type: 'TCP', host: 'sim', tcpPort: 502, unitId: 1 }]);

describe('viis-actuator-arbiter node', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue({
            isConnected: true,
            readCoils: jest.fn().mockResolvedValue({ data: [false] }),
            writeCoil: jest.fn().mockResolvedValue(undefined),
        });
        const rows: any[] = [];
        (DataSourceManager.acquire as jest.Mock).mockResolvedValue({
            query: jest.fn().mockResolvedValue(undefined),
            getRepository: () => ({ find: async () => rows }),
            transaction: jest.fn().mockResolvedValue(undefined),
        });
    });

    test('ARBITER_MODE=off → getArbiter() null, no Modbus client, no database', async () => {
        const { node, close } = startNode({ arbiter_mode: 'off', modbus_boards: BOARDS, actuator_policy: '{"valve_1":"managed"}' });
        await flush();

        expect(getArbiter()).toBeNull();
        expect(ClientRegistry.getModbusClientV2).not.toHaveBeenCalled();
        expect(DataSourceManager.acquire).not.toHaveBeenCalled();
        expect(node.status).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('off') }));
        await close();
    });

    test('missing ARBITER_MODE is off', async () => {
        const { close } = startNode({ modbus_boards: BOARDS });
        await flush();
        expect(getArbiter()).toBeNull();
        await close();
    });

    test('enforce registers the arbiter for managed keys until the node closes', async () => {
        const { close } = startNode({
            arbiter_mode: 'enforce',
            modbus_boards: BOARDS,
            modbus_board1_coils: { valve_1: 0, main_pump: 3 },
            actuator_policy: '{"valve_1":"managed"}',
        });
        await flush();
        await flush();

        const arbiter = getArbiter();
        expect(arbiter).not.toBeNull();
        expect(arbiter!.mode()).toBe('enforce');
        expect(arbiter!.manages('valve_1')).toBe(true);
        expect(arbiter!.manages('main_pump')).toBe(false);

        await close();
        expect(getArbiter()).toBeNull();
        expect(DataSourceManager.release).toHaveBeenCalledTimes(1);
    });

    test('a new env_loader_loaded_at reloads the manual lease on the next tick; a changed key list only warns', async () => {
        const { node, globals, close } = startNode({
            arbiter_mode: 'enforce',
            modbus_boards: BOARDS,
            modbus_board1_coils: { valve_1: 0, valve_2: 1 },
            actuator_policy: '{"valve_1":"managed"}',
            arbiter_manual_lease_s: '90',
        });
        await flush();
        await flush();
        const arbiter = getArbiter()!;
        expect(arbiter.leaseMs('manual', 'valve_1')).toBe(90_000);

        // device1.json was synced: new lease and one more managed key, with a fresh load stamp.
        globals.arbiter_manual_lease_s = '120';
        globals.actuator_policy = '{"valve_1":"managed","valve_2":"managed"}';
        globals.env_loader_loaded_at = Date.now() + 1;
        await arbiter.claim({ key: 'valve_1', value: true, source: 'manual', ownerId: 'manual:r1', expiresAt: Date.now() + 60_000 });

        expect(arbiter.leaseMs('manual', 'valve_1')).toBe(120_000);
        expect(arbiter.manages('valve_2')).toBe(false);
        expect(node.warn).toHaveBeenCalledWith(expect.stringContaining('redeploy'));
        await close();
    });

    test('waits for the env-loader stamp of this run before reading ARBITER_MODE', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate'] });
        try {
            // A stamp from an earlier run: the persisted arbiter_mode may be stale, so nothing starts yet.
            const { globals, close } = startNode({
                env_loader_loaded_at: Date.now() - 3_600_000,
                arbiter_mode: 'enforce',
                modbus_boards: BOARDS,
                modbus_board1_coils: { valve_1: 0 },
                actuator_policy: '{"valve_1":"managed"}',
            });
            await jest.advanceTimersByTimeAsync(2000);
            expect(getArbiter()).toBeNull();

            globals.env_loader_loaded_at = Date.now();
            await jest.advanceTimersByTimeAsync(1000);
            await flush();
            expect(getArbiter()).not.toBeNull();
            await close();
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('buildCoilTargets', () => {
    test('per-board coils name their board; legacy MODBUS_COILS go to the default board', () => {
        const targets = buildCoilTargets(
            [{ id: 'board1', unitId: 1 }, { id: 'board2', unitId: 2 }],
            id => (id === 'board1' ? { valve_1: 0 } : { valve_2: 5 }),
            { valve_1: 9, light_1: 4 },
            'board1',
        );

        expect(targets).toEqual([
            { key: 'valve_1', boardId: 'board1', address: 0, unitId: 1 },
            { key: 'valve_2', boardId: 'board2', address: 5, unitId: 2 },
            { key: 'light_1', boardId: 'board1', address: 4, unitId: 1 },
        ]);
    });
});

import { EventEmitter } from 'events';

let mockBoardOnline = false;
const mockEvents: any[] = [];
jest.mock('../../../core/observability/runtime', () => ({
    runtimeBootId: 'fake-boot',
    getDiagnosticRuntime: () => ({
        emit: (_node: any, _component: any, _level: any, event: string, fields: any) => mockEvents.push({ event, ...fields }),
        getStatus: () => ({ status: 'healthy' }),
    }),
}));
jest.mock('../../../core/client-registry', () => {
    const { EventEmitter } = require('events');
    class Mqtt extends EventEmitter {
        publications: any[] = [];
        isConnected = () => true;
        waitForConnection = async () => undefined;
        subscribe = jest.fn(async () => undefined);
        resetCircuitBreaker = () => undefined;
        getDiagnosticState = () => ({ connected: true });
        publish = async (topic: string, payload: string) => { this.publications.push({ topic, payload: JSON.parse(payload) }); };
    }
    const cloud = new Mqtt(); const local = new Mqtt();
    const board = {
        coils: new Map<number, boolean>(), writes: [] as any[],
        get isConnected() { return mockBoardOnline; },
        isConnectedCheck: () => mockBoardOnline, getDiagnosticState: () => ({ connected: mockBoardOnline }),
        async writeCoil(address: number, value: boolean) {
            if (!mockBoardOnline) throw new Error('fake board offline');
            board.coils.set(address, value); board.writes.push({ address, value });
        },
        async readCoils(address: number) { return { data: [board.coils.get(address) ?? false] }; },
    };
    return { __esModule: true, default: {
        cloud, local, board,
        initializeMultiBoardConfig: jest.fn(),
        getModbusClientV2: jest.fn(async () => board),
        getThingsboardMqttClient: jest.fn(async () => cloud),
        getLocalMqttClient: jest.fn(async () => local),
        releaseClientV2: jest.fn(), releaseClient: jest.fn(),
    } };
});

const Registry = require('../../../core/client-registry').default;
const register = require('../viis-rpc-control');

function makeNode(role: string) {
    const globalStore = new Map<string, any>(Object.entries({
        device_id: 'fake-device', device_access_token: 'fake-token',
        modbus_boards: [{ id: 'board1', type: 'TCP', host: 'fake.invalid', tcpPort: 502, unitId: 1 }],
        modbus_default_board: 'board1',
        modbus_board1_coils: { input_pump: 1 },
    }));
    const flowStore = new Map(); const nodeStore = new Map();
    const store = (data: Map<any, any>) => ({ get: (key: string) => data.get(key), set: (key: string, value: any) => data.set(key, value) });
    let Constructor: any;
    register({ nodes: {
        createNode(node: any, config: any) {
            Object.assign(node, { id: config.id, context: () => ({ ...store(nodeStore), global: store(globalStore), flow: store(flowStore) }),
                log: jest.fn(), warn: jest.fn(), error: jest.fn(), status: jest.fn(), send: jest.fn() });
        },
        registerType(_type: string, ctor: any) { Constructor = ctor; },
    } });
    const node: any = new EventEmitter();
    Constructor.call(node, { id: 'fake-'+role, mqttBroker: role, configKeys: [], scaleConfigs: [], waterHammerDelay: 0 });
    return node;
}

describe('RPC initialization while the board is offline at boot', () => {
    beforeEach(() => {
        jest.useFakeTimers(); jest.spyOn(Math, 'random').mockReturnValue(0);
        mockBoardOnline = false; mockEvents.length = 0;
        jest.clearAllMocks(); Registry.cloud.removeAllListeners(); Registry.local.removeAllListeners();
        Registry.cloud.publications.length = 0; Registry.local.publications.length = 0;
        Registry.board.coils.clear(); Registry.board.writes.length = 0;
    });
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

    for (const role of ['thingsboard', 'local']) {
        it(`attaches ${role} RPC ingress despite offline board, and remains attached when the board recovers`, async () => {
            const node = makeNode(role);
            await jest.advanceTimersByTimeAsync(5000);
            expect(mockEvents.some(x => x.event === 'node.ready')).toBe(true);
            const mqtt = role === 'thingsboard' ? Registry.cloud : Registry.local;
            expect(mqtt.listenerCount('mqtt-message')).toBe(1);
            expect(Registry.board.writes).toEqual([]);
            mockBoardOnline = true;
            await jest.advanceTimersByTimeAsync(31000);
            const health = mockEvents.filter(x => x.event === 'rpc.health_snapshot').at(-1);
            expect(health.initPhase).toBe('ready');
            expect(health.handlerAttached).toBe(true);
            expect(health.modbus.connected).toBe(true);
            expect(mqtt.listenerCount('mqtt-message')).toBe(1);
            mqtt.emit('mqtt-message', { message: {
                topic: role === 'thingsboard' ? 'v1/devices/me/rpc/request/123' : 'v1/devices/me/rpc/request/fake-device',
                message: JSON.stringify({ method: 'set_state', params: { input_pump: true, requestId: 'fake-'+role } }),
                qos: 1, retain: false,
            } });
            await jest.advanceTimersByTimeAsync(5000);
            expect(Registry.board.writes).toEqual([{ address: 1, value: true }]);
            expect(Registry.board.coils.get(1)).toBe(true);
            expect(mockEvents.some(x => x.event === 'modbus.readback_observed' && x.readbackOutcome === 'succeeded')).toBe(true);
            expect(mockEvents.some(x => x.event === 'rpc.delivery_finished' && x.controlOutcome === 'success' && x.deliveryOutcome === 'acknowledged')).toBe(true);
            expect(mqtt.publications.some((x: any) => x.payload.input_pump === true)).toBe(true);
            node.emit('close', () => undefined);
        });
    }

    it('releases the default multi-board ownership when closing after offline startup', async () => {
        const node = makeNode('thingsboard');
        await jest.advanceTimersByTimeAsync(5000);
        node.emit('close', () => undefined);
        expect(Registry.releaseClientV2).toHaveBeenCalledWith('modbus-board', node, 'board1');
    });

    it('keeps following the configured default board on manual reload', async () => {
        const node = makeNode('thingsboard');
        await jest.advanceTimersByTimeAsync(5000);
        node.context().global.set('modbus_default_board', 'board2');
        node.emit('input', { topic: 'reload-modbus-config' });
        await jest.advanceTimersByTimeAsync(1);
        expect(Registry.getModbusClientV2).toHaveBeenLastCalledWith('board2', node);
        node.emit('close', () => undefined);
    });
});

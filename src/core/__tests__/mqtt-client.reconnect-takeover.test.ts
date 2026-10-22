import { EventEmitter } from 'events';

/** Minimal mqtt.js client: the test drives its events by hand. */
class FakeClient extends EventEmitter {
    connected = false;
    ended = false;
    publish(_t: string, _m: unknown, _o: unknown, cb?: (err?: Error) => void) { cb?.(); }
    subscribe(_t: string, _o: unknown, cb?: (err?: Error) => void) { cb?.(); }
    end(_force?: boolean, _opts?: unknown, cb?: () => void) { this.ended = true; this.connected = false; cb?.(); return this; }
}

const created: FakeClient[] = [];

jest.mock('mqtt', () => ({
    __esModule: true,
    default: {
        connect: jest.fn(() => {
            const client = new FakeClient();
            created.push(client);
            return client;
        }),
    },
}));

import { MqttClientCore } from '../mqtt-client';
import { ConnectionMonitor } from '../connection-monitor';

const fakeNode = () => ({ id: 'n1', warn: jest.fn(), error: jest.fn(), log: jest.fn(), status: jest.fn() }) as any;

describe('MqttClientCore reconnect', () => {
    let core: MqttClientCore;

    beforeEach(() => {
        jest.useFakeTimers();
        core = new MqttClientCore({ broker: 'mqtt://broker', clientId: 'gw-1', deviceId: 'dev-1', qos: 1 }, fakeNode());
        created[0].connected = true;
        created[0].emit('connect');
    });

    afterEach(() => {
        core.forceDisconnect();
        created.splice(0);
        (ConnectionMonitor.getInstance() as any).stopMonitoring?.();
        jest.useRealTimers();
    });

    test('a reconnect closes the client it replaces', () => {
        created[0].connected = false;
        created[0].emit('close');
        jest.advanceTimersByTime(6_000);

        expect(created.length).toBe(2);
        expect(created[0].ended).toBe(true);
        expect(created[0].listenerCount('close')).toBe(0);
        created[1].connected = true;
        created[1].emit('connect');
    });

    test('the replaced client being kicked by the broker does not start another reconnect (session takeover loop)', () => {
        created[0].connected = false;
        created[0].emit('close');
        jest.advanceTimersByTime(6_000);
        expect(created.length).toBe(2);
        created[1].connected = true;
        created[1].emit('connect');

        // Same client id: the broker drops the old session when the new one connects.
        created[0].emit('close');
        jest.advanceTimersByTime(6_000);

        expect(created.length).toBe(2);
        expect(core.isConnected()).toBe(true);
    });
});

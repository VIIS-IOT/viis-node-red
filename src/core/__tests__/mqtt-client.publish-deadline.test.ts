import { EventEmitter } from 'events';

/**
 * A broker that never acks: `publish` keeps the callback and never calls it, like mqtt.js
 * holding a QoS 1 packet in its outgoing store while the session is gone.
 */
class SilentBrokerClient extends EventEmitter {
    connected = true;
    pending: Array<(err?: Error) => void> = [];
    publish(_topic: string, _message: unknown, _opts: unknown, cb: (err?: Error) => void) {
        this.pending.push(cb);
    }
    subscribe(_topic: string, _opts: unknown, cb?: (err?: Error) => void) {
        cb?.();
    }
    end() {
        this.connected = false;
    }
}

const createdClients: SilentBrokerClient[] = [];

jest.mock('mqtt', () => ({
    __esModule: true,
    default: {
        connect: jest.fn(() => {
            const client = new SilentBrokerClient();
            createdClients.push(client);
            return client;
        }),
    },
}));

import { MqttClientCore } from '../mqtt-client';
import { ConnectionMonitor } from '../connection-monitor';

function fakeNode() {
    return { id: 'n1', warn: jest.fn(), error: jest.fn(), log: jest.fn(), status: jest.fn() } as any;
}

describe('MqttClientCore.publish deadline', () => {
    const clients: MqttClientCore[] = [];

    function makeClient(publishTimeoutMs?: number) {
        const core = new MqttClientCore(
            { broker: 'mqtt://silent', clientId: `c${clients.length}`, qos: 1, publishTimeoutMs },
            fakeNode()
        );
        clients.push(core);
        return core;
    }

    afterEach(() => {
        clients.splice(0).forEach((c) => c.forceDisconnect());
        createdClients.splice(0);
        (ConnectionMonitor.getInstance() as any).stopMonitoring?.();
    });

    test('rejects when the broker never acks, instead of hanging forever', async () => {
        const core = makeClient(50);

        const started = Date.now();
        await expect(core.publish('v1/devices/me/telemetry', '{}')).rejects.toThrow(/timed out after 50ms/);
        expect(Date.now() - started).toBeLessThan(1000);
    });

    test('a pending publish is rejected when the underlying client is replaced', async () => {
        const core = makeClient(10_000);

        const pending = core.publish('v1/devices/me/telemetry', '{}');
        // A reconnect builds a new mqtt.js client; the old one's callbacks never fire.
        (core as any).initializeClient();

        await expect(pending).rejects.toThrow(/client replaced/);
    });

    test('a pending publish is rejected on force disconnect', async () => {
        const core = makeClient(10_000);

        const pending = core.publish('v1/devices/me/telemetry', '{}');
        core.forceDisconnect();

        await expect(pending).rejects.toThrow(/disconnected/);
    });

    test('an acked publish still resolves', async () => {
        const core = makeClient(1_000);

        const pending = core.publish('v1/devices/me/telemetry', '{}');
        createdClients[createdClients.length - 1].pending[0]();

        await expect(pending).resolves.toBeUndefined();
    });
});

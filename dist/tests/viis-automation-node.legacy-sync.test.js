"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Intent sync of the legacy `src/viis-automation-node.ts` (`getMyIntents`): a failed fetch (`null`) must not
 * reach output 2, because the flow treats any list there as the server's authoritative answer.
 */
jest.mock("../core/device", () => ({ getDeviceIntentsByToken: jest.fn() }));
jest.mock("../core/offline-resilience", () => ({ setupGlobalErrorHandlers: jest.fn() }));
const events_1 = require("events");
const device_1 = require("../core/device");
const fetchIntents = device_1.getDeviceIntentsByToken;
const registerLegacyNode = require("../viis-automation-node");
function startNode() {
    const configNode = Object.assign(new events_1.EventEmitter(), { device: { id: "device-1", accessToken: "tok" } });
    const store = {};
    let NodeCtor;
    const RED = {
        nodes: {
            createNode: (node) => Object.assign(node, {
                context: () => ({ get: (key) => store[key], set: (key, value) => { store[key] = value; } }),
                send: jest.fn(),
                status: jest.fn(),
                log: jest.fn(),
                error: jest.fn(),
                on: jest.fn(),
            }),
            getNode: () => configNode,
            registerType: (_type, ctor) => { NodeCtor = ctor; },
        },
    };
    registerLegacyNode(RED);
    const node = {};
    NodeCtor.call(node, { configNode: "config-1" });
    const connect = async () => {
        configNode.emit("mqtt-status", { status: "connected" });
        await new Promise((resolve) => setImmediate(resolve));
    };
    return { node, store, connect };
}
describe("legacy viis-automation-node getMyIntents", () => {
    afterEach(() => fetchIntents.mockReset());
    it("sends nothing and keeps the cached intents when the fetch fails", async () => {
        const { node, store, connect } = startNode();
        const cached = [{ id: "cached-offline", type: "OFFLINE" }];
        store.intents = cached;
        fetchIntents.mockResolvedValue(null);
        await connect();
        expect(fetchIntents).toHaveBeenCalledTimes(1);
        expect(node.send).not.toHaveBeenCalled();
        expect(store.intents).toBe(cached);
    });
    it("sends the server's list on output 2, including an empty one", async () => {
        const { node, store, connect } = startNode();
        fetchIntents.mockResolvedValue([]);
        await connect();
        expect(node.send).toHaveBeenCalledWith([null, { payload: [] }]);
        expect(store.intents).toEqual([]);
    });
});

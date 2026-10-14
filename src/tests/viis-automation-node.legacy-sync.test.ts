/**
 * Intent sync of the legacy `src/viis-automation-node.ts` (`getMyIntents`): a failed fetch (`null`) must not
 * reach output 2, because the flow treats any list there as the server's authoritative answer.
 */
jest.mock("../core/device", () => ({ getDeviceIntentsByToken: jest.fn() }));
jest.mock("../core/offline-resilience", () => ({ setupGlobalErrorHandlers: jest.fn() }));

import { EventEmitter } from "events";
import { getDeviceIntentsByToken } from "../core/device";

const fetchIntents = getDeviceIntentsByToken as jest.Mock;
const registerLegacyNode = require("../viis-automation-node");

function startNode() {
  const configNode = Object.assign(new EventEmitter(), { device: { id: "device-1", accessToken: "tok" } });
  const store: Record<string, unknown> = {};
  let NodeCtor: any;
  const RED = {
    nodes: {
      createNode: (node: any) => Object.assign(node, {
        context: () => ({ get: (key: string) => store[key], set: (key: string, value: unknown) => { store[key] = value; } }),
        send: jest.fn(),
        status: jest.fn(),
        log: jest.fn(),
        error: jest.fn(),
        on: jest.fn(),
      }),
      getNode: () => configNode,
      registerType: (_type: string, ctor: any) => { NodeCtor = ctor; },
    },
  };
  registerLegacyNode(RED);
  const node: any = {};
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

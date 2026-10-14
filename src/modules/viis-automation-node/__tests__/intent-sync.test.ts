/**
 * Intent sync of the registered `viis-automation-node` (modules/viis-automation-node).
 * Output 2 feeds the flow node "Sync server intents to local MySQL", which treats every list it receives as the
 * server's authoritative answer (an empty list clears the local OFFLINE intents). So a failed fetch must send
 * nothing and keep the cached intents.
 */
jest.mock("../../../core/device", () => ({ getDeviceIntentsByToken: jest.fn() }));

import { getDeviceIntentsByToken } from "../../../core/device";
import { AutomationHandler } from "../handlers/automationHandler";
import { IntentService } from "../services/intentService";
import { MqttAutomationService } from "../services/mqttService";
import { ProcessingService } from "../services/processingService";

const fetchIntents = getDeviceIntentsByToken as jest.Mock;

function fakeNode() {
  const store: Record<string, unknown> = {};
  return {
    store,
    context: () => ({ get: (key: string) => store[key], set: (key: string, value: unknown) => { store[key] = value; } }),
    send: jest.fn(),
    status: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function handlerFor(node: ReturnType<typeof fakeNode>) {
  const options = { node, flowContext: {}, globalContext: {} };
  return new AutomationHandler(
    options,
    new IntentService(options, { id: "device-1", accessToken: "tok" }),
    new ProcessingService(options),
    new MqttAutomationService(options),
  );
}

const CACHED = [{ id: "cached-offline", type: "OFFLINE" }];

describe("viis-automation-node intent sync", () => {
  afterEach(() => fetchIntents.mockReset());

  it("sends nothing and keeps the cached intents when the fetch fails", async () => {
    const node = fakeNode();
    node.store.intents = CACHED;
    fetchIntents.mockResolvedValue(null);

    await handlerFor(node).syncIntents();

    expect(node.send).not.toHaveBeenCalled();
    expect(node.store.intents).toBe(CACHED);
  });

  it("sends and stores an empty list when the server lists no intents", async () => {
    const node = fakeNode();
    node.store.intents = CACHED;
    fetchIntents.mockResolvedValue([]);

    await handlerFor(node).syncIntents();

    expect(node.send).toHaveBeenCalledWith([null, { payload: [] }]);
    expect(node.store.intents).toEqual([]);
  });

  it("sends and stores the intents the server lists", async () => {
    const node = fakeNode();
    const listed = [{ id: "intent-1", type: "ONLINE" }];
    fetchIntents.mockResolvedValue(listed);

    await handlerFor(node).syncIntents();

    expect(node.send).toHaveBeenCalledWith([null, { payload: listed }]);
    expect(node.store.intents).toEqual(listed);
  });
});

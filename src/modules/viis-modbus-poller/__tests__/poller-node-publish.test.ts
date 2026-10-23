jest.mock("../../../core/client-registry", () => ({
  __esModule: true,
  default: {
    getModbusClientV2: jest.fn(),
    releaseClientV2: jest.fn(),
    initializeMultiBoardConfig: jest.fn(),
  },
}));

import ClientRegistry from "../../../core/client-registry";

const registerViisModbusPoller = require("../viis-modbus-poller");

type Handler = (msg: any, send: (messages: any[]) => void, done: (error?: unknown) => void) => Promise<void>;

function createPollerNode(nodeConfig: Record<string, unknown>, globals: Record<string, unknown>) {
  let NodeCtor: any;
  const RED = {
    nodes: {
      createNode(node: any) {
        node.handlers = {} as Record<string, Handler>;
        node.on = (event: string, handler: Handler) => {
          node.handlers[event] = handler;
        };
        node.status = jest.fn();
        node.warn = jest.fn();
        node.error = jest.fn();
        node.log = jest.fn();
        node.debug = jest.fn();
        node.send = jest.fn();
        node.context = () => ({
          global: { get: (key: string) => globals[key], set: jest.fn() },
          get: jest.fn(),
          set: jest.fn(),
        });
      },
      registerType(_name: string, ctor: any) {
        NodeCtor = ctor;
      },
    },
  };
  registerViisModbusPoller(RED);
  const node: any = {};
  NodeCtor.call(node, { id: "poller-1", boardId: "board1", ...nodeConfig });

  // Resolves to the [local, thingsboard, diagnostics] outputs of one tick, or null when no telemetry was published.
  return async function poll(): Promise<any[] | null> {
    let published: any[] | null = null;
    await node.handlers.input({}, (messages: any[]) => {
      if (messages[0]) {
        published = messages;
      }
    }, () => undefined);
    return published;
  };
}

function sensorGlobals(threshold: number) {
  return {
    device_id: "device-1",
    modbusMappings: { board1: { holdingRegisters: { volume_1: 36 }, inputRegisters: {}, coils: {} } },
    modbusPollGroups: { sensors: { interval: 1, holding: ["volume_1"] } },
    modbusPublishThresholds: { volume_1: threshold },
  };
}

function holdingClient(readings: number[]) {
  let index = 0;
  return {
    readHoldingRegisters: jest.fn(async (address: number) => ({
      address,
      data: [readings[Math.min(index++, readings.length - 1)]],
    })),
    readCoils: jest.fn(),
    readInputRegisters: jest.fn(),
  };
}

describe("viis-modbus-poller publishing", () => {
  let clock: number;

  beforeEach(() => {
    clock = 1_792_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => (clock += 1000));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("publishes a value whose drift since the last publish reaches the threshold, even when each poll moves less", async () => {
    (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue(holdingClient([10, 13, 16]));
    const poll = createPollerNode({}, sensorGlobals(5));

    expect((await poll())?.[0].payload.volume_1).toBe(10);
    expect(await poll()).toBeNull();

    const third = await poll();
    expect(third?.[0].payload.volume_1).toBe(16);
  });

  it("does not republish while the value stays within the threshold of the last published value", async () => {
    (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue(holdingClient([10, 13, 12]));
    const poll = createPollerNode({}, sensorGlobals(5));

    await poll();
    expect(await poll()).toBeNull();
    expect(await poll()).toBeNull();
  });

  it("sends ThingsBoard telemetry as {ts, values}", async () => {
    (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue(holdingClient([10]));
    const poll = createPollerNode({ enableDiagnostics: false }, sensorGlobals(5));

    const [, thingsboard] = (await poll()) as any[];

    expect(thingsboard.topic).toBe("v1/devices/me/telemetry");
    expect(thingsboard.payload).toEqual({ ts: expect.any(Number), values: { volume_1: 10 } });
  });

  it("keeps the local EMQX payload flat with ts", async () => {
    (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue(holdingClient([10]));
    const poll = createPollerNode({ enableDiagnostics: false }, sensorGlobals(5));

    const [local] = (await poll()) as any[];

    expect(local.topic).toBe("v1/devices/me/telemetry/device-1");
    expect(local.payload).toEqual({ volume_1: 10, ts: expect.any(Number) });
  });

  it("adds _poll_duration_ms only when diagnostics are enabled", async () => {
    (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue(holdingClient([10]));
    const withDiagnostics = await createPollerNode({ enableDiagnostics: true }, sensorGlobals(5))();

    expect(withDiagnostics?.[0].payload._poll_duration_ms).toEqual(expect.any(Number));
    expect(withDiagnostics?.[1].payload.values._poll_duration_ms).toEqual(expect.any(Number));

    (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue(holdingClient([10]));
    const withoutDiagnostics = await createPollerNode({ enableDiagnostics: false }, sensorGlobals(5))();

    expect(withoutDiagnostics?.[0].payload).not.toHaveProperty("_poll_duration_ms");
    expect(withoutDiagnostics?.[1].payload.values).not.toHaveProperty("_poll_duration_ms");
  });
});

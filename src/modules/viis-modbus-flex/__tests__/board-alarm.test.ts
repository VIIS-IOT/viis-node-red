/**
 * Plan Task 8: a Modbus board that trips its circuit breaker (or stays disconnected) is the gateway state
 * alarm `board_offline:<boardId>`, cleared when the board connects again. With the event outbox on it is
 * raised / cleared there; without it the same payload is POSTed once to `/api/v2/alarm/notification-by-token`.
 */
import { EventEmitter } from "events";
import ClientRegistry from "../../../core/client-registry";
import { initEventOutbox, resetEventOutbox } from "../../../services/event-outbox/registry";
import { FakeDataSource } from "../../../services/event-outbox/__tests__/fake-datasource";
import { TabiotEventOutbox } from "../../../orm/entities/event-outbox/TabiotEventOutbox";

jest.mock("../../../core/client-registry", () => ({
  __esModule: true,
  default: {
    initializeMultiBoardConfig: jest.fn(),
    logConnectionCounts: jest.fn(),
    getModbusClientV2: jest.fn(),
    releaseClientV2: jest.fn(),
    reloadModbusConfig: jest.fn(),
  },
}));
jest.mock("../services/modbusGetterService", () => ({ ModbusGetterService: jest.fn() }));
jest.mock("../../../ultils/device-config-file", () => ({ getDeviceConfigFileValue: jest.fn(() => undefined) }));

const registerFlexNode = require("../viis-modbus-flex") as (RED: any) => void;

const TOKEN = "secret-token";
const BACKEND = "http://backend.test";
const GLOBALS = { device_access_token: TOKEN, device_id: "device-1", server_url: BACKEND };

const flushAsyncWork = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Starts viis-modbus-flex nodes for board1 on one shared fake Modbus client. */
async function startFlexNodes(count: number) {
  const modbusClient = new EventEmitter();
  (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue(modbusClient);
  const closers: (() => void)[] = [];
  let NodeType: any;

  const RED = {
    nodes: {
      createNode(node: any, config: any) {
        const events = new EventEmitter();
        node.id = config.id;
        node.on = events.on.bind(events);
        node.status = jest.fn();
        node.send = jest.fn();
        for (const method of ["log", "warn", "error", "debug"]) node[method] = jest.fn();
        node.context = () => ({ global: { get: (key: string) => (GLOBALS as any)[key], set: jest.fn() }, get: jest.fn(), set: jest.fn() });
        closers.push(() => events.emit("close", () => undefined));
      },
      registerType(_name: string, constructor: unknown) {
        NodeType = constructor;
      },
    },
  };

  registerFlexNode(RED);
  for (let i = 1; i <= count; i++) new NodeType({ id: `flex-${i}`, boardId: "board1", enableLogging: false });
  await flushAsyncWork();
  expect(modbusClient.listenerCount("modbus-status")).toBe(count);

  return {
    async emitStatus(event: Record<string, unknown>) {
      modbusClient.emit("modbus-status", event);
      await flushAsyncWork();
      await flushAsyncWork();
    },
    close: () => closers.forEach((close) => close()),
  };
}

const breakerOpen = { status: "circuit-breaker-open", error: "timeout", failedCount: 5 };
const connected = { status: "connected" };

describe("viis-modbus-flex board_offline state alarm", () => {
  let fetchSpy: jest.SpyInstance;
  let flex: Awaited<ReturnType<typeof startFlexNodes>>;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as any);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    flex?.close();
    resetEventOutbox();
    jest.restoreAllMocks();
  });

  it("outbox on: board disconnect → raise('board_offline:board1'), reconnect → clear, no fetch", async () => {
    const ds = new FakeDataSource();
    await initEventOutbox(ds as any, { getEnvVar: (n: string, d?: any) => (n === "EVENT_OUTBOX_ENABLED" ? true : d) }, { intervalMs: 3600000 });
    flex = await startFlexNodes(1);

    await flex.emitStatus(breakerOpen);
    await flex.emitStatus({ status: "prolonged-disconnect", error: "timeout" });
    await flex.emitStatus(connected);

    const rows = ds.getRepository(TabiotEventOutbox).rows.map((r: any) => r.payload);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      alarm_name: "board_offline:board1",
      alarm_key: "board_offline:board1",
      alarm_status: "Pending",
      severity: "error",
      message_key: "iot.notification.device.board_offline",
      message_params: { boardId: "board1", status: "circuit-breaker-open", error: "timeout" },
    });
    expect(rows[1]).toMatchObject({ alarm_key: "board_offline:board1", alarm_status: "Clear", clear_by: "Value" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
  });

  it("outbox off: one POST of the same payload per raise and clear, to the alarm route", async () => {
    flex = await startFlexNodes(1);

    await flex.emitStatus(connected); // nothing raised yet: no Clear
    await flex.emitStatus(breakerOpen);
    await flex.emitStatus(connected);
    await flex.emitStatus(connected); // already cleared

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [url] of fetchSpy.mock.calls) {
      expect(url).toBe(`${BACKEND}/api/v2/alarm/notification-by-token?device_access_token=${TOKEN}`);
      expect(url).not.toContain("/api/v2/notification-by-token");
    }
    const [raised, cleared] = fetchSpy.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(raised).toMatchObject({
      alarm_key: "board_offline:board1",
      alarm_status: "Pending",
      severity: "error",
      message_key: "iot.notification.device.board_offline",
      message_params: { boardId: "board1", status: "circuit-breaker-open" },
      entity: "device-1",
    });
    expect(cleared).toMatchObject({ alarm_key: "board_offline:board1", alarm_status: "Clear", clear_by: "Value" });
  });

  it("only one node per board reports the board", async () => {
    flex = await startFlexNodes(2);

    await flex.emitStatus(breakerOpen);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

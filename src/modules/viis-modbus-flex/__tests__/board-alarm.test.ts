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
jest.mock("../services/modbusGetterService", () => ({ ModbusGetterService: jest.fn(), offlineWriteOrigin: jest.fn(() => null) }));
import { ModbusGetterService } from "../services/modbusGetterService";
jest.mock("../../../ultils/device-config-file", () => ({ getDeviceConfigFileValue: jest.fn(() => undefined) }));

const registerFlexNode = require("../viis-modbus-flex") as (RED: any) => void;

const TOKEN = "secret-token";
const BACKEND = "http://backend.test";
const GLOBALS: Record<string, unknown> = { device_access_token: TOKEN, device_id: "device-1", server_url: BACKEND };

const flushAsyncWork = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Starts viis-modbus-flex nodes for `boardId` on one shared fake Modbus client. */
async function startFlexNodes(count: number, boardId = "board1") {
  const modbusClient = new EventEmitter();
  (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue(modbusClient);
  const processRequest = jest.fn().mockResolvedValue([1]);
  (ModbusGetterService as unknown as jest.Mock).mockImplementation(() => ({ processRequest }));
  const closers: (() => void)[] = [];
  const inputs: Record<string, (msg: any) => Promise<void>> = {};
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
        inputs[config.id] = (msg) => new Promise<void>((resolve) => events.emit("input", msg, jest.fn(), () => resolve()));
      },
      registerType(_name: string, constructor: unknown) {
        NodeType = constructor;
      },
    },
  };

  registerFlexNode(RED);
  for (let i = 1; i <= count; i++) new NodeType({ id: `flex-${i}`, boardId, enableLogging: false });
  await flushAsyncWork();
  expect(modbusClient.listenerCount("modbus-status")).toBe(count);

  return {
    input: inputs,
    processRequest,
    async emitStatus(event: Record<string, unknown>) {
      modbusClient.emit("modbus-status", event);
      await flushAsyncWork();
      await flushAsyncWork();
    },
    close: () => closers.forEach((close) => close()),
  };
}

/** Multi-board mode: `ids` are the nodes (all configured on the first board); each board has its own fake client. */
async function startMultiBoardNodes(ids: string[], boards = ["boardA", "boardB"]) {
  GLOBALS.modbus_boards = boards.map((id) => ({ id }));
  GLOBALS.modbus_default_board = boards[0];
  const clients: Record<string, EventEmitter> = {};
  for (const b of boards) clients[b] = new EventEmitter();
  (ClientRegistry.getModbusClientV2 as jest.Mock).mockImplementation(async (board: string) => clients[board]);
  (ModbusGetterService as unknown as jest.Mock).mockImplementation(() => ({ processRequest: jest.fn().mockResolvedValue([1]) }));
  const closers: (() => void)[] = [];
  const inputs: Record<string, (msg: any) => Promise<void>> = {};
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
        node.context = () => ({ global: { get: (key: string) => GLOBALS[key], set: jest.fn() }, get: jest.fn(), set: jest.fn() });
        closers.push(() => events.emit("close", () => undefined));
        inputs[config.id] = (msg) => new Promise<void>((resolve) => events.emit("input", msg, jest.fn(), () => resolve()));
      },
      registerType(_name: string, constructor: unknown) {
        NodeType = constructor;
      },
    },
  };
  registerFlexNode(RED);
  for (const id of ids) new NodeType({ id, boardId: boards[0], enableLogging: false });
  await flushAsyncWork();
  return {
    input: inputs,
    async emitStatus(board: string, event: Record<string, unknown>) {
      clients[board].emit("modbus-status", event);
      await flushAsyncWork();
      await flushAsyncWork();
    },
    close: () => {
      closers.forEach((close) => close());
      delete GLOBALS.modbus_boards;
      delete GLOBALS.modbus_default_board;
    },
  };
}

const breakerOpen = { status: "circuit-breaker-open", error: "timeout", failedCount: 5 };
const connected = { status: "connected" };

describe("viis-modbus-flex board_offline state alarm", () => {
  let fetchSpy: jest.SpyInstance;
  let flex: { close: () => void } & Record<string, any>;

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

    await flex.emitStatus(connected); // backend state unknown after a start: one Clear
    await flex.emitStatus(breakerOpen);
    await flex.emitStatus(breakerOpen); // still the same down period: no second raise
    await flex.emitStatus({ status: "prolonged-disconnect", error: "timeout" });
    await flex.emitStatus(connected);
    await flex.emitStatus(connected); // already cleared

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const [url] of fetchSpy.mock.calls) {
      expect(url).toBe(`${BACKEND}/api/v2/alarm/notification-by-token?device_access_token=${TOKEN}`);
      expect(url).not.toContain("/api/v2/notification-by-token");
    }
    const [startupClear, raised, cleared] = fetchSpy.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(startupClear).toMatchObject({ alarm_key: "board_offline:board1", alarm_status: "Clear", clear_by: "Value" });
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

  it("outbox off: a failed raise is retried on the next breaker-open; the first healthy read after a start sends one Clear", async () => {
    flex = await startFlexNodes(1, "boardR");
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 502, text: async () => "bad gateway" } as any);
    await flex.emitStatus({ status: "circuit-breaker-open" }); // lost: not marked as reported
    await flex.emitStatus({ status: "circuit-breaker-open" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await flex.emitStatus(connected);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    flex.close();

    // a restarted gateway: board healthy, nothing sent by this process yet for boardS
    flex = await startFlexNodes(1, "boardS");
    fetchSpy.mockClear();
    flex.processRequest.mockResolvedValueOnce({ error: "timeout", timestamp: 1 });
    await flex.input["flex-1"]({ payload: { fc: 3, address: 0, quantity: 1 } });
    await flushAsyncWork();
    expect(fetchSpy).not.toHaveBeenCalled(); // a failed read is not proof of health

    await flex.input["flex-1"]({ payload: { fc: 3, address: 0, quantity: 1 } });
    await flushAsyncWork();
    await flex.input["flex-1"]({ payload: { fc: 3, address: 0, quantity: 1 } });
    await flushAsyncWork();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({ alarm_key: "board_offline:boardS", alarm_status: "Clear", clear_by: "Value" });
  });

  it("a node that switches boards reports the board of its client, and hands the reporter role to the next node", async () => {
    flex = await startMultiBoardNodes(["flex-1", "flex-2"]);
    const alarmKeys = () =>
      fetchSpy.mock.calls.map(([, init]) => JSON.parse(init.body)).filter((b) => b.alarm_status === "Pending").map((b) => b.alarm_key);

    // flex-1 moves to boardB through msg.payload.boardId
    await flex.input["flex-1"]({ payload: { boardId: "boardB", fc: 3, address: 0, quantity: 1 } });

    // boardA goes down: flex-1 is gone from it, so flex-2 must be the one that reports it
    await flex.emitStatus("boardA", breakerOpen);
    expect(alarmKeys()).toEqual(["board_offline:boardA"]);

    // boardB goes down: flex-1 reports it under boardB, not under its configured boardA
    await flex.emitStatus("boardB", breakerOpen);
    expect(alarmKeys()).toEqual(["board_offline:boardA", "board_offline:boardB"]);
  });

  it("only one node per board reports the board", async () => {
    flex = await startFlexNodes(2);

    await flex.emitStatus(breakerOpen);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

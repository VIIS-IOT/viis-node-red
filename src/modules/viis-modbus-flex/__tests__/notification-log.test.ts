/**
 * When a Modbus board trips its circuit breaker, viis-modbus-flex posts an alert to
 * `/api/v2/alarm/notification-by-token?device_access_token=<token>`. The token is the device's MQTT
 * credential: the request needs it in the query, but no log line may contain it.
 */
import { EventEmitter } from "events";
import { inspect } from "util";
import ClientRegistry from "../../../core/client-registry";

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
// The gateway's device1.json/common.json take precedence over the global context; keep the test hermetic.
jest.mock("../../../ultils/device-config-file", () => ({ getDeviceConfigFileValue: jest.fn(() => undefined) }));

const registerFlexNode = require("../viis-modbus-flex") as (RED: any) => void;

const TOKEN = "secret-token";
const BACKEND_URL = "http://backend.test";
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;
const NODE_LOG_METHODS = ["log", "warn", "error", "debug"] as const;

const flushAsyncWork = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Starts a viis-modbus-flex node against a fake Node-RED runtime, with every logging channel spied. */
async function startFlexNode(globals: Record<string, unknown>, boardId = "board1") {
  const modbusClient = new EventEmitter();
  (ClientRegistry.getModbusClientV2 as jest.Mock).mockResolvedValue(modbusClient);

  const nodeEvents = new EventEmitter();
  const loggers: jest.Mock[] = [];
  let NodeType: any;

  const RED = {
    nodes: {
      createNode(node: any, config: any) {
        node.id = config.id;
        node.on = nodeEvents.on.bind(nodeEvents);
        node.status = jest.fn();
        node.send = jest.fn();
        for (const method of NODE_LOG_METHODS) {
          node[method] = jest.fn();
          loggers.push(node[method]);
        }
        node.context = () => ({
          global: { get: (key: string) => globals[key], set: jest.fn() },
          get: jest.fn(),
          set: jest.fn(),
        });
      },
      registerType(_name: string, constructor: unknown) {
        NodeType = constructor;
      },
    },
  };

  registerFlexNode(RED);
  new NodeType({ id: "flex-1", boardId, enableLogging: false });
  await flushAsyncWork();
  expect(modbusClient.listenerCount("modbus-status")).toBe(1);

  return {
    /** Fires a Modbus status event and waits for the alert handler to finish. */
    async emitStatus(event: Record<string, unknown>) {
      modbusClient.emit("modbus-status", event);
      await flushAsyncWork();
    },
    close: () => nodeEvents.emit("close", () => undefined),
    loggers,
  };
}

describe("viis-modbus-flex alert notification logging", () => {
  let fetchSpy: jest.SpyInstance;
  let consoleSpies: jest.SpyInstance[];
  let flex: Awaited<ReturnType<typeof startFlexNode>>;

  /** Everything the node or the console logged, printed the way Node-RED / the console would print it. */
  const loggedText = () =>
    [...consoleSpies, ...flex.loggers]
      .flatMap((spy) => (spy as unknown as jest.Mock).mock.calls)
      .map((args: unknown[]) => args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: null }))).join(" "))
      .join("\n");

  const circuitBreakerOpen = { status: "circuit-breaker-open", error: "timeout", recoveryAt: Date.now() + 60000, failedCount: 5 };

  // One board per test: a raise that reached the backend is remembered per board for the process.
  const startWithToken = async (token: string, boardId = "board1") => {
    flex = await startFlexNode({ device_access_token: token, device_id: "device-1", server_url: BACKEND_URL }, boardId);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, "fetch");
    consoleSpies = CONSOLE_METHODS.map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  });

  afterEach(() => {
    flex?.close();
    jest.restoreAllMocks();
  });

  it("posts the alert with the token in the query but never logs the token", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" });
    await startWithToken(TOKEN);

    await flex.emitStatus(circuitBreakerOpen);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BACKEND_URL}/api/v2/alarm/notification-by-token?device_access_token=${TOKEN}`);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(loggedText()).toContain(`[NOTIFICATION] Sending alert to: ${BACKEND_URL}/api/v2/alarm/notification-by-token?device_access_token=***`);
    expect(loggedText()).toContain("[NOTIFICATION] Alert sent successfully");
    expect(loggedText()).not.toContain(TOKEN);
  });

  it("does not log the token when fetch rejects the URL it was given", async () => {
    // Node's fetch puts the whole request URL, query included, in its "Failed to parse URL" message.
    fetchSpy.mockImplementation(async (url: string) => {
      throw new TypeError(`Failed to parse URL from ${url}`);
    });
    await startWithToken(TOKEN, "board2");

    await flex.emitStatus(circuitBreakerOpen);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain("[NOTIFICATION] Error sending alert: Failed to parse URL from");
    expect(loggedText()).not.toContain(TOKEN);
  });

  it("does not log a token that needs URL encoding, raw or encoded", async () => {
    const trickyToken = "se/cret+token";
    fetchSpy.mockImplementation(async (url: string) => {
      throw new TypeError(`Failed to parse URL from ${url}`);
    });
    await startWithToken(trickyToken, "board3");

    await flex.emitStatus(circuitBreakerOpen);

    expect(fetchSpy.mock.calls[0][0]).toContain(`device_access_token=${encodeURIComponent(trickyToken)}`);
    expect(loggedText()).not.toContain(trickyToken);
    expect(loggedText()).not.toContain(encodeURIComponent(trickyToken));
  });
});

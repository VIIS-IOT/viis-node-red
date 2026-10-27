import { ConnectionState, ModbusClientCore } from "../modbus-client";

/**
 * Regression tests for the reconnect cooldown loop:
 * the wait-timer in scheduleReconnect() used to call transitionTo(RECONNECTING),
 * which reset lastStateChangeAt, so the minimum-interval check never passed and
 * no reconnect attempt was ever made after a real disconnect.
 */
function makeClient(overrides: Record<string, unknown> = {}) {
  // Bypass the constructor (it opens a real connection and starts intervals)
  const c: any = Object.create(ModbusClientCore.prototype);
  Object.assign(c, {
    node: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), status: jest.fn() },
    diagnostic: { emit: jest.fn() },
    config: { type: "TCP", host: "127.0.0.1", tcpPort: 502, reconnectInterval: 30000 },
    client: { isOpen: false },
    isConnected: false,
    isShuttingDown: false,
    reconnectTimer: undefined,
    connectionState: ConnectionState.DISCONNECTED,
    lastStateChangeAt: Date.now(),
    stateHistory: [],
    MIN_RECONNECT_INTERVAL: 15000,
    emit: jest.fn(),
    getTransportId: () => "tcp:127.0.0.1:502",
    ensureCleanConnection: jest.fn().mockResolvedValue(undefined),
    initializeClient: jest.fn().mockImplementation(async () => {
      c.isConnected = true;
      c.client.isOpen = true;
      c.connectionState = ConnectionState.CONNECTED;
    }),
    ...overrides,
  });
  return c;
}

describe("ModbusClientCore.scheduleReconnect", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("actually reconnects after a disconnect that happened within the cooldown", async () => {
    const c = makeClient(); // state just changed (handleError -> DISCONNECTED)
    c.scheduleReconnect();

    // cooldown wait (15s) + quick reconnect delay (15s) + slack
    await jest.advanceTimersByTimeAsync(31000);

    expect(c.initializeClient).toHaveBeenCalledTimes(1);
    expect(c.isConnected).toBe(true);
    expect(c.reconnectTimer).toBeUndefined();
  });

  it("does not loop forever in the cooldown wait", async () => {
    const c = makeClient({ initializeClient: jest.fn().mockResolvedValue(undefined) });
    c.scheduleReconnect();

    await jest.advanceTimersByTimeAsync(120000);

    const waits = c.node.log.mock.calls.filter((args: unknown[]) =>
      String(args[0]).includes("[FSM] Waiting"),
    );
    expect(waits.length).toBe(1);
    expect(c.initializeClient).toHaveBeenCalled();
  });

  it("does not tear down a connection restored during the cooldown wait", async () => {
    const c = makeClient();
    c.scheduleReconnect();

    // ensureConnected() reconnected on an incoming RPC meanwhile
    c.isConnected = true;
    c.client.isOpen = true;

    await jest.advanceTimersByTimeAsync(60000);

    expect(c.ensureCleanConnection).not.toHaveBeenCalled();
    expect(c.initializeClient).not.toHaveBeenCalled();
    expect(c.reconnectTimer).toBeUndefined();
  });

  it("does not tear down a connection restored during the quick-reconnect delay", async () => {
    const c = makeClient({ lastStateChangeAt: Date.now() - 60000 });
    c.scheduleReconnect(); // passes cooldown, schedules 15s quick reconnect
    expect(c.reconnectTimer).toBeDefined();

    c.isConnected = true;
    c.client.isOpen = true;

    await jest.advanceTimersByTimeAsync(20000);

    expect(c.ensureCleanConnection).not.toHaveBeenCalled();
    expect(c.initializeClient).not.toHaveBeenCalled();
    expect(c.getConnectionState()).toBe(ConnectionState.CONNECTED);
    expect(c.reconnectTimer).toBeUndefined();
  });

  it("skips scheduling entirely when already connected", () => {
    const c = makeClient({ isConnected: true, client: { isOpen: true } });
    c.scheduleReconnect();
    expect(c.reconnectTimer).toBeUndefined();
  });
});

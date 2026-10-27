"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_client_1 = require("../modbus-client");
function makeClient() {
    // Bypass the constructor (it opens a real connection and starts intervals)
    const c = Object.create(modbus_client_1.ModbusClientCore.prototype);
    Object.assign(c, {
        node: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), status: jest.fn() },
        diagnostic: { emit: jest.fn() },
        config: { type: "TCP", host: "127.0.0.1", tcpPort: 502, reconnectInterval: 30000, boardType: "STM32" },
        client: { isOpen: false },
        isConnected: false,
        isShuttingDown: false,
        reconnectTimer: undefined,
        connectionState: modbus_client_1.ConnectionState.DISCONNECTED,
        lastStateChangeAt: Date.now(),
        stateHistory: [],
        MIN_RECONNECT_INTERVAL: 15000,
        failedConnectionCount: 0,
        circuitBreakerOpen: false,
        emit: jest.fn(),
        getTransportId: () => "tcp:127.0.0.1:502",
        scheduleReconnect: jest.fn(),
    });
    return c;
}
describe("ModbusClientCore circuit breaker timing", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });
    it.each([
        ["scheduleReconnectWithCircuitBreaker", (c) => { c.failedConnectionCount = 9; c.scheduleReconnectWithCircuitBreaker(); }],
        ["scheduleReconnectWithBackoff", (c) => c.scheduleReconnectWithBackoff(11)],
    ])("%s: log, recoveryAt and the reset timer all use the same duration", async (_name, trigger) => {
        const c = makeClient();
        const now = Date.now();
        trigger(c);
        expect(c.circuitBreakerOpen).toBe(true);
        const logged = c.node.error.mock.calls.map((a) => String(a[0])).join("\n");
        expect(logged).toContain(`waiting ${modbus_client_1.CIRCUIT_BREAKER_RECOVERY_MS / 1000}s`);
        expect(logged).not.toContain("5 minutes");
        const event = c.emit.mock.calls.find((a) => { var _a; return ((_a = a[1]) === null || _a === void 0 ? void 0 : _a.status) === "circuit-breaker-open"; })[1];
        expect(event.recoveryAt - now).toBe(modbus_client_1.CIRCUIT_BREAKER_RECOVERY_MS);
        await jest.advanceTimersByTimeAsync(modbus_client_1.CIRCUIT_BREAKER_RECOVERY_MS - 1);
        expect(c.circuitBreakerOpen).toBe(true);
        await jest.advanceTimersByTimeAsync(1);
        expect(c.circuitBreakerOpen).toBe(false);
    });
});

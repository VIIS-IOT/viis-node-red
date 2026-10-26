"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * When a Modbus board trips its circuit breaker, viis-modbus-flex posts an alert to
 * `/api/v2/alarm/notification-by-token?device_access_token=<token>`. The token is the device's MQTT
 * credential: the request needs it in the query, but no log line may contain it.
 */
const events_1 = require("events");
const util_1 = require("util");
const client_registry_1 = __importDefault(require("../../../core/client-registry"));
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
const registerFlexNode = require("../viis-modbus-flex");
const TOKEN = "secret-token";
const BACKEND_URL = "http://backend.test";
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"];
const NODE_LOG_METHODS = ["log", "warn", "error", "debug"];
const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));
/** Starts a viis-modbus-flex node against a fake Node-RED runtime, with every logging channel spied. */
async function startFlexNode(globals) {
    const modbusClient = new events_1.EventEmitter();
    client_registry_1.default.getModbusClientV2.mockResolvedValue(modbusClient);
    const nodeEvents = new events_1.EventEmitter();
    const loggers = [];
    let NodeType;
    const RED = {
        nodes: {
            createNode(node, config) {
                node.id = config.id;
                node.on = nodeEvents.on.bind(nodeEvents);
                node.status = jest.fn();
                node.send = jest.fn();
                for (const method of NODE_LOG_METHODS) {
                    node[method] = jest.fn();
                    loggers.push(node[method]);
                }
                node.context = () => ({
                    global: { get: (key) => globals[key], set: jest.fn() },
                    get: jest.fn(),
                    set: jest.fn(),
                });
            },
            registerType(_name, constructor) {
                NodeType = constructor;
            },
        },
    };
    registerFlexNode(RED);
    new NodeType({ id: "flex-1", boardId: "board1", enableLogging: false });
    await flushAsyncWork();
    expect(modbusClient.listenerCount("modbus-status")).toBe(1);
    return {
        /** Fires a Modbus status event and waits for the alert handler to finish. */
        async emitStatus(event) {
            modbusClient.emit("modbus-status", event);
            await flushAsyncWork();
        },
        close: () => nodeEvents.emit("close", () => undefined),
        loggers,
    };
}
describe("viis-modbus-flex alert notification logging", () => {
    let fetchSpy;
    let consoleSpies;
    let flex;
    /** Everything the node or the console logged, printed the way Node-RED / the console would print it. */
    const loggedText = () => [...consoleSpies, ...flex.loggers]
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map((arg) => (typeof arg === "string" ? arg : (0, util_1.inspect)(arg, { depth: null }))).join(" "))
        .join("\n");
    const circuitBreakerOpen = { status: "circuit-breaker-open", error: "timeout", recoveryAt: Date.now() + 60000, failedCount: 5 };
    const startWithToken = async (token) => {
        flex = await startFlexNode({ device_access_token: token, device_id: "device-1", server_url: BACKEND_URL });
    };
    beforeEach(() => {
        jest.clearAllMocks();
        fetchSpy = jest.spyOn(global, "fetch");
        consoleSpies = CONSOLE_METHODS.map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    });
    afterEach(() => {
        flex === null || flex === void 0 ? void 0 : flex.close();
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
        fetchSpy.mockImplementation(async (url) => {
            throw new TypeError(`Failed to parse URL from ${url}`);
        });
        await startWithToken(TOKEN);
        await flex.emitStatus(circuitBreakerOpen);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(loggedText()).toContain("[NOTIFICATION] Error sending alert: Failed to parse URL from");
        expect(loggedText()).not.toContain(TOKEN);
    });
    it("does not log a token that needs URL encoding, raw or encoded", async () => {
        const trickyToken = "se/cret+token";
        fetchSpy.mockImplementation(async (url) => {
            throw new TypeError(`Failed to parse URL from ${url}`);
        });
        await startWithToken(trickyToken);
        await flex.emitStatus(circuitBreakerOpen);
        expect(fetchSpy.mock.calls[0][0]).toContain(`device_access_token=${encodeURIComponent(trickyToken)}`);
        expect(loggedText()).not.toContain(trickyToken);
        expect(loggedText()).not.toContain(encodeURIComponent(trickyToken));
    });
});

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * The device access token is the device's MQTT credential. Neither `getDeviceIntentsByToken` nor
 * `sendTelemetryByHttp` may write it to the gateway logs; the requests themselves still need it in the URL.
 */
const axios_1 = __importStar(require("axios"));
const util_1 = require("util");
const device_1 = require("../device");
const TOKEN = "secret-token";
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"];
/** Everything written to the spied console methods, printed the way the console prints it (objects fully inspected). */
function loggedTextOf(spies) {
    return spies
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map((arg) => (typeof arg === "string" ? arg : (0, util_1.inspect)(arg, { depth: null }))).join(" "))
        .join("\n");
}
function spyOnConsole() {
    return CONSOLE_METHODS.map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
}
describe("getDeviceIntentsByToken logging", () => {
    let getSpy;
    let consoleSpies;
    const loggedText = () => loggedTextOf(consoleSpies);
    beforeEach(() => {
        getSpy = jest.spyOn(axios_1.default, "get");
        consoleSpies = spyOnConsole();
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });
    it("requests the intents with the token but never logs it", async () => {
        getSpy.mockResolvedValue({ data: { result: [{ id: "intent-1" }] } });
        const intents = await (0, device_1.getDeviceIntentsByToken)(TOKEN);
        expect(intents).toEqual([{ id: "intent-1" }]);
        expect(getSpy).toHaveBeenCalledTimes(1);
        expect(getSpy.mock.calls[0][0]).toMatch(new RegExp(`/api/v2/device-intent/by-device-token/${TOKEN}$`));
        expect(loggedText()).not.toContain(TOKEN);
    });
    it("does not log the token when the request fails", async () => {
        const url = `http://backend.test/api/v2/device-intent/by-device-token/${TOKEN}`;
        getSpy.mockRejectedValue(new axios_1.AxiosError("Request failed with status code 404", "ERR_BAD_REQUEST", { url }));
        const intents = await (0, device_1.getDeviceIntentsByToken)(TOKEN);
        expect(intents).toBeNull();
        expect(loggedText()).not.toContain(TOKEN);
    });
    it.each([
        [
            "a URL parse error that keeps the request URL in `input`",
            () => Object.assign(new TypeError("Invalid URL"), { code: "ERR_INVALID_URL", input: `not-a-url/api/v2/device-intent/by-device-token/${TOKEN}` }),
            "Invalid URL",
        ],
        [
            "an error whose message quotes the request URL",
            () => new TypeError(`Failed to parse URL from not-a-url/api/v2/device-intent/by-device-token/${TOKEN}`),
            "Failed to parse URL from",
        ],
    ])("does not log the token for a non-Axios error: %s", async (_case, makeError, expectedFragment) => {
        // A malformed VIIS_BACKEND is rejected by the URL parser before axios builds an AxiosError.
        getSpy.mockRejectedValue(makeError());
        const intents = await (0, device_1.getDeviceIntentsByToken)(TOKEN);
        expect(intents).toBeNull();
        expect(loggedText()).toContain("Failed to fetch device intents");
        expect(loggedText()).toContain(expectedFragment);
        expect(loggedText()).not.toContain(TOKEN);
    });
});
describe("sendTelemetryByHttp logging", () => {
    let postSpy;
    let consoleSpies;
    const loggedText = () => loggedTextOf(consoleSpies);
    beforeEach(() => {
        postSpy = jest.spyOn(axios_1.default, "post");
        consoleSpies = spyOnConsole();
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });
    it("posts the telemetry to the token URL and does not log the token on success", async () => {
        postSpy.mockResolvedValue({ data: {} });
        const sent = await (0, device_1.sendTelemetryByHttp)(TOKEN, { temp: 21 });
        expect(sent).toBe(true);
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect(postSpy.mock.calls[0][0]).toMatch(new RegExp(`/api/v1/${TOKEN}/telemetry$`));
        expect(postSpy.mock.calls[0][1]).toEqual({ temp: 21 });
        expect(postSpy.mock.calls[0][2]).toEqual({ headers: { "Content-Type": "application/json" } });
        expect(loggedText()).not.toContain(TOKEN);
    });
    it("does not log the token when the network fails and there is no response", async () => {
        // An AxiosError carries the request config and the request itself, both of which hold the token URL.
        const path = `/api/v1/${TOKEN}/telemetry`;
        postSpy.mockRejectedValue(new axios_1.AxiosError("connect ECONNREFUSED 127.0.0.1:3000", "ECONNREFUSED", { url: `http://backend.test${path}` }, { path }));
        const sent = await (0, device_1.sendTelemetryByHttp)(TOKEN, { temp: 21 });
        expect(sent).toBe(false);
        expect(loggedText()).not.toContain(TOKEN);
        expect(loggedText()).toContain("ECONNREFUSED");
    });
    it("does not log the token when the request URL is rejected before it is sent", async () => {
        // Node's URL parser failure (e.g. a malformed VIIS_BACKEND) keeps the whole URL in `input`.
        const input = `not-a-url/api/v1/${TOKEN}/telemetry`;
        postSpy.mockRejectedValue(Object.assign(new TypeError("Invalid URL"), { code: "ERR_INVALID_URL", input }));
        const sent = await (0, device_1.sendTelemetryByHttp)(TOKEN, { temp: 21 });
        expect(sent).toBe(false);
        expect(loggedText()).not.toContain(TOKEN);
        expect(loggedText()).toContain("Invalid URL");
    });
    it("still logs the backend's answer when it rejects the telemetry", async () => {
        postSpy.mockRejectedValue(new axios_1.AxiosError("Request failed with status code 401", "ERR_BAD_REQUEST", { url: `http://backend.test/api/v1/${TOKEN}/telemetry` }, {}, {
            status: 401,
            data: { message: "Unauthorized device" },
        }));
        const sent = await (0, device_1.sendTelemetryByHttp)(TOKEN, { temp: 21 });
        expect(sent).toBe(false);
        expect(loggedText()).toContain("Unauthorized device");
        expect(loggedText()).not.toContain(TOKEN);
    });
});

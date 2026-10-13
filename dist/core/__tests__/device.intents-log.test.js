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
 * `getDeviceIntentsByToken` must not write the device access token to the gateway logs.
 * The token is the device's MQTT credential; the request itself still needs it in the URL.
 */
const axios_1 = __importStar(require("axios"));
const device_1 = require("../device");
const TOKEN = "secret-token";
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"];
describe("getDeviceIntentsByToken logging", () => {
    let getSpy;
    let consoleSpies;
    const loggedText = () => consoleSpies
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "))
        .join("\n");
    beforeEach(() => {
        getSpy = jest.spyOn(axios_1.default, "get");
        consoleSpies = CONSOLE_METHODS.map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
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
        expect(intents).toEqual([]);
        expect(loggedText()).not.toContain(TOKEN);
    });
});

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
 * `getDeviceIntentsByToken` result contract. The gateway rewrites its local OFFLINE intent table from this
 * answer, so "the server has no intents for this device" and "the fetch failed" must stay distinguishable:
 *   - an array (possibly empty) is the server's authoritative answer;
 *   - `null` means the fetch failed and the caller must keep its cached intents.
 */
const axios_1 = __importStar(require("axios"));
const device_1 = require("../device");
describe("getDeviceIntentsByToken result", () => {
    let getSpy;
    beforeEach(() => {
        getSpy = jest.spyOn(axios_1.default, "get");
        for (const method of ["log", "error", "warn"])
            jest.spyOn(console, method).mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });
    it("returns the intents the server lists", async () => {
        getSpy.mockResolvedValue({ status: 200, data: { result: [{ id: "intent-1", type: "OFFLINE" }] } });
        await expect((0, device_1.getDeviceIntentsByToken)("tok")).resolves.toEqual([{ id: "intent-1", type: "OFFLINE" }]);
    });
    it.each([
        ["the empty envelope the backend sends for a device without intents", {}],
        ["an envelope with result null", { result: null }],
        ["an envelope with an empty list", { result: [] }],
    ])("returns [] for %s", async (_case, body) => {
        getSpy.mockResolvedValue({ status: 200, data: body });
        await expect((0, device_1.getDeviceIntentsByToken)("tok")).resolves.toEqual([]);
    });
    it.each([
        ["an HTTP error", () => new axios_1.AxiosError("Request failed with status code 404", "ERR_BAD_REQUEST")],
        ["an unreachable backend", () => new axios_1.AxiosError("connect ECONNREFUSED 10.0.0.1:59999", "ECONNREFUSED")],
        ["a timeout", () => new axios_1.AxiosError("timeout of 10000ms exceeded", "ECONNABORTED")],
        ["a non-Axios error", () => new TypeError("Invalid URL")],
    ])("returns null when the fetch fails with %s", async (_case, makeError) => {
        getSpy.mockRejectedValue(makeError());
        await expect((0, device_1.getDeviceIntentsByToken)("tok")).resolves.toBeNull();
    });
    it.each([
        ["an HTML page", "<html>proxy login</html>"],
        ["a result that is not a list", { result: { id: "intent-1" } }],
    ])("returns null for a 2xx body that is not the intent list: %s", async (_case, body) => {
        getSpy.mockResolvedValue({ status: 200, data: body });
        await expect((0, device_1.getDeviceIntentsByToken)("tok")).resolves.toBeNull();
    });
});

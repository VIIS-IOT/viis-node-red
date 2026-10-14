/**
 * `getDeviceIntentsByToken` result contract. The gateway rewrites its local OFFLINE intent table from this
 * answer, so "the server has no intents for this device" and "the fetch failed" must stay distinguishable:
 *   - an array (possibly empty) is the server's authoritative answer;
 *   - `null` means the fetch failed and the caller must keep its cached intents.
 */
import axios, { AxiosError } from "axios";
import { getDeviceIntentsByToken } from "../device";

describe("getDeviceIntentsByToken result", () => {
  let getSpy: jest.SpyInstance;

  beforeEach(() => {
    getSpy = jest.spyOn(axios, "get");
    for (const method of ["log", "error", "warn"] as const) jest.spyOn(console, method).mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the intents the server lists", async () => {
    getSpy.mockResolvedValue({ status: 200, data: { result: [{ id: "intent-1", type: "OFFLINE" }] } });

    await expect(getDeviceIntentsByToken("tok")).resolves.toEqual([{ id: "intent-1", type: "OFFLINE" }]);
  });

  it.each([
    ["the empty envelope the backend sends for a device without intents", {}],
    ["an envelope with result null", { result: null }],
    ["an envelope with an empty list", { result: [] }],
  ])("returns [] for %s", async (_case, body) => {
    getSpy.mockResolvedValue({ status: 200, data: body });

    await expect(getDeviceIntentsByToken("tok")).resolves.toEqual([]);
  });

  it.each([
    ["an HTTP error", () => new AxiosError("Request failed with status code 404", "ERR_BAD_REQUEST")],
    ["an unreachable backend", () => new AxiosError("connect ECONNREFUSED 10.0.0.1:59999", "ECONNREFUSED")],
    ["a timeout", () => new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED")],
    ["a non-Axios error", () => new TypeError("Invalid URL")],
  ])("returns null when the fetch fails with %s", async (_case, makeError) => {
    getSpy.mockRejectedValue(makeError());

    await expect(getDeviceIntentsByToken("tok")).resolves.toBeNull();
  });

  it.each([
    ["an HTML page", "<html>proxy login</html>"],
    ["a result that is not a list", { result: { id: "intent-1" } }],
  ])("returns null for a 2xx body that is not the intent list: %s", async (_case, body) => {
    getSpy.mockResolvedValue({ status: 200, data: body });

    await expect(getDeviceIntentsByToken("tok")).resolves.toBeNull();
  });
});

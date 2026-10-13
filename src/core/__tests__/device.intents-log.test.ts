/**
 * `getDeviceIntentsByToken` must not write the device access token to the gateway logs.
 * The token is the device's MQTT credential; the request itself still needs it in the URL.
 */
import axios, { AxiosError } from "axios";
import { getDeviceIntentsByToken } from "../device";

const TOKEN = "secret-token";
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

describe("getDeviceIntentsByToken logging", () => {
  let getSpy: jest.SpyInstance;
  let consoleSpies: jest.SpyInstance[];

  const loggedText = () =>
    consoleSpies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((arg: unknown) => (typeof arg === "string" ? arg : String(arg))).join(" "))
      .join("\n");

  beforeEach(() => {
    getSpy = jest.spyOn(axios, "get");
    consoleSpies = CONSOLE_METHODS.map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("requests the intents with the token but never logs it", async () => {
    getSpy.mockResolvedValue({ data: { result: [{ id: "intent-1" }] } });

    const intents = await getDeviceIntentsByToken(TOKEN);

    expect(intents).toEqual([{ id: "intent-1" }]);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy.mock.calls[0][0]).toMatch(new RegExp(`/api/v2/device-intent/by-device-token/${TOKEN}$`));
    expect(loggedText()).not.toContain(TOKEN);
  });

  it("does not log the token when the request fails", async () => {
    const url = `http://backend.test/api/v2/device-intent/by-device-token/${TOKEN}`;
    getSpy.mockRejectedValue(new AxiosError("Request failed with status code 404", "ERR_BAD_REQUEST", { url } as any));

    const intents = await getDeviceIntentsByToken(TOKEN);

    expect(intents).toEqual([]);
    expect(loggedText()).not.toContain(TOKEN);
  });
});

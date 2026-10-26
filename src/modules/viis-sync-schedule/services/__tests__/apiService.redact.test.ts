/**
 * The schedule-plan pull puts the device access token in the URL path; neither the request log nor the
 * error log may contain it.
 */
import axios from "axios";
import { ApiService } from "../apiService";

jest.mock("axios");
jest.mock("../../../../ultils/device-config-file", () => ({ getDeviceConfigFileValue: jest.fn(() => undefined) }));

const TOKEN = "tok-sync-secret";
const nodeContext = { global: { get: (key: string) => (key === "server_url" ? "http://backend.test" : undefined), set: jest.fn() } } as any;

describe("ApiService token redaction", () => {
    let get: jest.Mock;
    let logged: () => string;

    beforeEach(() => {
        get = jest.fn();
        (axios.create as jest.Mock).mockReturnValue({ defaults: {}, get });
        (axios.isAxiosError as unknown as jest.Mock).mockImplementation((e: any) => !!e?.isAxiosError);
        const spies = (["log", "info", "warn", "error", "debug"] as const).map(m => jest.spyOn(console, m).mockImplementation(() => undefined));
        logged = () => spies.flatMap(s => s.mock.calls).map(args => args.join(" ")).join("\n");
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("logs the request URL and the failed request without the token", async () => {
        jest.useFakeTimers();
        const failure = Object.assign(new Error("Request failed with status code 401"), {
            isAxiosError: true,
            response: { status: 401, data: { message: "unauthorized" } },
            config: { url: `/api/v2/schedulePlan/device/all/${TOKEN}` },
        });
        get.mockRejectedValue(failure);

        const pending = new ApiService(TOKEN, nodeContext).getAllSchedulePlans().catch(e => e);
        await jest.runAllTimersAsync();
        await pending;

        expect(get).toHaveBeenCalledWith(`/api/v2/schedulePlan/device/all/${TOKEN}`);
        expect(logged()).toContain("Making GET request to: http://backend.test/api/v2/schedulePlan/device/all/***");
        expect(logged()).toContain("Request was made to: /api/v2/schedulePlan/device/all/***");
        expect(logged()).not.toContain(TOKEN);
    });
});

jest.mock("axios");
import { getEventOutbox, initEventOutbox, resetEventOutbox } from "../registry";
import { FakeDataSource } from "./fake-datasource";

const quiet = { log() {}, warn() {}, error() {} };
const envWith = (vars: Record<string, any>) => ({ getEnvVar: (n: string, d?: any) => vars[n] ?? d });

afterEach(() => resetEventOutbox());

describe("event outbox registry", () => {
    it("flag off: no outbox, no tables", async () => {
        const ds = new FakeDataSource();
        expect(await initEventOutbox(ds as any, envWith({}), { logger: quiet })).toBeNull();
        expect(await initEventOutbox(ds as any, envWith({ EVENT_OUTBOX_ENABLED: "false" }), { logger: quiet })).toBeNull();
        expect(getEventOutbox()).toBeNull();
        expect(ds.ddl).toEqual([]);
    });

    it("flag on: one outbox per process, null again once the flag is turned off", async () => {
        const vars: Record<string, any> = { EVENT_OUTBOX_ENABLED: true };
        const ds = new FakeDataSource();
        const first = await initEventOutbox(ds as any, envWith(vars), { logger: quiet });
        const second = await initEventOutbox(ds as any, envWith(vars), { logger: quiet });

        expect(first).not.toBeNull();
        expect(second).toBe(first);
        expect(getEventOutbox()).toBe(first);
        expect(ds.ddl.length).toBeGreaterThan(0);

        vars.EVENT_OUTBOX_ENABLED = "false";
        expect(getEventOutbox()).toBeNull();
    });
});

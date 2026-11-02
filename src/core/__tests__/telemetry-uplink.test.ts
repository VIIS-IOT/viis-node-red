import fs from "fs";
import os from "os";
import path from "path";
import { parseTelemetryPayload, TelemetryUplink } from "../telemetry-uplink";

const TOPIC = "v1/device/dev-1/telemetry";

function makeUplink(overrides: { connected?: boolean; spoolDir?: string | null; failPublish?: boolean } = {}) {
    const published: Array<{ topic: string; payload: any }> = [];
    let connected = overrides.connected ?? true;
    let failPublish = overrides.failPublish ?? false;
    let clock = 1_793_000_000_000;
    const uplink = new TelemetryUplink({
        publish: async (topic, payload) => {
            if (failPublish) throw new Error("boom");
            published.push({ topic, payload: JSON.parse(payload) });
        },
        isConnected: () => connected,
        warn: () => undefined,
        log: () => undefined,
        spoolDir: overrides.spoolDir ?? null,
        coalesceMs: 50,
        replayIntervalMs: 60_000,
        now: () => clock,
    });
    return {
        uplink,
        published,
        setConnected: (value: boolean) => (connected = value),
        setFailPublish: (value: boolean) => (failPublish = value),
        advance: (ms: number) => (clock += ms),
        now: () => clock,
    };
}

describe("parseTelemetryPayload", () => {
    it("reads {ts, values}, flat objects and arrays, and rejects non-JSON", () => {
        expect(parseTelemetryPayload('{"ts":5,"values":{"a":1}}', 9)).toEqual([{ ts: 5, values: { a: 1 } }]);
        expect(parseTelemetryPayload('{"logs":{"m":"x"}}', 9)).toEqual([{ ts: 9, values: { logs: { m: "x" } } }]);
        expect(parseTelemetryPayload('[{"ts":1,"values":{"a":1}},{"b":2,"ts":2}]', 9)).toEqual([
            { ts: 1, values: { a: 1 } },
            { ts: 2, values: { b: 2 } },
        ]);
        expect(parseTelemetryPayload("not json", 9)).toBeNull();
    });
});

describe("TelemetryUplink", () => {
    it("merges telemetry published within the window into one {ts, values} message", async () => {
        const { uplink, published, now } = makeUplink();
        await Promise.all([
            uplink.enqueue(TOPIC, JSON.stringify({ ts: now(), values: { valve_5: true } })),
            uplink.enqueue(TOPIC, JSON.stringify({ iri_time: 300 })),
            uplink.enqueue(TOPIC, JSON.stringify({ logs: { from: "DEVICE_EXE_SCHEDULE" } })),
        ]);
        expect(published).toEqual([
            { topic: TOPIC, payload: { ts: now(), values: { valve_5: true, iri_time: 300, logs: { from: "DEVICE_EXE_SCHEDULE" } } } },
        ]);
        uplink.close();
    });

    it("flushes first when a key changes value inside the window, so no state is lost", async () => {
        const { uplink, published } = makeUplink();
        await Promise.all([
            uplink.enqueue(TOPIC, JSON.stringify({ valve_5: true })),
            uplink.enqueue(TOPIC, JSON.stringify({ valve_5: false })),
        ]);
        expect(published.map((p) => p.payload.values)).toEqual([{ valve_5: true }, { valve_5: false }]);
        uplink.close();
    });

    it("leaves non-JSON payloads to the caller", () => {
        const { uplink } = makeUplink();
        expect(uplink.enqueue(TOPIC, "plain")).toBe(false);
        uplink.close();
    });

    it("spools to disk while offline and replays oldest first with the original ts", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uplink-"));
        const { uplink, published, setConnected, advance, now } = makeUplink({ connected: false, spoolDir: dir });
        const first = now();
        await uplink.enqueue(TOPIC, JSON.stringify({ ts: first, values: { current_ec: 1.8 } }));
        advance(60_000);
        await uplink.enqueue(TOPIC, JSON.stringify({ ts: now(), values: { current_ec: 2.1 } }));
        expect(published).toHaveLength(0);
        expect(fs.readdirSync(dir).some((name) => name.endsWith(".jsonl"))).toBe(true);

        setConnected(true);
        await uplink.replayOnce();
        expect(published).toEqual([
            { topic: TOPIC, payload: [{ ts: first, values: { current_ec: 1.8 } }, { ts: first + 60_000, values: { current_ec: 2.1 } }] },
        ]);
        expect(uplink.hasBacklog()).toBe(false);
        uplink.close();
    });

    it("keeps the spool across a restart", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uplink-"));
        const before = makeUplink({ connected: false, spoolDir: dir });
        await before.uplink.enqueue(TOPIC, JSON.stringify({ ts: before.now(), values: { a: 1 } }));
        before.uplink.close();

        const after = makeUplink({ connected: true, spoolDir: dir });
        await after.uplink.replayOnce();
        expect(after.published.map((p) => p.payload)).toEqual([[{ ts: before.now(), values: { a: 1 } }]]);
        after.uplink.close();
    });

    it("spools a live message whose publish fails and keeps it until a replay succeeds", async () => {
        const { uplink, published, setFailPublish, advance } = makeUplink({ failPublish: true });
        await uplink.enqueue(TOPIC, JSON.stringify({ a: 1 }));
        await uplink.replayOnce();
        expect(uplink.hasBacklog()).toBe(true);

        setFailPublish(false);
        advance(10_000);
        await uplink.replayOnce();
        expect(published).toHaveLength(1);
        expect(uplink.hasBacklog()).toBe(false);
        uplink.close();
    });

    it("drops spooled records older than the max age", async () => {
        const { uplink, published, setConnected, advance } = makeUplink({ connected: false });
        await uplink.enqueue(TOPIC, JSON.stringify({ a: 1 }));
        setConnected(true);
        advance(73 * 60 * 60 * 1000);
        await uplink.replayOnce();
        expect(published).toHaveLength(0);
        expect(uplink.hasBacklog()).toBe(false);
        uplink.close();
    });
});

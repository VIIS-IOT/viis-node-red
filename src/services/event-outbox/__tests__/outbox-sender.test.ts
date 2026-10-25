jest.mock("axios");
import axios from "axios";
import { EventOutbox } from "../event-outbox";
import { OutboxSender } from "../outbox-sender";
import { FakeDataSource } from "./fake-datasource";
import { TabiotEventOutbox } from "../../../orm/entities/event-outbox/TabiotEventOutbox";

const post = axios.post as jest.Mock;
const TOKEN = "tok-secret-123";
const BACKEND = "http://backend.local:4008";
const EVENT_URL = `${BACKEND}/api/v2/alarm/notification-by-token`;
const SNAPSHOT_URL = `${BACKEND}/api/v2/alarm/snapshot-by-token`;

function httpError(status: number) {
    return Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status } });
}

function setup(env: Record<string, any> = { VIIS_BACKEND: BACKEND, DEVICE_ACCESS_TOKEN: TOKEN }) {
    const ds = new FakeDataSource();
    const outbox = new EventOutbox(ds as any);
    const logs: string[] = [];
    const logger = { log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
    const sender = new OutboxSender(outbox, { getEnvVar: (n: string, d?: any) => env[n] ?? d }, { logger, random: () => 0.5 });
    const rows = () => ds.getRepository(TabiotEventOutbox).rows;
    const eventPosts = () => post.mock.calls.filter(c => c[0] === EVENT_URL);
    return { ds, outbox, sender, logs, rows, eventPosts };
}

const later = (ms = 60_000) => new Date(Date.now() + ms);

beforeEach(() => post.mockReset());

describe("OutboxSender", () => {
    it("flush delivers in seq order and stamps sent_at", async () => {
        const { outbox, sender, rows, eventPosts } = setup();
        for (const n of [1, 2, 3]) await outbox.enqueue({ msg: `e${n}` });
        post.mockResolvedValue({ status: 200, data: {} });
        const now = later();

        expect(await sender.flush(now)).toEqual({ sent: 3, failed: 0, dead: 0, snapshotSent: false });
        expect(eventPosts().map(c => c[1].msg)).toEqual(["e1", "e2", "e3"]);
        expect(eventPosts()[0][1].event_id).toBe(rows()[0].event_id);
        expect(eventPosts()[0][2].params).toEqual({ device_access_token: TOKEN });
        expect(rows().every(r => r.sent_at?.getTime() === now.getTime())).toBe(true);
        expect((await sender.flush(now)).sent).toBe(0);
    });

    it("5xx → attempts++ and the batch stops", async () => {
        const { outbox, sender, rows, eventPosts } = setup();
        for (const n of [1, 2, 3]) await outbox.enqueue({ msg: `e${n}` });
        post.mockResolvedValueOnce({ status: 200 }).mockRejectedValueOnce(httpError(500));
        const now = later();

        expect(await sender.flush(now)).toEqual({ sent: 1, failed: 1, dead: 0, snapshotSent: false });
        expect(eventPosts()).toHaveLength(2);
        expect(rows()[1]).toMatchObject({ attempts: 1, sent_at: null, dead: false });
        expect(rows()[1].next_attempt_at.getTime()).toBe(now.getTime() + 5_000);
        expect(rows()[1].last_error).toContain("500");
        expect(rows()[2].sent_at).toBeNull();

        // Still backing off: e3 must not overtake e2.
        expect((await sender.flush(new Date(now.getTime() + 1_000))).sent).toBe(0);
        expect(eventPosts()).toHaveLength(2);
    });

    it("backoff doubles per attempt up to maxBackoffMs", async () => {
        const { outbox, rows } = setup();
        const sender = new OutboxSender(outbox, { getEnvVar: (n: string) => ({ VIIS_BACKEND: BACKEND, DEVICE_ACCESS_TOKEN: TOKEN } as any)[n] }, {
            maxBackoffMs: 12_000, random: () => 0.5, logger: { log() {}, warn() {}, error() {} },
        });
        await outbox.enqueue({ msg: "e1" });
        post.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
        let now = later();
        const delays: number[] = [];
        for (let i = 0; i < 3; i++) {
            await sender.flush(now);
            delays.push(rows()[0].next_attempt_at.getTime() - now.getTime());
            now = new Date(rows()[0].next_attempt_at.getTime());
        }
        expect(delays).toEqual([5_000, 10_000, 12_000]);
        expect(rows()[0].attempts).toBe(3);
    });

    it("retries carry ±20 % jitter and the default cap is 60 s", async () => {
        const env = { getEnvVar: (n: string) => ({ VIIS_BACKEND: BACKEND, DEVICE_ACCESS_TOKEN: TOKEN } as any)[n] };
        const quiet = { log() {}, warn() {}, error() {} };
        post.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
        const delays: number[] = [];
        for (const random of [0, 0.999]) {
            const { outbox, rows } = setup();
            await outbox.enqueue({ msg: "e1" });
            const now = later();
            await new OutboxSender(outbox, env, { random: () => random, logger: quiet }).flush(now);
            delays.push(rows()[0].next_attempt_at.getTime() - now.getTime());
        }
        expect(delays[0]).toBe(4_000);
        expect(delays[1]).toBeGreaterThan(5_990);
        expect(delays[1]).toBeLessThanOrEqual(6_000);
        expect((new OutboxSender(setup().outbox, env, { logger: quiet }) as any).maxBackoffMs).toBe(60_000);
    });

    it("a row answered 5xx forever is dead after 20 attempts and the next row is delivered", async () => {
        const { outbox, sender, rows, logs } = setup();
        await outbox.enqueue({ msg: "poison" });
        await outbox.enqueue({ msg: "e2" });
        post.mockImplementation(async (url: string, body: any) => {
            if (url === EVENT_URL && body.msg === "poison") throw httpError(500);
            return { status: 200 };
        });

        let now = later();
        for (let i = 1; i < 20; i++) {
            expect(await sender.flush(now)).toMatchObject({ failed: 1, dead: 0, sent: 0 });
            expect(rows()[0]).toMatchObject({ attempts: i, dead: false });
            now = new Date(rows()[0].next_attempt_at.getTime());
        }
        // the 20th failed attempt kills the row; e2 goes out in the same pass and the snapshot repairs state
        expect(await sender.flush(now)).toEqual({ sent: 1, failed: 0, dead: 1, snapshotSent: true });
        expect(rows()[0]).toMatchObject({ dead: true, attempts: 20, sent_at: null });
        expect(rows()[0].last_error).toContain("500");
        expect(rows()[1].sent_at).not.toBeNull();
        expect(logs.some(l => l.includes("dead after 20 attempt(s)") && l.includes("HTTP 500"))).toBe(true);
    });

    it("a row older than 24 h that fails again is dead, whatever its attempts", async () => {
        const { outbox, sender, rows } = setup();
        await outbox.enqueue({ msg: "old" });
        await outbox.enqueue({ msg: "e2" });
        const now = later();
        rows()[0].created_at = new Date(now.getTime() - 25 * 3_600_000);
        post.mockImplementation(async (url: string, body: any) => {
            if (url === EVENT_URL && body.msg === "old") throw httpError(503);
            return { status: 200 };
        });

        expect(await sender.flush(now)).toMatchObject({ sent: 1, failed: 0, dead: 1 });
        expect(rows()[0]).toMatchObject({ dead: true, attempts: 1 });
    });

    it("4xx other than 401/403/404/408/409/429 marks the row dead and moves on", async () => {
        const { outbox, sender, rows, eventPosts } = setup();
        for (const n of [1, 2, 3]) await outbox.enqueue({ msg: `e${n}` });
        post.mockResolvedValueOnce({ status: 200 }).mockRejectedValueOnce(httpError(400)).mockResolvedValueOnce({ status: 200 });

        expect(await sender.flush(later())).toEqual({ sent: 2, failed: 0, dead: 1, snapshotSent: false });
        expect(eventPosts().map(c => c[1].msg)).toEqual(["e1", "e2", "e3"]);
        expect(rows()[1]).toMatchObject({ dead: true, sent_at: null });
    });

    it.each([408, 409, 429])("%i is retried, not dead", async status => {
        const { outbox, sender, rows } = setup();
        await outbox.enqueue({ msg: "e1" });
        post.mockRejectedValueOnce(httpError(status));

        expect(await sender.flush(later())).toMatchObject({ failed: 1, dead: 0 });
        expect(rows()[0]).toMatchObject({ dead: false, attempts: 1 });
    });

    it.each([401, 403, 404])("%i pauses the queue with backoff (never dead) and the rows go through once the backend accepts again", async status => {
        const { outbox, sender, rows, eventPosts } = setup();
        await outbox.raise("board_offline:board1", { severity: "error", msg: "down" });
        for (const n of [2, 3]) await outbox.enqueue({ msg: `e${n}` });
        post.mockRejectedValue(httpError(status));

        // token rejected for a while: no row is dropped, the head backs off, later rows do not overtake it
        let now = later();
        for (let i = 1; i <= 3; i++) {
            expect(await sender.flush(now)).toEqual({ sent: 0, failed: 1, dead: 0, snapshotSent: false });
            expect(rows().map(r => r.dead)).toEqual([false, false, false]);
            expect(rows()[0].attempts).toBe(i);
            now = new Date(rows()[0].next_attempt_at.getTime());
        }
        expect(eventPosts()).toHaveLength(3);
        expect(rows()[0].next_attempt_at.getTime() - Date.now()).toBeGreaterThan(0);

        // token restored: everything is delivered in order, and `failing` made the snapshot run
        post.mockReset();
        post.mockResolvedValue({ status: 200 });
        expect(await sender.flush(now)).toEqual({ sent: 3, failed: 0, dead: 0, snapshotSent: true });
        expect(eventPosts().map(c => c[1].msg).slice(1)).toEqual(["e2", "e3"]);
    });

    it("401 backs off to the 60 s cap", async () => {
        const { outbox, sender, rows } = setup();
        await outbox.enqueue({ msg: "e1" });
        post.mockRejectedValue(httpError(401));
        let now = later();
        let last = 0;
        for (let i = 0; i < 8; i++) {
            await sender.flush(now);
            last = rows()[0].next_attempt_at.getTime() - now.getTime();
            now = new Date(rows()[0].next_attempt_at.getTime());
        }
        expect(last).toBe(60_000);
    });

    it("first success after failure posts one snapshot", async () => {
        const { outbox, sender } = setup();
        await outbox.raise("board_offline:board1", { severity: "error", msg: "down" });
        post.mockRejectedValueOnce(httpError(503));
        const now = later();
        await sender.flush(now);

        post.mockResolvedValue({ status: 200 });
        const recovered = await sender.flush(new Date(now.getTime() + 5_000));
        expect(recovered).toEqual({ sent: 1, failed: 0, dead: 0, snapshotSent: true });
        const snapshots = post.mock.calls.filter(c => c[0] === SNAPSHOT_URL);
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0][1]).toEqual({ active: [{ alarm_key: "board_offline:board1", severity: "error" }] });
        expect(snapshots[0][2].params).toEqual({ device_access_token: TOKEN });

        await outbox.enqueue({ msg: "next" });
        expect((await sender.flush(new Date(now.getTime() + 6_000))).snapshotSent).toBe(false);
        expect(post.mock.calls.filter(c => c[0] === SNAPSHOT_URL)).toHaveLength(1);
    });

    it("a row that already failed before a restart triggers the snapshot when it goes through", async () => {
        const { outbox, sender } = setup();
        await outbox.raise("board_offline:board1", { severity: "error", msg: "down" });
        post.mockRejectedValueOnce(httpError(503));
        const now = later();
        await sender.flush(now);

        const restarted = new OutboxSender(outbox, { getEnvVar: (n: string) => ({ VIIS_BACKEND: BACKEND, DEVICE_ACCESS_TOKEN: TOKEN } as any)[n] }, {
            logger: { log() {}, warn() {}, error() {} },
        });
        post.mockResolvedValue({ status: 200 });
        expect((await restarted.flush(new Date(now.getTime() + 5_000))).snapshotSent).toBe(true);
    });

    it("the snapshot waits until no state-alarm row is left unsent, so a queued Clear is not overtaken", async () => {
        const { outbox, ds, rows } = setup();
        const quiet = { log() {}, warn() {}, error() {} };
        const env = { getEnvVar: (n: string) => ({ VIIS_BACKEND: BACKEND, DEVICE_ACCESS_TOKEN: TOKEN } as any)[n] };
        const sender = new OutboxSender(outbox, env, { batch: 1, random: () => 0.5, logger: quiet });
        await outbox.raise("board_offline:board1", { severity: "error", msg: "down" });
        await outbox.clear("board_offline:board1", { severity: "error", msg: "up" });
        post.mockRejectedValueOnce(httpError(503));
        const now = later();
        await sender.flush(now);
        expect(rows().map(r => r.sent_at)).toEqual([null, null]);

        post.mockResolvedValue({ status: 200 });
        const retry = new Date(rows()[0].next_attempt_at.getTime());
        // Pending goes out, the Clear is still queued: no snapshot yet
        expect(await sender.flush(retry)).toMatchObject({ sent: 1, snapshotSent: false });
        expect(post.mock.calls.filter(c => c[0] === SNAPSHOT_URL)).toHaveLength(0);
        // Clear goes out, the queue is drained: the snapshot lists nothing active
        expect(await sender.flush(retry)).toMatchObject({ sent: 1, snapshotSent: true });
        expect(post.mock.calls.filter(c => c[0] === SNAPSHOT_URL).map(c => c[1])).toEqual([{ active: [] }]);
        expect(await outbox.isSnapshotPending()).toBe(false);
        expect(ds.dump()).not.toContain("__outbox_meta");
    });

    it("a snapshot owed survives a restart (persisted in MySQL, not memory) and is never listed as an alarm", async () => {
        const { outbox } = setup();
        await outbox.raise("board_offline:board1", { severity: "error", msg: "down" });
        await outbox.setSnapshotPending(true);
        expect(await outbox.activeAlarms()).toEqual([{ alarm_key: "board_offline:board1", severity: "error" }]);
        post.mockResolvedValue({ status: 200 });

        const restarted = new OutboxSender(outbox, { getEnvVar: (n: string) => ({ VIIS_BACKEND: BACKEND, DEVICE_ACCESS_TOKEN: TOKEN } as any)[n] }, {
            logger: { log() {}, warn() {}, error() {} },
        });
        expect(await restarted.flush(later())).toMatchObject({ sent: 1, snapshotSent: true });
        expect(post.mock.calls.filter(c => c[0] === SNAPSHOT_URL)[0][1]).toEqual({ active: [{ alarm_key: "board_offline:board1", severity: "error" }] });
    });

    it("more than 500 active alarms: no snapshot is sent (a partial list would clear live alarms) and the flag is dropped", async () => {
        const { outbox, sender, logs } = setup();
        for (let i = 0; i < 501; i++) await outbox.raise(`schedule_off_failed:s${i}`, { severity: "error" });
        await outbox.setSnapshotPending(true);
        post.mockResolvedValue({ status: 200 });
        // 501 Pending rows are queued first: drain them over several flushes
        for (let i = 0; i < 30; i++) await sender.flush(later());
        expect(post.mock.calls.filter(c => c[0] === SNAPSHOT_URL)).toHaveLength(0);
        expect(logs.some(l => l.includes("snapshot skipped: 501 active alarms"))).toBe(true);
        expect(await outbox.isSnapshotPending()).toBe(false);
    });

    it("a failed snapshot is retried on the next flush", async () => {
        const { outbox, sender } = setup();
        await outbox.enqueue({ msg: "e1" });
        post.mockRejectedValueOnce(httpError(503));
        const now = later();
        await sender.flush(now);

        post.mockImplementation(async (url: string) => {
            if (url === SNAPSHOT_URL) throw httpError(502);
            return { status: 200 };
        });
        expect((await sender.flush(new Date(now.getTime() + 5_000))).snapshotSent).toBe(false);

        post.mockResolvedValue({ status: 200 });
        expect((await sender.flush(new Date(now.getTime() + 6_000))).snapshotSent).toBe(true);
    });

    it("skips sending while VIIS_BACKEND or the token is missing", async () => {
        const { outbox, sender, rows } = setup({ VIIS_BACKEND: BACKEND });
        await outbox.enqueue({ msg: "e1" });

        expect(await sender.flush(later())).toEqual({ sent: 0, failed: 0, dead: 0, snapshotSent: false });
        expect(post).not.toHaveBeenCalled();
        expect(rows()[0].attempts).toBe(0);
    });

    it("deletes sent rows older than 7 days and dead rows older than 30 days", async () => {
        const { outbox, sender, rows } = setup();
        for (const n of [1, 2, 3, 4]) await outbox.enqueue({ msg: `e${n}` });
        const now = later();
        rows()[0].sent_at = new Date(now.getTime() - 8 * 86_400_000);
        rows()[1].sent_at = new Date(now.getTime() - 1 * 86_400_000);
        rows()[2].dead = true;
        rows()[2].created_at = new Date(now.getTime() - 29 * 86_400_000);
        rows()[3].dead = true;
        rows()[3].created_at = new Date(now.getTime() - 31 * 86_400_000);

        await sender.flush(now);
        expect(rows().map(r => r.payload.msg)).toEqual(["e2", "e3"]);
    });

    it("log lines never contain the token", async () => {
        const { outbox, sender, logs, rows } = setup();
        for (const n of [1, 2]) await outbox.enqueue({ msg: `e${n}` });
        post.mockResolvedValueOnce({ status: 200 })
            .mockRejectedValueOnce(new Error(`connect failed for ${EVENT_URL}?device_access_token=${TOKEN}`));
        const now = later();
        await sender.flush(now);
        post.mockResolvedValue({ status: 200 });
        await sender.flush(new Date(now.getTime() + 5_000));

        expect(logs.length).toBeGreaterThan(0);
        expect(logs.join("\n")).not.toContain(TOKEN);
        expect(JSON.stringify(rows())).not.toContain(TOKEN);
    });
});

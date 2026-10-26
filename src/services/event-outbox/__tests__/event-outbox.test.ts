import { EventOutbox, EVENT_OUTBOX_DDL } from "../event-outbox";
import { FakeDataSource } from "./fake-datasource";
import { TabiotEventOutbox } from "../../../orm/entities/event-outbox/TabiotEventOutbox";

function setup() {
    const ds = new FakeDataSource();
    const outbox = new EventOutbox(ds as any);
    return { ds, outbox, rows: () => ds.getRepository(TabiotEventOutbox).rows };
}

describe("EventOutbox", () => {
    it("ensureTables runs the DDL idempotently", async () => {
        const { ds, outbox } = setup();
        await outbox.ensureTables();
        await outbox.ensureTables();
        expect(ds.ddl).toEqual(EVENT_OUTBOX_DDL);
        expect(EVENT_OUTBOX_DDL.every(sql => sql.startsWith("CREATE TABLE IF NOT EXISTS"))).toBe(true);
    });

    it("enqueue assigns event_id and stores no token", async () => {
        const { ds, outbox, rows } = setup();
        const id = await outbox.enqueue({ alarm_name: "s1", msg: "done", device_access_token: "tok-secret" });

        expect(id).toMatch(/^[A-Za-z0-9:_-]{1,64}$/);
        expect(rows()).toHaveLength(1);
        expect(rows()[0].event_id).toBe(id);
        expect(rows()[0].payload).toMatchObject({ alarm_name: "s1", msg: "done", event_id: id });
        expect(rows()[0].sent_at).toBeNull();
        expect(ds.dump()).not.toContain("tok-secret");
    });

    it("enqueue keeps a caller event_id", async () => {
        const { outbox } = setup();
        expect(await outbox.enqueue({ event_id: "run-1:end", msg: "x" })).toBe("run-1:end");
    });

    it("raise twice → one row", async () => {
        const { outbox, rows } = setup();
        expect(await outbox.raise("board_offline:board1", { severity: "error", msg: "down" })).toBe(true);
        expect(await outbox.raise("board_offline:board1", { severity: "error", msg: "down" })).toBe(false);

        expect(rows()).toHaveLength(1);
        expect(rows()[0].payload).toMatchObject({ alarm_key: "board_offline:board1", alarm_status: "Pending" });
        expect(await outbox.activeAlarms()).toEqual([{ alarm_key: "board_offline:board1", severity: "error" }]);
    });

    it("clear without Pending → no row", async () => {
        const { outbox, rows } = setup();
        expect(await outbox.clear("board_offline:board1", { msg: "up" })).toBe(false);
        expect(rows()).toHaveLength(0);
    });

    it("clear after raise enqueues Clear by Value and leaves no active alarm", async () => {
        const { outbox, rows } = setup();
        await outbox.raise("board_offline:board1", { severity: "error", msg: "down" });
        expect(await outbox.clear("board_offline:board1", { severity: "error", msg: "up" })).toBe(true);
        expect(await outbox.clear("board_offline:board1", { msg: "up" })).toBe(false);

        expect(rows().map(r => r.payload.alarm_status)).toEqual(["Pending", "Clear"]);
        expect(rows()[1].payload).toMatchObject({ alarm_key: "board_offline:board1", clear_by: "Value" });
        expect(await outbox.activeAlarms()).toEqual([]);
    });

    it("concurrent raises of one key enqueue once", async () => {
        const { outbox, rows } = setup();
        const results = await Promise.all([
            outbox.raise("board_offline:board1", { msg: "a" }),
            outbox.raise("board_offline:board1", { msg: "b" }),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(rows()).toHaveLength(1);
    });

    it("nextBatch returns unsent, not dead, due rows in seq order", async () => {
        const { outbox, rows } = setup();
        const now = new Date(Date.now() + 60_000);
        for (const n of [1, 2, 3, 4, 5]) await outbox.enqueue({ msg: `e${n}` });
        const [r1, r2] = rows();
        r1.sent_at = now;
        r2.dead = true;

        expect((await outbox.nextBatch(10, now)).map(r => r.payload.msg)).toEqual(["e3", "e4", "e5"]);
        expect((await outbox.nextBatch(1, now)).map(r => r.payload.msg)).toEqual(["e3"]);
    });

    it("nextBatch stops at the first row still backing off, so a later row never overtakes it", async () => {
        const { outbox, rows } = setup();
        const now = new Date(Date.now() + 60_000);
        for (const n of [1, 2, 3]) await outbox.enqueue({ msg: `e${n}` });
        rows()[1].next_attempt_at = new Date(now.getTime() + 5_000);

        expect((await outbox.nextBatch(10, now)).map(r => r.payload.msg)).toEqual(["e1"]);
        rows()[0].sent_at = now;
        expect(await outbox.nextBatch(10, now)).toEqual([]);
    });
});

/**
 * Durable gateway event outbox (flag `EVENT_OUTBOX_ENABLED`). Senders store an event here instead of
 * POSTing it; `OutboxSender` delivers the rows in `seq` order and keeps retrying across backend outages.
 * Each event carries an `event_id` that the backend inbox (`iot_device_event_inbox`) uses to drop a
 * retried duplicate, so a row may be sent more than once but is handled once.
 *
 * State alarms (`raise`/`clear`) also keep their last sent state in `tabiot_gateway_alarm_state`: a
 * condition seen on every poll sends one Pending and one Clear, and the Pending rows are the snapshot the
 * sender posts after an outage so the backend can clear what the gateway no longer has.
 *
 * Gateway MySQL runs with `synchronize: false` and no runtime migrations: the tables are created on first
 * use by `EVENT_OUTBOX_DDL`, which must match the two entities column for column.
 */
import { DataSource, IsNull, LessThan } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { TabiotEventOutbox } from "../../orm/entities/event-outbox/TabiotEventOutbox";
import { TabiotGatewayAlarmState } from "../../orm/entities/event-outbox/TabiotGatewayAlarmState";

export const EVENT_OUTBOX_DDL: string[] = [
    `CREATE TABLE IF NOT EXISTS \`tabiot_event_outbox\` (
  \`seq\` BIGINT NOT NULL AUTO_INCREMENT,
  \`event_id\` VARCHAR(64) NOT NULL,
  \`payload\` JSON NOT NULL,
  \`created_at\` DATETIME(3) NOT NULL,
  \`next_attempt_at\` DATETIME(3) NOT NULL,
  \`sent_at\` DATETIME(3) NULL,
  \`dead\` TINYINT(1) NOT NULL DEFAULT 0,
  \`attempts\` INT NOT NULL DEFAULT 0,
  \`last_error\` VARCHAR(255) NULL,
  PRIMARY KEY (\`seq\`),
  UNIQUE KEY \`uq_event_outbox_event_id\` (\`event_id\`),
  KEY \`idx_event_outbox_pending\` (\`sent_at\`, \`dead\`, \`next_attempt_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS \`tabiot_gateway_alarm_state\` (
  \`alarm_key\` VARCHAR(140) NOT NULL,
  \`status\` VARCHAR(16) NOT NULL,
  \`severity\` VARCHAR(16) NOT NULL,
  \`payload\` JSON NULL,
  \`updated_at\` DATETIME(3) NOT NULL,
  PRIMARY KEY (\`alarm_key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

/** Same rules as the backend `AlarmValidator` (`isValidDeviceEventId`, `isValidGatewayAlarmKey`). */
const EVENT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;
const ALARM_KEY_PATTERN = /^[^\s\x00-\x1f\x7f]{1,140}$/;

/** Payload keys that must never be persisted (the token is read from env at send time). */
const SECRET_KEYS = ["device_access_token"];

export class EventOutbox {
    /** Serialises raise/clear so two callers in this process cannot both see "not Pending" and enqueue twice. */
    private stateChain: Promise<unknown> = Promise.resolve();
    private tablesReady: Promise<void> | null = null;

    constructor(private readonly ds: DataSource) {}

    /** Runs the DDL once per instance; a failed attempt is retried on the next call. */
    ensureTables(): Promise<void> {
        if (!this.tablesReady) {
            this.tablesReady = (async () => {
                for (const sql of EVENT_OUTBOX_DDL) {
                    await this.ds.query(sql);
                }
            })().catch(error => {
                this.tablesReady = null;
                throw error;
            });
        }
        return this.tablesReady;
    }

    /** Stores one event for delivery; sets `event_id` (uuid) when the caller gave none. Returns the event_id. */
    async enqueue(payload: Record<string, unknown>): Promise<string> {
        return this.insertEvent(this.ds, payload, new Date());
    }

    /** Enqueues `Pending` for `alarmKey` unless it is already Pending. false = already Pending, nothing stored. */
    async raise(alarmKey: string, payload: Record<string, unknown>): Promise<boolean> {
        return this.transition(alarmKey, "Pending", payload);
    }

    /** Enqueues `Clear` (`clear_by: 'Value'`) for `alarmKey` when it is Pending. false = not Pending, nothing stored. */
    async clear(alarmKey: string, payload: Record<string, unknown>): Promise<boolean> {
        return this.transition(alarmKey, "Clear", payload);
    }

    async activeAlarms(): Promise<{ alarm_key: string; severity: string }[]> {
        const rows = await this.ds.getRepository(TabiotGatewayAlarmState).find({ where: { status: "Pending" } });
        return rows.map(r => ({ alarm_key: r.alarm_key, severity: r.severity }));
    }

    /**
     * The next rows to send, in `seq` order: unsent, not dead and due. Stops at the first unsent row that is
     * still backing off, so a later event never overtakes an earlier one.
     */
    async nextBatch(limit: number, now: Date): Promise<TabiotEventOutbox[]> {
        const pending = await this.ds.getRepository(TabiotEventOutbox).find({
            where: { sent_at: IsNull(), dead: false },
            order: { seq: "ASC" },
            take: limit,
        });
        const due: TabiotEventOutbox[] = [];
        for (const row of pending) {
            if (new Date(row.next_attempt_at).getTime() > now.getTime()) break;
            due.push(row);
        }
        return due;
    }

    async markSent(seq: string, at: Date): Promise<void> {
        await this.ds.getRepository(TabiotEventOutbox).update({ seq }, { sent_at: at });
    }

    async markRetry(seq: string, attempts: number, nextAttemptAt: Date, error: string): Promise<void> {
        await this.ds.getRepository(TabiotEventOutbox).update(
            { seq },
            { attempts, next_attempt_at: nextAttemptAt, last_error: error.slice(0, 255) }
        );
    }

    async markDead(seq: string, attempts: number, error: string): Promise<void> {
        await this.ds.getRepository(TabiotEventOutbox).update({ seq }, { attempts, dead: true, last_error: error.slice(0, 255) });
    }

    /** Deletes rows sent before `before`. Dead rows stay for diagnosis. */
    async purgeSent(before: Date): Promise<number> {
        const result = await this.ds.getRepository(TabiotEventOutbox).delete({ sent_at: LessThan(before) });
        return result.affected ?? 0;
    }

    private transition(alarmKey: string, status: "Pending" | "Clear", payload: Record<string, unknown>): Promise<boolean> {
        if (!ALARM_KEY_PATTERN.test(alarmKey ?? "")) {
            return Promise.reject(new Error(`invalid alarm_key: ${String(alarmKey).slice(0, 160)}`));
        }
        const run = this.stateChain.then(() =>
            this.ds.transaction(async manager => {
                const states = manager.getRepository(TabiotGatewayAlarmState);
                const current = await states.findOne({ where: { alarm_key: alarmKey } });
                const isPending = current?.status === "Pending";
                if (status === "Pending" ? isPending : !isPending) return false;

                const now = new Date();
                const severity = String(payload.severity ?? current?.severity ?? "error").slice(0, 16);
                const event: Record<string, unknown> = { ...payload, alarm_key: alarmKey, alarm_status: status };
                if (status === "Clear") event.clear_by = "Value";
                await states.save({ alarm_key: alarmKey, status, severity, payload: stripSecrets(payload), updated_at: now });
                await this.insertEvent(manager, event, now);
                return true;
            })
        );
        this.stateChain = run.catch(() => undefined);
        return run;
    }

    private async insertEvent(
        db: Pick<DataSource, "getRepository">,
        payload: Record<string, unknown>,
        now: Date
    ): Promise<string> {
        const eventId = payload.event_id === undefined || payload.event_id === null || payload.event_id === ""
            ? uuidv4()
            : String(payload.event_id);
        if (!EVENT_ID_PATTERN.test(eventId)) throw new Error(`invalid event_id: ${eventId.slice(0, 80)}`);

        const stored: Record<string, unknown> = { ...stripSecrets(payload), event_id: eventId };
        if (!stored.occurred_at) stored.occurred_at = now.toISOString();
        await db.getRepository(TabiotEventOutbox).insert({
            event_id: eventId,
            payload: stored,
            created_at: now,
            next_attempt_at: now,
            sent_at: null,
            dead: false,
            attempts: 0,
            last_error: null,
        });
        return eventId;
    }
}

function stripSecrets(payload: Record<string, unknown>): Record<string, unknown> {
    const copy = { ...payload };
    for (const key of SECRET_KEYS) delete copy[key];
    return copy;
}

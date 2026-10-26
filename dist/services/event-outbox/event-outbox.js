"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventOutbox = exports.SNAPSHOT_PENDING_KEY = exports.EVENT_OUTBOX_DDL = void 0;
/**
 * Durable gateway event outbox (flag `EVENT_OUTBOX_ENABLED`). Senders store an event here instead of
 * POSTing it; `OutboxSender` delivers the rows in `seq` order and keeps retrying across backend outages.
 * Each event carries an `event_id` that the backend inbox (`iot_device_event_inbox`) uses to drop a
 * retried duplicate, so a row may be sent more than once but is handled once.
 *
 * State alarms (`raise`/`clear`) also keep their last sent state in `tabiot_gateway_alarm_state`: a
 * condition seen on every poll sends one Pending and one Clear, and the Pending rows are the snapshot the
 * sender posts after an outage so the backend can clear what the gateway no longer has. One more row in
 * that table (`SNAPSHOT_PENDING_KEY`, status `Meta`) remembers across restarts that a snapshot is owed.
 *
 * Gateway MySQL runs with `synchronize: false` and no runtime migrations: the tables are created on first
 * use by `EVENT_OUTBOX_DDL`, which must match the two entities column for column.
 */
const typeorm_1 = require("typeorm");
const uuid_1 = require("uuid");
const TabiotEventOutbox_1 = require("../../orm/entities/event-outbox/TabiotEventOutbox");
const TabiotGatewayAlarmState_1 = require("../../orm/entities/event-outbox/TabiotGatewayAlarmState");
exports.EVENT_OUTBOX_DDL = [
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
/** Meta row of `tabiot_gateway_alarm_state`: present = a snapshot is owed. Never reported as an active alarm. */
exports.SNAPSHOT_PENDING_KEY = "__outbox_meta:snapshot_pending";
/** Payload keys that must never be persisted (the token is read from env at send time). */
const SECRET_KEYS = ["device_access_token"];
class EventOutbox {
    constructor(ds) {
        this.ds = ds;
        /** Serialises raise/clear so two callers in this process cannot both see "not Pending" and enqueue twice. */
        this.stateChain = Promise.resolve();
        this.tablesReady = null;
    }
    /** Runs the DDL once per instance; a failed attempt is retried on the next call. */
    ensureTables() {
        if (!this.tablesReady) {
            this.tablesReady = (async () => {
                for (const sql of exports.EVENT_OUTBOX_DDL) {
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
    async enqueue(payload) {
        return this.insertEvent(this.ds, payload, new Date());
    }
    /** Enqueues `Pending` for `alarmKey` unless it is already Pending. false = already Pending, nothing stored. */
    async raise(alarmKey, payload) {
        return this.transition(alarmKey, "Pending", payload);
    }
    /** Enqueues `Clear` (`clear_by: 'Value'`) for `alarmKey` when it is Pending. false = not Pending, nothing stored. */
    async clear(alarmKey, payload) {
        return this.transition(alarmKey, "Clear", payload);
    }
    async activeAlarms() {
        const rows = await this.ds.getRepository(TabiotGatewayAlarmState_1.TabiotGatewayAlarmState).find({ where: { status: "Pending" } });
        return rows.map(r => ({ alarm_key: r.alarm_key, severity: r.severity }));
    }
    /** A snapshot is owed to the backend (delivery recovered, or a row was dropped, and it has not been sent). */
    async isSnapshotPending() {
        const row = await this.ds.getRepository(TabiotGatewayAlarmState_1.TabiotGatewayAlarmState).findOne({ where: { alarm_key: exports.SNAPSHOT_PENDING_KEY } });
        return !!row;
    }
    async setSnapshotPending(pending) {
        const states = this.ds.getRepository(TabiotGatewayAlarmState_1.TabiotGatewayAlarmState);
        if (pending) {
            await states.save({ alarm_key: exports.SNAPSHOT_PENDING_KEY, status: "Meta", severity: "info", payload: null, updated_at: new Date() });
        }
        else {
            await states.delete({ alarm_key: exports.SNAPSHOT_PENDING_KEY });
        }
    }
    /**
     * True while a raise/clear of a state alarm is still waiting to be delivered (unsent, not dead). The
     * snapshot must follow those rows, not overtake them, or a queued Clear arrives after the backend
     * already cleared the alarm with `Resync`.
     */
    async hasUnsentStateAlarms() {
        const unsent = await this.ds.getRepository(TabiotEventOutbox_1.TabiotEventOutbox).find({ where: { sent_at: (0, typeorm_1.IsNull)(), dead: false } });
        return unsent.some(row => {
            var _a;
            const p = ((_a = row.payload) !== null && _a !== void 0 ? _a : {});
            return typeof p.alarm_key === "string" && (p.alarm_status === "Pending" || p.alarm_status === "Clear");
        });
    }
    /**
     * The next rows to send, in `seq` order: unsent, not dead and due. Stops at the first unsent row that is
     * still backing off, so a later event never overtakes an earlier one.
     */
    async nextBatch(limit, now) {
        const pending = await this.ds.getRepository(TabiotEventOutbox_1.TabiotEventOutbox).find({
            where: { sent_at: (0, typeorm_1.IsNull)(), dead: false },
            order: { seq: "ASC" },
            take: limit,
        });
        const due = [];
        for (const row of pending) {
            if (new Date(row.next_attempt_at).getTime() > now.getTime())
                break;
            due.push(row);
        }
        return due;
    }
    async markSent(seq, at) {
        await this.ds.getRepository(TabiotEventOutbox_1.TabiotEventOutbox).update({ seq }, { sent_at: at });
    }
    async markRetry(seq, attempts, nextAttemptAt, error) {
        await this.ds.getRepository(TabiotEventOutbox_1.TabiotEventOutbox).update({ seq }, { attempts, next_attempt_at: nextAttemptAt, last_error: error.slice(0, 255) });
    }
    async markDead(seq, attempts, error) {
        await this.ds.getRepository(TabiotEventOutbox_1.TabiotEventOutbox).update({ seq }, { attempts, dead: true, last_error: error.slice(0, 255) });
    }
    /** Deletes dead rows created before `before` (they stay a while for diagnosis). */
    async purgeDead(before) {
        var _a;
        const result = await this.ds.getRepository(TabiotEventOutbox_1.TabiotEventOutbox).delete({ dead: true, created_at: (0, typeorm_1.LessThan)(before) });
        return (_a = result.affected) !== null && _a !== void 0 ? _a : 0;
    }
    /** Deletes rows sent before `before`. */
    async purgeSent(before) {
        var _a;
        const result = await this.ds.getRepository(TabiotEventOutbox_1.TabiotEventOutbox).delete({ sent_at: (0, typeorm_1.LessThan)(before) });
        return (_a = result.affected) !== null && _a !== void 0 ? _a : 0;
    }
    transition(alarmKey, status, payload) {
        if (!ALARM_KEY_PATTERN.test(alarmKey !== null && alarmKey !== void 0 ? alarmKey : "")) {
            return Promise.reject(new Error(`invalid alarm_key: ${String(alarmKey).slice(0, 160)}`));
        }
        const run = this.stateChain.then(() => this.ds.transaction(async (manager) => {
            var _a, _b;
            const states = manager.getRepository(TabiotGatewayAlarmState_1.TabiotGatewayAlarmState);
            const current = await states.findOne({ where: { alarm_key: alarmKey } });
            const isPending = (current === null || current === void 0 ? void 0 : current.status) === "Pending";
            if (status === "Pending" ? isPending : !isPending)
                return false;
            const now = new Date();
            const severity = String((_b = (_a = payload.severity) !== null && _a !== void 0 ? _a : current === null || current === void 0 ? void 0 : current.severity) !== null && _b !== void 0 ? _b : "error").slice(0, 16);
            const event = Object.assign(Object.assign({}, payload), { alarm_key: alarmKey, alarm_status: status });
            if (status === "Clear")
                event.clear_by = "Value";
            await states.save({ alarm_key: alarmKey, status, severity, payload: stripSecrets(payload), updated_at: now });
            await this.insertEvent(manager, event, now);
            return true;
        }));
        this.stateChain = run.catch(() => undefined);
        return run;
    }
    async insertEvent(db, payload, now) {
        const eventId = payload.event_id === undefined || payload.event_id === null || payload.event_id === ""
            ? (0, uuid_1.v4)()
            : String(payload.event_id);
        if (!EVENT_ID_PATTERN.test(eventId))
            throw new Error(`invalid event_id: ${eventId.slice(0, 80)}`);
        const stored = Object.assign(Object.assign({}, stripSecrets(payload)), { event_id: eventId });
        if (!stored.occurred_at)
            stored.occurred_at = now.toISOString();
        await db.getRepository(TabiotEventOutbox_1.TabiotEventOutbox).insert({
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
exports.EventOutbox = EventOutbox;
function stripSecrets(payload) {
    const copy = Object.assign({}, payload);
    for (const key of SECRET_KEYS)
        delete copy[key];
    return copy;
}

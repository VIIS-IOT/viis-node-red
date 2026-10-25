"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxSender = exports.MAX_ROW_AGE_MS = exports.MAX_ATTEMPTS = exports.SNAPSHOT_MAX_ALARMS = void 0;
exports.redactDeviceToken = redactDeviceToken;
/**
 * Delivers `EventOutbox` rows to `${VIIS_BACKEND}/api/v2/alarm/notification-by-token` in `seq` order.
 *
 * - A transient failure (network, 5xx, 408, 409 = backend inbox still processing the event, 429, and
 *   401/403/404 = token rotated, device re-provisioned, route not deployed yet) stops the batch so nothing
 *   overtakes the failed row, and backs it off `min(maxBackoff, 5 s × 2^attempts)`. Such a pause never
 *   marks the queue dead and sets `failing`, so the snapshot runs once delivery recovers.
 * - A row that keeps failing is marked dead after `MAX_ATTEMPTS` (20) attempts or `MAX_ROW_AGE_MS` (24 h)
 *   since it was created, so one poison row cannot block every later event forever. The next flush
 *   schedules a snapshot, because the dropped event may have been a state-alarm raise/clear.
 * - Any other 4xx (payload refused) marks the row dead and moves on: one bad row must not block every
 *   later event.
 * - The first success after a failure schedules a `snapshot-by-token` with the gateway's Pending state
 *   alarms, so the backend clears alarms whose Clear it missed. The snapshot is sent only when no unsent
 *   state-alarm row remains (a queued Clear must reach the backend before the snapshot), and the
 *   "snapshot pending" flag lives in MySQL so a restart does not forget it.
 * - The device token is read from env at send time, sent only as the query parameter and never logged.
 */
const axios_1 = __importDefault(require("axios"));
const BASE_BACKOFF_MS = 5000;
const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Pause-and-retry statuses: 408/429 (slow / throttled), 409 (backend inbox still processing the event),
 * 401/403 (token rotated or revoked, re-provisioning), 404 (route not deployed yet). All are fixed on the
 * backend side, so the row waits (still subject to MAX_ATTEMPTS / MAX_ROW_AGE_MS) instead of being dropped.
 */
/** The backend rejects a snapshot that lists more (`GATEWAY_ALARM_SNAPSHOT_MAX`). */
exports.SNAPSHOT_MAX_ALARMS = 500;
const RETRYABLE_4XX = new Set([401, 403, 404, 408, 409, 429]);
/** A row is dead after this many failed attempts ... */
exports.MAX_ATTEMPTS = 20;
/** ... or once it is this old (since `created_at`) and still failing. */
exports.MAX_ROW_AGE_MS = 24 * 60 * 60 * 1000;
const consoleLogger = {
    log: m => console.log(m),
    warn: m => console.warn(m),
    error: m => console.error(m),
};
/** Masks `device_access_token=` values in any text that may quote a request URL. */
function redactDeviceToken(text) {
    return String(text).replace(/(device_access_token=)[^&\s"']*/g, "$1***");
}
class OutboxSender {
    constructor(outbox, env, opts = {}) {
        var _a, _b, _c, _d, _e, _f;
        this.outbox = outbox;
        this.env = env;
        this.timer = null;
        this.flushing = null;
        /** A send failed and no send has succeeded since. */
        this.failing = false;
        /** Memory mirror of the persisted "snapshot pending" flag; null = not loaded yet. */
        this.snapshotPending = null;
        this.missingConfigWarned = false;
        this.intervalMs = (_a = opts.intervalMs) !== null && _a !== void 0 ? _a : 5000;
        this.batch = (_b = opts.batch) !== null && _b !== void 0 ? _b : 20;
        // 60 s cap: after an outage the next attempt is never minutes away (a 5 min cap made delivery
        // lag recovery by up to 5 min in the local E2E).
        this.maxBackoffMs = (_c = opts.maxBackoffMs) !== null && _c !== void 0 ? _c : 60000;
        this.timeoutMs = (_d = opts.timeoutMs) !== null && _d !== void 0 ? _d : 10000;
        this.logger = (_e = opts.logger) !== null && _e !== void 0 ? _e : consoleLogger;
        this.random = (_f = opts.random) !== null && _f !== void 0 ? _f : Math.random;
    }
    start() {
        var _a, _b;
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            this.flush().catch(error => { var _a; return this.logger.error(`[OUTBOX] flush failed: ${redactDeviceToken((_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error)}`); });
        }, this.intervalMs);
        (_b = (_a = this.timer).unref) === null || _b === void 0 ? void 0 : _b.call(_a);
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    /** One delivery pass. Concurrent calls share the pass in progress. */
    flush(now = new Date()) {
        if (!this.flushing) {
            this.flushing = this.doFlush(now).finally(() => {
                this.flushing = null;
            });
        }
        return this.flushing;
    }
    async doFlush(now) {
        var _a, _b;
        const result = { sent: 0, failed: 0, dead: 0, snapshotSent: false };
        await this.outbox.purgeSent(new Date(now.getTime() - SENT_RETENTION_MS));
        const backendUrl = this.env.getEnvVar("VIIS_BACKEND", "");
        const token = this.env.getEnvVar("DEVICE_ACCESS_TOKEN", "");
        if (!backendUrl || !token) {
            if (!this.missingConfigWarned)
                this.logger.warn("[OUTBOX] sending paused: missing VIIS_BACKEND or DEVICE_ACCESS_TOKEN");
            this.missingConfigWarned = true;
            return result;
        }
        this.missingConfigWarned = false;
        const rows = await this.outbox.nextBatch(this.batch, now);
        for (const row of rows) {
            const outcome = await this.post(`${backendUrl}/api/v2/alarm/notification-by-token`, row.payload, token);
            const attempts = ((_a = row.attempts) !== null && _a !== void 0 ? _a : 0) + 1;
            if (outcome.ok) {
                await this.outbox.markSent(row.seq, now);
                result.sent++;
                // attempts > 0: the row failed before (possibly before a restart, which forgets `failing`).
                if (this.failing || row.attempts > 0)
                    await this.setSnapshotPending(true);
                this.failing = false;
                continue;
            }
            if (outcome.retry) {
                const ageMs = now.getTime() - new Date(row.created_at).getTime();
                if (attempts >= exports.MAX_ATTEMPTS || ageMs >= exports.MAX_ROW_AGE_MS) {
                    // Poison row (or a backend that never took it): drop it so the rows behind it flow, and
                    // let the snapshot repair the state alarm it may have carried.
                    await this.outbox.markDead(row.seq, attempts, outcome.error);
                    this.logger.error(`[OUTBOX] ${describe(row)} dead after ${attempts} attempt(s), ${Math.round(ageMs / 3600000)} h old: ${outcome.error}`);
                    this.failing = true;
                    await this.setSnapshotPending(true);
                    result.dead++;
                    continue;
                }
                // Exponential backoff with ±20 % jitter, so gateways that lost the backend together do not
                // all retry in the same second when it is back.
                const base = Math.min(this.maxBackoffMs, BASE_BACKOFF_MS * 2 ** ((_b = row.attempts) !== null && _b !== void 0 ? _b : 0));
                const delay = Math.round(base * (0.8 + 0.4 * this.random()));
                await this.outbox.markRetry(row.seq, attempts, new Date(now.getTime() + delay), outcome.error);
                this.logger.warn(`[OUTBOX] ${describe(row)} failed (${outcome.error}), attempt ${attempts}, retry in ${delay} ms`);
                this.failing = true;
                result.failed++;
                break;
            }
            await this.outbox.markDead(row.seq, attempts, outcome.error);
            this.logger.error(`[OUTBOX] ${describe(row)} rejected (${outcome.error}), dropped`);
            result.dead++;
        }
        if (result.failed === 0 && (await this.isSnapshotPending()) && !(await this.outbox.hasUnsentStateAlarms())) {
            const active = await this.outbox.activeAlarms();
            if (active.length > exports.SNAPSHOT_MAX_ALARMS) {
                // The backend treats the list as complete and clears every alarm it does not name, so a
                // truncated or chunked list would clear alarms that are still active: send nothing.
                this.logger.error(`[OUTBOX] snapshot skipped: ${active.length} active alarms exceed the backend limit of ${exports.SNAPSHOT_MAX_ALARMS}`);
                await this.setSnapshotPending(false);
            }
            else {
                const outcome = await this.post(`${backendUrl}/api/v2/alarm/snapshot-by-token`, { active }, token);
                if (outcome.ok) {
                    await this.setSnapshotPending(false);
                    result.snapshotSent = true;
                    this.logger.log(`[OUTBOX] snapshot sent: ${active.length} active alarm(s)`);
                }
                else {
                    this.logger.warn(`[OUTBOX] snapshot failed (${outcome.error}), retry on next flush`);
                }
            }
        }
        if (result.sent > 0 || result.dead > 0) {
            this.logger.log(`[OUTBOX] sent ${result.sent}, dead ${result.dead}, failed ${result.failed}`);
        }
        return result;
    }
    async isSnapshotPending() {
        if (this.snapshotPending === null)
            this.snapshotPending = await this.outbox.isSnapshotPending();
        return this.snapshotPending;
    }
    async setSnapshotPending(pending) {
        if (this.snapshotPending === pending)
            return;
        await this.outbox.setSnapshotPending(pending);
        this.snapshotPending = pending;
    }
    async post(url, body, token) {
        var _a, _b;
        try {
            await axios_1.default.post(url, body, {
                params: { device_access_token: token },
                headers: { "Content-Type": "application/json" },
                timeout: this.timeoutMs,
            });
            return { ok: true };
        }
        catch (error) {
            const status = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
            const message = redactDeviceToken((_b = error === null || error === void 0 ? void 0 : error.message) !== null && _b !== void 0 ? _b : error).split(token).join("***");
            const text = status ? `HTTP ${status}: ${message}` : message;
            const retry = status === undefined || status >= 500 || status < 400 || RETRYABLE_4XX.has(status);
            return { ok: false, retry, error: text };
        }
    }
}
exports.OutboxSender = OutboxSender;
function describe(row) {
    var _a, _b, _c, _d;
    const payload = (_a = row.payload) !== null && _a !== void 0 ? _a : {};
    const name = (_d = (_c = (_b = payload.alarm_key) !== null && _b !== void 0 ? _b : payload.message_key) !== null && _c !== void 0 ? _c : payload.alarm_name) !== null && _d !== void 0 ? _d : "event";
    return `#${row.seq} ${String(name)} (${row.event_id})`;
}

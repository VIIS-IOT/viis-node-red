/**
 * Delivers `EventOutbox` rows to `${VIIS_BACKEND}/api/v2/alarm/notification-by-token` in `seq` order.
 *
 * - A transient failure (network, 5xx, 408, 409 = backend inbox still processing the event, 429) stops the
 *   batch so nothing overtakes the failed row, and backs it off `min(maxBackoff, 5 s × 2^attempts)`.
 * - Any other 4xx (token rejected, payload refused) marks the row dead and moves on: one bad row must not
 *   block every later event.
 * - The first success after a failure posts `snapshot-by-token` with the gateway's Pending state alarms,
 *   so the backend clears alarms whose Clear it missed.
 * - The device token is read from env at send time, sent only as the query parameter and never logged.
 */
import axios from "axios";
import { EventOutbox } from "./event-outbox";
import { TabiotEventOutbox } from "../../orm/entities/event-outbox/TabiotEventOutbox";

export interface EnvReader {
    getEnvVar(name: string, defaultValue?: any): any;
}

export interface OutboxLogger {
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface OutboxSenderOptions {
    intervalMs?: number;
    batch?: number;
    maxBackoffMs?: number;
    timeoutMs?: number;
    logger?: OutboxLogger;
    /** Jitter source in [0, 1); tests pass a constant. */
    random?: () => number;
}

export interface FlushResult {
    sent: number;
    failed: number;
    dead: number;
    snapshotSent: boolean;
}

const BASE_BACKOFF_MS = 5000;
const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RETRYABLE_4XX = new Set([408, 409, 429]);

const consoleLogger: OutboxLogger = {
    log: m => console.log(m),
    warn: m => console.warn(m),
    error: m => console.error(m),
};

/** Masks `device_access_token=` values in any text that may quote a request URL. */
export function redactDeviceToken(text: unknown): string {
    return String(text).replace(/(device_access_token=)[^&\s"']*/g, "$1***");
}

/** `retry`/`error` are set when `ok` is false (the build is not strict, so no discriminated union). */
interface SendOutcome { ok: boolean; retry?: boolean; error?: string }

export class OutboxSender {
    private readonly intervalMs: number;
    private readonly batch: number;
    private readonly maxBackoffMs: number;
    private readonly timeoutMs: number;
    private readonly logger: OutboxLogger;
    private readonly random: () => number;
    private timer: NodeJS.Timeout | null = null;
    private flushing: Promise<FlushResult> | null = null;
    /** A send failed and no send has succeeded since. */
    private failing = false;
    /** Delivery recovered after a failure and the snapshot has not reached the backend yet. */
    private snapshotPending = false;
    private missingConfigWarned = false;

    constructor(private readonly outbox: EventOutbox, private readonly env: EnvReader, opts: OutboxSenderOptions = {}) {
        this.intervalMs = opts.intervalMs ?? 5000;
        this.batch = opts.batch ?? 20;
        // 60 s cap: after an outage the next attempt is never minutes away (a 5 min cap made delivery
        // lag recovery by up to 5 min in the local E2E).
        this.maxBackoffMs = opts.maxBackoffMs ?? 60000;
        this.timeoutMs = opts.timeoutMs ?? 10000;
        this.logger = opts.logger ?? consoleLogger;
        this.random = opts.random ?? Math.random;
    }

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.flush().catch(error => this.logger.error(`[OUTBOX] flush failed: ${redactDeviceToken(error?.message ?? error)}`));
        }, this.intervalMs);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /** One delivery pass. Concurrent calls share the pass in progress. */
    flush(now: Date = new Date()): Promise<FlushResult> {
        if (!this.flushing) {
            this.flushing = this.doFlush(now).finally(() => {
                this.flushing = null;
            });
        }
        return this.flushing;
    }

    private async doFlush(now: Date): Promise<FlushResult> {
        const result: FlushResult = { sent: 0, failed: 0, dead: 0, snapshotSent: false };
        await this.outbox.purgeSent(new Date(now.getTime() - SENT_RETENTION_MS));

        const backendUrl = this.env.getEnvVar("VIIS_BACKEND", "");
        const token = this.env.getEnvVar("DEVICE_ACCESS_TOKEN", "");
        if (!backendUrl || !token) {
            if (!this.missingConfigWarned) this.logger.warn("[OUTBOX] sending paused: missing VIIS_BACKEND or DEVICE_ACCESS_TOKEN");
            this.missingConfigWarned = true;
            return result;
        }
        this.missingConfigWarned = false;

        const rows = await this.outbox.nextBatch(this.batch, now);
        for (const row of rows) {
            const outcome = await this.post(`${backendUrl}/api/v2/alarm/notification-by-token`, row.payload, token);
            const attempts = (row.attempts ?? 0) + 1;
            if (outcome.ok) {
                await this.outbox.markSent(row.seq, now);
                result.sent++;
                // attempts > 0: the row failed before (possibly before a restart, which forgets `failing`).
                if (this.failing || row.attempts > 0) this.snapshotPending = true;
                this.failing = false;
                continue;
            }
            if (outcome.retry) {
                // Exponential backoff with ±20 % jitter, so gateways that lost the backend together do not
                // all retry in the same second when it is back.
                const base = Math.min(this.maxBackoffMs, BASE_BACKOFF_MS * 2 ** (row.attempts ?? 0));
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

        if (this.snapshotPending && result.failed === 0) {
            const active = await this.outbox.activeAlarms();
            const outcome = await this.post(`${backendUrl}/api/v2/alarm/snapshot-by-token`, { active }, token);
            if (outcome.ok) {
                this.snapshotPending = false;
                result.snapshotSent = true;
                this.logger.log(`[OUTBOX] snapshot sent: ${active.length} active alarm(s)`);
            } else {
                this.logger.warn(`[OUTBOX] snapshot failed (${outcome.error}), retry on next flush`);
            }
        }
        if (result.sent > 0 || result.dead > 0) {
            this.logger.log(`[OUTBOX] sent ${result.sent}, dead ${result.dead}, failed ${result.failed}`);
        }
        return result;
    }

    private async post(url: string, body: unknown, token: string): Promise<SendOutcome> {
        try {
            await axios.post(url, body, {
                params: { device_access_token: token },
                headers: { "Content-Type": "application/json" },
                timeout: this.timeoutMs,
            });
            return { ok: true };
        } catch (error) {
            const status: number | undefined = (error as any)?.response?.status;
            const message = redactDeviceToken((error as Error)?.message ?? error).split(token).join("***");
            const text = status ? `HTTP ${status}: ${message}` : message;
            const retry = status === undefined || status >= 500 || status < 400 || RETRYABLE_4XX.has(status);
            return { ok: false, retry, error: text };
        }
    }
}

function describe(row: TabiotEventOutbox): string {
    const payload = row.payload ?? {};
    const name = payload.alarm_key ?? payload.message_key ?? payload.alarm_name ?? "event";
    return `#${row.seq} ${String(name)} (${row.event_id})`;
}

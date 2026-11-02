import fs from "fs";
import path from "path";

/**
 * Cloud telemetry uplink: every publish to the device telemetry topic goes through here.
 *
 * - Coalescing: telemetry published within `coalesceMs` of each other (a schedule step writes the valve, then
 *   `iri_time`, `actuator_owners` and `logs` from different nodes) leaves as one `{ts, values}` message. A key that
 *   changes value inside the window flushes the pending message first, so no intermediate state is lost.
 * - Store-and-forward: a message that cannot be published (offline, publish error or timeout) is appended to an
 *   on-disk spool and replayed oldest-first, with its original `ts`, as `[{ts, values}, ...]` batches at most
 *   one message per `replayIntervalMs`. Live telemetry is never queued behind the backlog.
 */

export interface TelemetryRecord {
    ts: number;
    values: Record<string, unknown>;
}

interface SpooledRecord extends TelemetryRecord {
    topic: string;
}

export interface TelemetryUplinkOptions {
    publish(topic: string, payload: string): Promise<void>;
    isConnected(): boolean;
    warn(message: string): void;
    log(message: string): void;
    /** Directory for the on-disk spool; null keeps the spool in memory only. */
    spoolDir: string | null;
    coalesceMs?: number;
    maxSpoolBytes?: number;
    maxSpoolAgeMs?: number;
    replayIntervalMs?: number;
    replayBatchSize?: number;
    segmentRecords?: number;
    now?: () => number;
}

const DEFAULTS = {
    coalesceMs: 500,
    maxSpoolBytes: 50 * 1024 * 1024,
    maxSpoolAgeMs: 72 * 60 * 60 * 1000,
    replayIntervalMs: 100,
    replayBatchSize: 50,
    segmentRecords: 500,
};

/** Backoff before the next replay attempt after a failed replay publish. */
const REPLAY_RETRY_MS = 5000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEpochMs(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string" && value.trim()) {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function normalizeRecord(item: unknown, now: number): TelemetryRecord | null {
    if (!isPlainObject(item)) return null;
    const { ts, values, ...rest } = item;
    const merged: Record<string, unknown> = isPlainObject(values) ? { ...rest, ...values } : { ...rest };
    if (Object.keys(merged).length === 0) return null;
    return { ts: toEpochMs(ts) ?? now, values: merged };
}

/**
 * Telemetry records in a publish payload: `{ts, values}`, a flat `{key: value, ts}` object, or an array of either.
 * Returns null when the payload is not JSON telemetry, so the caller publishes it unchanged.
 */
export function parseTelemetryPayload(message: string | Buffer, now: number): TelemetryRecord[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.isBuffer(message) ? message.toString("utf8") : message);
    } catch {
        return null;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (!items.every(isPlainObject)) return null;
    return items
        .map((item) => normalizeRecord(item, now))
        .filter((record): record is TelemetryRecord => record !== null);
}

/** Append-only spool of segment files (`seg-<ms>-<seq>.jsonl`), consumed oldest-first with an offset file. */
class TelemetrySpool {
    private memory: SpooledRecord[] = [];
    private writeSegment: string | null = null;
    private writeCount = 0;
    private seq = 0;
    private readSegment: string | null = null;
    private readCache: SpooledRecord[] = [];
    private readOffset = 0;

    constructor(
        private readonly dir: string | null,
        private readonly segmentRecords: number,
        private readonly maxBytes: number,
        private readonly warn: (message: string) => void,
    ) {}

    private segments(): string[] {
        if (!this.dir) return [];
        try {
            return fs.readdirSync(this.dir).filter((name) => /^seg-\d+-\d+\.jsonl$/.test(name)).sort((a, b) => {
                const [, aTs, aSeq] = a.match(/^seg-(\d+)-(\d+)/)!;
                const [, bTs, bSeq] = b.match(/^seg-(\d+)-(\d+)/)!;
                return Number(aTs) - Number(bTs) || Number(aSeq) - Number(bSeq);
            });
        } catch {
            return [];
        }
    }

    append(record: SpooledRecord, now: number): void {
        if (!this.dir) {
            this.memory.push(record);
            if (this.memory.length > this.segmentRecords * 20) {
                this.memory.shift();
                this.warn("Telemetry spool (memory) full, dropping the oldest record");
            }
            return;
        }
        try {
            if (!this.writeSegment || this.writeCount >= this.segmentRecords) {
                this.writeSegment = `seg-${now}-${this.seq++}.jsonl`;
                this.writeCount = 0;
            }
            fs.appendFileSync(path.join(this.dir, this.writeSegment), `${JSON.stringify(record)}\n`);
            this.writeCount++;
            this.enforceMaxBytes();
        } catch (error) {
            this.warn(`Telemetry spool write failed, keeping the record in memory: ${(error as Error).message}`);
            this.memory.push(record);
        }
    }

    private enforceMaxBytes(): void {
        const segments = this.segments();
        let total = segments.reduce((sum, name) => sum + this.fileSize(name), 0);
        while (total > this.maxBytes && segments.length > 1) {
            const oldest = segments.shift()!;
            total -= this.fileSize(oldest);
            this.removeSegment(oldest);
            this.warn(`Telemetry spool over ${this.maxBytes} bytes, dropped segment ${oldest}`);
        }
    }

    private fileSize(name: string): number {
        try {
            return fs.statSync(path.join(this.dir!, name)).size;
        } catch {
            return 0;
        }
    }

    private removeSegment(name: string): void {
        for (const file of [name, `${name}.offset`]) {
            try {
                fs.unlinkSync(path.join(this.dir!, file));
            } catch {
                // Already gone.
            }
        }
        if (this.readSegment === name) {
            this.readSegment = null;
            this.readCache = [];
            this.readOffset = 0;
        }
        if (this.writeSegment === name) this.writeSegment = null;
    }

    private loadOldest(): boolean {
        if (this.readSegment) return true;
        const oldest = this.segments()[0];
        if (!oldest) return false;
        // Stop appending to the segment being replayed; new records start a fresh one.
        if (oldest === this.writeSegment) this.writeSegment = null;
        const file = path.join(this.dir!, oldest);
        const lines = fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim());
        this.readCache = [];
        for (const line of lines) {
            try {
                this.readCache.push(JSON.parse(line));
            } catch {
                // A torn last line from a power cut; skip it.
            }
        }
        let offset = 0;
        try {
            offset = Number(fs.readFileSync(`${file}.offset`, "utf8")) || 0;
        } catch {
            offset = 0;
        }
        this.readSegment = oldest;
        this.readOffset = Math.min(offset, this.readCache.length);
        return true;
    }

    /** Oldest records not yet acknowledged, memory records first. */
    peek(limit: number): SpooledRecord[] {
        if (this.memory.length > 0) return this.memory.slice(0, limit);
        if (!this.dir) return [];
        while (this.loadOldest()) {
            if (this.readOffset < this.readCache.length) {
                return this.readCache.slice(this.readOffset, this.readOffset + limit);
            }
            this.removeSegment(this.readSegment!);
        }
        return [];
    }

    ack(count: number): void {
        if (this.memory.length > 0) {
            this.memory.splice(0, count);
            return;
        }
        if (!this.readSegment) return;
        this.readOffset += count;
        if (this.readOffset >= this.readCache.length) {
            this.removeSegment(this.readSegment);
            return;
        }
        try {
            fs.writeFileSync(path.join(this.dir!, `${this.readSegment}.offset`), String(this.readOffset));
        } catch (error) {
            this.warn(`Telemetry spool offset write failed: ${(error as Error).message}`);
        }
    }

    isEmpty(): boolean {
        return this.peek(1).length === 0;
    }
}

interface PendingBatch {
    ts: number;
    values: Record<string, unknown>;
    timer: NodeJS.Timeout;
    waiters: Array<() => void>;
}

export class TelemetryUplink {
    private readonly options: Required<Omit<TelemetryUplinkOptions, "spoolDir">> & { spoolDir: string | null };
    private readonly spool: TelemetrySpool;
    private readonly pending = new Map<string, PendingBatch>();
    private replayTimer: NodeJS.Timeout | null = null;
    private replayInFlight = false;
    private nextReplayAt = 0;
    private closed = false;

    constructor(options: TelemetryUplinkOptions) {
        this.options = { ...DEFAULTS, now: () => Date.now(), ...options } as any;
        let spoolDir = options.spoolDir;
        if (spoolDir) {
            try {
                fs.mkdirSync(spoolDir, { recursive: true });
                fs.accessSync(spoolDir, fs.constants.W_OK);
            } catch (error) {
                options.warn(`Telemetry spool dir ${spoolDir} not writable, spooling in memory: ${(error as Error).message}`);
                spoolDir = null;
            }
        }
        this.spool = new TelemetrySpool(
            spoolDir,
            this.options.segmentRecords,
            this.options.maxSpoolBytes,
            options.warn,
        );
        this.replayTimer = setInterval(() => void this.replayOnce(), this.options.replayIntervalMs);
        this.replayTimer.unref?.();
    }

    /**
     * Queue a telemetry publish. Resolves once the message was published or safely spooled, so a caller never has
     * to keep its own copy. Returns false when the payload is not JSON telemetry and must be published as is.
     */
    enqueue(topic: string, message: string | Buffer): Promise<void> | false {
        const now = this.options.now();
        const records = parseTelemetryPayload(message, now);
        if (records === null) return false;
        if (records.length === 0) return Promise.resolve();
        if (this.closed) {
            records.forEach((record) => this.spool.append({ topic, ...record }, now));
            return Promise.resolve();
        }
        return Promise.all(records.map((record) => this.addRecord(topic, record))).then(() => undefined);
    }

    private addRecord(topic: string, record: TelemetryRecord): Promise<void> {
        const existing = this.pending.get(topic);
        if (existing && !this.canMerge(existing, record)) {
            this.flush(topic);
        }
        return new Promise<void>((resolve) => {
            const batch = this.pending.get(topic);
            if (batch) {
                Object.assign(batch.values, record.values);
                batch.ts = Math.max(batch.ts, record.ts);
                batch.waiters.push(resolve);
                return;
            }
            const timer = setTimeout(() => this.flush(topic), this.options.coalesceMs);
            timer.unref?.();
            this.pending.set(topic, { ts: record.ts, values: { ...record.values }, timer, waiters: [resolve] });
        });
    }

    private canMerge(batch: PendingBatch, record: TelemetryRecord): boolean {
        // A historical record (sent with an old ts) keeps its own message.
        if (Math.abs(record.ts - batch.ts) > this.options.coalesceMs * 2) return false;
        for (const [key, value] of Object.entries(record.values)) {
            if (key in batch.values && JSON.stringify(batch.values[key]) !== JSON.stringify(value)) return false;
        }
        return true;
    }

    private flush(topic: string): void {
        const batch = this.pending.get(topic);
        if (!batch) return;
        this.pending.delete(topic);
        clearTimeout(batch.timer);
        const record: TelemetryRecord = { ts: batch.ts, values: batch.values };
        const done = () => batch.waiters.forEach((resolve) => resolve());
        void this.sendLive(topic, record).then(done, done);
    }

    private async sendLive(topic: string, record: TelemetryRecord): Promise<void> {
        if (this.options.isConnected()) {
            try {
                await this.options.publish(topic, JSON.stringify(record));
                return;
            } catch (error) {
                this.options.warn(`Telemetry publish failed, spooled for replay: ${(error as Error).message}`);
            }
        }
        this.spool.append({ topic, ...record }, this.options.now());
    }

    /** Replay one batch of spooled records; called on a timer, at most one message in flight. */
    async replayOnce(): Promise<void> {
        const now = this.options.now();
        if (this.replayInFlight || now < this.nextReplayAt || !this.options.isConnected()) return;
        let batch = this.spool.peek(this.options.replayBatchSize);
        if (batch.length === 0) return;

        const expired = batch.findIndex((record) => now - record.ts <= this.options.maxSpoolAgeMs);
        if (expired !== 0) {
            const drop = expired === -1 ? batch.length : expired;
            this.spool.ack(drop);
            this.options.warn(`Dropped ${drop} spooled telemetry record(s) older than ${this.options.maxSpoolAgeMs}ms`);
            return;
        }
        const topic = batch[0].topic;
        const sameTopic = batch.findIndex((record) => record.topic !== topic);
        if (sameTopic > 0) batch = batch.slice(0, sameTopic);

        this.replayInFlight = true;
        try {
            await this.options.publish(topic, JSON.stringify(batch.map(({ ts, values }) => ({ ts, values }))));
            this.spool.ack(batch.length);
        } catch (error) {
            this.nextReplayAt = now + REPLAY_RETRY_MS;
            this.options.warn(`Telemetry replay failed, retrying later: ${(error as Error).message}`);
        } finally {
            this.replayInFlight = false;
        }
    }

    hasBacklog(): boolean {
        return !this.spool.isEmpty();
    }

    /** Spool whatever is still coalescing and stop the replay timer. */
    close(): void {
        this.closed = true;
        if (this.replayTimer) clearInterval(this.replayTimer);
        this.replayTimer = null;
        for (const [topic, batch] of Array.from(this.pending.entries())) {
            clearTimeout(batch.timer);
            this.pending.delete(topic);
            this.spool.append({ topic, ts: batch.ts, values: batch.values }, this.options.now());
            batch.waiters.forEach((resolve) => resolve());
        }
    }
}

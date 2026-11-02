"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemetryUplink = void 0;
exports.parseTelemetryPayload = parseTelemetryPayload;
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** Stable id for a record spooled before event_id existed, so its own retries still dedup. */
function legacyEventId(record) {
    const hex = (0, crypto_1.createHash)("sha1").update(`${record.topic}|${record.ts}|${JSON.stringify(record.values)}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function wireMessage(record) {
    return JSON.stringify({ ts: record.ts, event_id: record.event_id, values: record.values });
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
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toEpochMs(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0)
        return value;
    if (typeof value === "string" && value.trim()) {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber) && asNumber > 0)
            return asNumber;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return null;
}
function normalizeRecord(item, now) {
    var _a;
    if (!isPlainObject(item))
        return null;
    const { ts, values } = item, rest = __rest(item, ["ts", "values"]);
    const merged = isPlainObject(values) ? Object.assign(Object.assign({}, rest), values) : Object.assign({}, rest);
    if (Object.keys(merged).length === 0)
        return null;
    return { ts: (_a = toEpochMs(ts)) !== null && _a !== void 0 ? _a : now, values: merged };
}
/**
 * Telemetry records in a publish payload: `{ts, values}`, a flat `{key: value, ts}` object, or an array of either.
 * Returns null when the payload is not JSON telemetry, so the caller publishes it unchanged.
 */
function parseTelemetryPayload(message, now) {
    let parsed;
    try {
        parsed = JSON.parse(Buffer.isBuffer(message) ? message.toString("utf8") : message);
    }
    catch (_a) {
        return null;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (!items.every(isPlainObject))
        return null;
    return items
        .map((item) => normalizeRecord(item, now))
        .filter((record) => record !== null);
}
/** Append-only spool of segment files (`seg-<ms>-<seq>.jsonl`), consumed oldest-first with an offset file. */
class TelemetrySpool {
    constructor(dir, segmentRecords, maxBytes, warn) {
        this.dir = dir;
        this.segmentRecords = segmentRecords;
        this.maxBytes = maxBytes;
        this.warn = warn;
        this.memory = [];
        this.writeSegment = null;
        this.writeCount = 0;
        this.seq = 0;
        this.readSegment = null;
        this.readCache = [];
        this.readOffset = 0;
    }
    segments() {
        if (!this.dir)
            return [];
        try {
            return fs_1.default.readdirSync(this.dir).filter((name) => /^seg-\d+-\d+\.jsonl$/.test(name)).sort((a, b) => {
                const [, aTs, aSeq] = a.match(/^seg-(\d+)-(\d+)/);
                const [, bTs, bSeq] = b.match(/^seg-(\d+)-(\d+)/);
                return Number(aTs) - Number(bTs) || Number(aSeq) - Number(bSeq);
            });
        }
        catch (_a) {
            return [];
        }
    }
    append(record, now) {
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
            fs_1.default.appendFileSync(path_1.default.join(this.dir, this.writeSegment), `${JSON.stringify(record)}\n`);
            this.writeCount++;
            this.enforceMaxBytes();
        }
        catch (error) {
            this.warn(`Telemetry spool write failed, keeping the record in memory: ${error.message}`);
            this.memory.push(record);
        }
    }
    enforceMaxBytes() {
        const segments = this.segments();
        let total = segments.reduce((sum, name) => sum + this.fileSize(name), 0);
        while (total > this.maxBytes && segments.length > 1) {
            const oldest = segments.shift();
            total -= this.fileSize(oldest);
            this.removeSegment(oldest);
            this.warn(`Telemetry spool over ${this.maxBytes} bytes, dropped segment ${oldest}`);
        }
    }
    fileSize(name) {
        try {
            return fs_1.default.statSync(path_1.default.join(this.dir, name)).size;
        }
        catch (_a) {
            return 0;
        }
    }
    removeSegment(name) {
        for (const file of [name, `${name}.offset`]) {
            try {
                fs_1.default.unlinkSync(path_1.default.join(this.dir, file));
            }
            catch (_a) {
                // Already gone.
            }
        }
        if (this.readSegment === name) {
            this.readSegment = null;
            this.readCache = [];
            this.readOffset = 0;
        }
        if (this.writeSegment === name)
            this.writeSegment = null;
    }
    loadOldest() {
        if (this.readSegment)
            return true;
        const oldest = this.segments()[0];
        if (!oldest)
            return false;
        // Stop appending to the segment being replayed; new records start a fresh one.
        if (oldest === this.writeSegment)
            this.writeSegment = null;
        const file = path_1.default.join(this.dir, oldest);
        const lines = fs_1.default.readFileSync(file, "utf8").split("\n").filter((line) => line.trim());
        this.readCache = [];
        for (const line of lines) {
            try {
                this.readCache.push(JSON.parse(line));
            }
            catch (_a) {
                // A torn last line from a power cut; skip it.
            }
        }
        let offset = 0;
        try {
            offset = Number(fs_1.default.readFileSync(`${file}.offset`, "utf8")) || 0;
        }
        catch (_b) {
            offset = 0;
        }
        this.readSegment = oldest;
        this.readOffset = Math.min(offset, this.readCache.length);
        return true;
    }
    /** Oldest records not yet acknowledged, memory records first. */
    peek(limit) {
        if (this.memory.length > 0)
            return this.memory.slice(0, limit);
        if (!this.dir)
            return [];
        while (this.loadOldest()) {
            if (this.readOffset < this.readCache.length) {
                return this.readCache.slice(this.readOffset, this.readOffset + limit);
            }
            this.removeSegment(this.readSegment);
        }
        return [];
    }
    ack(count) {
        if (this.memory.length > 0) {
            this.memory.splice(0, count);
            return;
        }
        if (!this.readSegment)
            return;
        this.readOffset += count;
        if (this.readOffset >= this.readCache.length) {
            this.removeSegment(this.readSegment);
            return;
        }
        try {
            fs_1.default.writeFileSync(path_1.default.join(this.dir, `${this.readSegment}.offset`), String(this.readOffset));
        }
        catch (error) {
            this.warn(`Telemetry spool offset write failed: ${error.message}`);
        }
    }
    isEmpty() {
        return this.peek(1).length === 0;
    }
}
class TelemetryUplink {
    constructor(options) {
        var _a, _b;
        this.pending = new Map();
        this.replayTimer = null;
        this.replayInFlight = false;
        this.nextReplayAt = 0;
        this.closed = false;
        this.options = Object.assign(Object.assign(Object.assign({}, DEFAULTS), { now: () => Date.now() }), options);
        let spoolDir = options.spoolDir;
        if (spoolDir) {
            try {
                fs_1.default.mkdirSync(spoolDir, { recursive: true });
                fs_1.default.accessSync(spoolDir, fs_1.default.constants.W_OK);
            }
            catch (error) {
                options.warn(`Telemetry spool dir ${spoolDir} not writable, spooling in memory: ${error.message}`);
                spoolDir = null;
            }
        }
        this.spool = new TelemetrySpool(spoolDir, this.options.segmentRecords, this.options.maxSpoolBytes, options.warn);
        this.replayTimer = setInterval(() => void this.replayOnce(), this.options.replayIntervalMs);
        (_b = (_a = this.replayTimer).unref) === null || _b === void 0 ? void 0 : _b.call(_a);
    }
    /**
     * Queue a telemetry publish. Resolves once the message was published or safely spooled, so a caller never has
     * to keep its own copy. Returns false when the payload is not JSON telemetry and must be published as is.
     */
    enqueue(topic, message) {
        const now = this.options.now();
        const records = parseTelemetryPayload(message, now);
        if (records === null)
            return false;
        if (records.length === 0)
            return Promise.resolve();
        if (this.closed) {
            records.forEach((record) => this.spool.append(Object.assign(Object.assign({ topic }, record), { event_id: (0, crypto_1.randomUUID)() }), now));
            return Promise.resolve();
        }
        return Promise.all(records.map((record) => this.addRecord(topic, record))).then(() => undefined);
    }
    addRecord(topic, record) {
        const existing = this.pending.get(topic);
        if (existing && !this.canMerge(existing, record)) {
            this.flush(topic);
        }
        return new Promise((resolve) => {
            var _a;
            const batch = this.pending.get(topic);
            if (batch) {
                Object.assign(batch.values, record.values);
                batch.ts = Math.max(batch.ts, record.ts);
                batch.waiters.push(resolve);
                return;
            }
            const timer = setTimeout(() => this.flush(topic), this.options.coalesceMs);
            (_a = timer.unref) === null || _a === void 0 ? void 0 : _a.call(timer);
            this.pending.set(topic, { ts: record.ts, values: Object.assign({}, record.values), timer, waiters: [resolve] });
        });
    }
    canMerge(batch, record) {
        // A historical record (sent with an old ts) keeps its own message.
        if (Math.abs(record.ts - batch.ts) > this.options.coalesceMs * 2)
            return false;
        for (const [key, value] of Object.entries(record.values)) {
            if (key in batch.values && JSON.stringify(batch.values[key]) !== JSON.stringify(value))
                return false;
        }
        return true;
    }
    flush(topic) {
        const batch = this.pending.get(topic);
        if (!batch)
            return;
        this.pending.delete(topic);
        clearTimeout(batch.timer);
        const record = { ts: batch.ts, event_id: (0, crypto_1.randomUUID)(), values: batch.values };
        const done = () => batch.waiters.forEach((resolve) => resolve());
        void this.sendLive(topic, record).then(done, done);
    }
    async sendLive(topic, record) {
        if (this.options.isConnected()) {
            try {
                await this.options.publish(topic, wireMessage(record));
                return;
            }
            catch (error) {
                this.options.warn(`Telemetry publish failed, spooled for replay: ${error.message}`);
            }
        }
        this.spool.append(Object.assign({ topic }, record), this.options.now());
    }
    /** Replay the oldest spooled record; called on a timer, at most one message in flight. */
    async replayOnce() {
        var _a;
        const now = this.options.now();
        if (this.replayInFlight || now < this.nextReplayAt || !this.options.isConnected())
            return;
        const batch = this.spool.peek(this.options.replayBatchSize);
        if (batch.length === 0)
            return;
        const expired = batch.findIndex((record) => now - record.ts <= this.options.maxSpoolAgeMs);
        if (expired !== 0) {
            const drop = expired === -1 ? batch.length : expired;
            this.spool.ack(drop);
            this.options.warn(`Dropped ${drop} spooled telemetry record(s) older than ${this.options.maxSpoolAgeMs}ms`);
            return;
        }
        const record = batch[0];
        this.replayInFlight = true;
        try {
            await this.options.publish(record.topic, wireMessage(Object.assign(Object.assign({}, record), { event_id: (_a = record.event_id) !== null && _a !== void 0 ? _a : legacyEventId(record) })));
            this.spool.ack(1);
        }
        catch (error) {
            this.nextReplayAt = now + REPLAY_RETRY_MS;
            this.options.warn(`Telemetry replay failed, retrying later: ${error.message}`);
        }
        finally {
            this.replayInFlight = false;
        }
    }
    hasBacklog() {
        return !this.spool.isEmpty();
    }
    /** Spool whatever is still coalescing and stop the replay timer. */
    close() {
        this.closed = true;
        if (this.replayTimer)
            clearInterval(this.replayTimer);
        this.replayTimer = null;
        for (const [topic, batch] of Array.from(this.pending.entries())) {
            clearTimeout(batch.timer);
            this.pending.delete(topic);
            this.spool.append({ topic, ts: batch.ts, event_id: (0, crypto_1.randomUUID)(), values: batch.values }, this.options.now());
            batch.waiters.forEach((resolve) => resolve());
        }
    }
}
exports.TelemetryUplink = TelemetryUplink;

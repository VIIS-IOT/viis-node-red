import { randomUUID } from "crypto";
import { DiagnosticEvent, DiagnosticLevel, DiagnosticSinkStatus } from "./types";
import { RotatingFileSink } from "./rotating-file-sink";

const LEVELS: Record<DiagnosticLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|credential|cookie|access.?key|api.?key|private.?key)/i;
const MAX_EVENT_BYTES = 4096;

export const runtimeBootId = randomUUID();

function sanitizeValue(value: unknown, depth = 0, seen = new Set<object>()): unknown {
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") {
        return value
            .replace(/(mqtts?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
            .replace(/([?&](?:token|password|secret|key)=)[^&\s]+/gi, "$1[redacted]")
            .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
            .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*([^\s,;]+)/gi, "$1=[redacted]")
            .slice(0, 512);
    }
    if (typeof value !== "object") return String(value).slice(0, 128);
    if (depth >= 3) return "[depth-limited]";
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);
    if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeValue(item, depth + 1, seen));
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
        result[key.slice(0, 80)] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeValue(item, depth + 1, seen);
    }
    return result;
}

export function makeDiagnosticEvent(input: {
    level: DiagnosticLevel;
    event: string;
    component: string;
    fields?: Record<string, unknown>;
    ts?: string;
}): DiagnosticEvent {
    const safeFields = sanitizeValue(input.fields || {}) as Record<string, unknown>;
    const event: DiagnosticEvent = {
        schemaVersion: 1,
        ts: input.ts || new Date().toISOString(),
        level: input.level,
        event: input.event.slice(0, 100),
        component: input.component.slice(0, 100),
        ...safeFields,
    };
    if (Buffer.byteLength(JSON.stringify(event), "utf8") <= MAX_EVENT_BYTES) return event;

    const compact: DiagnosticEvent = {
        schemaVersion: 1,
        ts: event.ts,
        level: event.level,
        event: event.event,
        component: event.component,
        truncated: true,
    };
    for (const [key, value] of Object.entries(event)) {
        if (key in compact) continue;
        compact[key] = value;
        if (Buffer.byteLength(JSON.stringify(compact), "utf8") > MAX_EVENT_BYTES) delete compact[key];
    }
    return compact;
}

export class DiagnosticRuntime {
    private readonly sink?: RotatingFileSink;
    private readonly level: DiagnosticLevel;
    private enabled: boolean;
    private lastReportedDroppedEvents = 0;
    private startedReported = false;

    constructor(env: NodeJS.ProcessEnv = process.env) {
        this.enabled = env.VIIS_DIAGNOSTICS_ENABLED !== "false";
        this.level = env.VIIS_DIAGNOSTICS_LEVEL === "debug" ? "debug" : "info";
        if (this.enabled) {
            const maxBytes = Number(env.VIIS_DIAGNOSTICS_MAX_BYTES) || 10 * 1024 * 1024;
            const maxFiles = Number(env.VIIS_DIAGNOSTICS_MAX_FILES) || 5;
            this.sink = new RotatingFileSink({
                directory: env.VIIS_DIAGNOSTICS_DIR || "/data/diagnostics",
                maxBytes: Math.max(4096, maxBytes),
                maxFiles,
                maxQueueBytes: 4 * 1024 * 1024,
                retryDelayMs: 30000,
            }, error => this.writeFallback("diagnostics.sink_failed", { error: { message: error.message } }),
            () => this.writeFallback("diagnostics.sink_recovered", {}));
        }
    }

    emit(node: any, component: string, level: DiagnosticLevel, eventName: string, fields: Record<string, unknown> = {}): DiagnosticEvent | undefined {
        if (!this.enabled || LEVELS[level] < LEVELS[this.level]) return undefined;
        if (!this.startedReported) {
            this.startedReported = true;
            this.emit(node, "diagnostic-runtime", "info", "runtime.started", { startedAt: new Date().toISOString() });
        }
        const event = makeDiagnosticEvent({
            level,
            event: eventName,
            component,
            fields: { runtimeBootId, nodeId: node?.id, ...fields },
        });
        const line = JSON.stringify(event);
        try {
            const method = level === "error" ? "error" : level === "warn" ? "warn" : level === "debug" ? "debug" : "log";
            if (typeof node?.[method] === "function") node[method](`[VIIS-DIAG] ${line}`);
        } catch { /* console logger failures must not affect control */ }
        this.sink?.write(line);
        const droppedEvents = this.sink?.getStatus().droppedEvents || 0;
        if (droppedEvents > this.lastReportedDroppedEvents) {
            this.writeFallback("diagnostics.events_dropped", { droppedEvents, delta: droppedEvents - this.lastReportedDroppedEvents });
            this.lastReportedDroppedEvents = droppedEvents;
        }
        return event;
    }

    private writeFallback(eventName: string, fields: Record<string, unknown>): void {
        try {
            const event = makeDiagnosticEvent({
                level: "error",
                event: eventName,
                component: "diagnostics-sink",
                fields: { runtimeBootId, ...fields },
            });
            process.stderr.write(`[VIIS-DIAG] ${JSON.stringify(event)}\n`);
        } catch { /* stderr failure must not affect control */ }
    }

    getStatus(): DiagnosticSinkStatus {
        if (!this.enabled || !this.sink) return { status: "disabled", droppedEvents: 0, queuedBytes: 0 };
        return this.sink.getStatus();
    }

    async close(timeoutMs = 1000): Promise<void> { await this.sink?.close(timeoutMs); }
}

let processRuntime: DiagnosticRuntime | undefined;
export function getDiagnosticRuntime(): DiagnosticRuntime {
    if (!processRuntime) processRuntime = new DiagnosticRuntime();
    return processRuntime;
}

export function resetDiagnosticRuntimeForTests(): void { processRuntime = undefined; }

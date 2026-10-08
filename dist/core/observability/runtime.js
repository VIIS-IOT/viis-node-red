"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiagnosticRuntime = exports.runtimeBootId = void 0;
exports.makeDiagnosticEvent = makeDiagnosticEvent;
exports.getDiagnosticRuntime = getDiagnosticRuntime;
exports.resetDiagnosticRuntimeForTests = resetDiagnosticRuntimeForTests;
const crypto_1 = require("crypto");
const rotating_file_sink_1 = require("./rotating-file-sink");
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|credential|cookie|access.?key|api.?key|private.?key)/i;
const MAX_EVENT_BYTES = 4096;
exports.runtimeBootId = (0, crypto_1.randomUUID)();
function sanitizeValue(value, depth = 0, seen = new Set()) {
    if (value === null || typeof value === "boolean" || typeof value === "number")
        return value;
    if (typeof value === "string") {
        return value
            .replace(/(mqtts?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
            .replace(/([?&](?:token|password|secret|key)=)[^&\s]+/gi, "$1[redacted]")
            .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
            .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*([^\s,;]+)/gi, "$1=[redacted]")
            .slice(0, 512);
    }
    if (typeof value !== "object")
        return String(value).slice(0, 128);
    if (depth >= 3)
        return "[depth-limited]";
    if (seen.has(value))
        return "[circular]";
    seen.add(value);
    if (Array.isArray(value))
        return value.slice(0, 20).map(item => sanitizeValue(item, depth + 1, seen));
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
        result[key.slice(0, 80)] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeValue(item, depth + 1, seen);
    }
    return result;
}
function makeDiagnosticEvent(input) {
    const safeFields = sanitizeValue(input.fields || {});
    const event = Object.assign({ schemaVersion: 1, ts: input.ts || new Date().toISOString(), level: input.level, event: input.event.slice(0, 100), component: input.component.slice(0, 100) }, safeFields);
    if (Buffer.byteLength(JSON.stringify(event), "utf8") <= MAX_EVENT_BYTES)
        return event;
    const compact = {
        schemaVersion: 1,
        ts: event.ts,
        level: event.level,
        event: event.event,
        component: event.component,
        truncated: true,
    };
    for (const [key, value] of Object.entries(event)) {
        if (key in compact)
            continue;
        compact[key] = value;
        if (Buffer.byteLength(JSON.stringify(compact), "utf8") > MAX_EVENT_BYTES)
            delete compact[key];
    }
    return compact;
}
class DiagnosticRuntime {
    constructor(env = process.env) {
        this.lastReportedDroppedEvents = 0;
        this.startedReported = false;
        this.enabled = env.VIIS_DIAGNOSTICS_ENABLED !== "false";
        this.level = env.VIIS_DIAGNOSTICS_LEVEL === "debug" ? "debug" : "info";
        if (this.enabled) {
            const maxBytes = Number(env.VIIS_DIAGNOSTICS_MAX_BYTES) || 10 * 1024 * 1024;
            const maxFiles = Number(env.VIIS_DIAGNOSTICS_MAX_FILES) || 5;
            this.sink = new rotating_file_sink_1.RotatingFileSink({
                directory: env.VIIS_DIAGNOSTICS_DIR || "/data/diagnostics",
                maxBytes: Math.max(4096, maxBytes),
                maxFiles,
                maxQueueBytes: 4 * 1024 * 1024,
                retryDelayMs: 30000,
            }, error => this.writeFallback("diagnostics.sink_failed", { error: { message: error.message } }), () => this.writeFallback("diagnostics.sink_recovered", {}));
        }
    }
    emit(node, component, level, eventName, fields = {}) {
        var _a, _b;
        if (!this.enabled || LEVELS[level] < LEVELS[this.level])
            return undefined;
        if (!this.startedReported) {
            this.startedReported = true;
            this.emit(node, "diagnostic-runtime", "info", "runtime.started", { startedAt: new Date().toISOString() });
        }
        const event = makeDiagnosticEvent({
            level,
            event: eventName,
            component,
            fields: Object.assign({ runtimeBootId: exports.runtimeBootId, nodeId: node === null || node === void 0 ? void 0 : node.id }, fields),
        });
        const line = JSON.stringify(event);
        try {
            const method = level === "error" ? "error" : level === "warn" ? "warn" : level === "debug" ? "debug" : "log";
            if (typeof (node === null || node === void 0 ? void 0 : node[method]) === "function")
                node[method](`[VIIS-DIAG] ${line}`);
        }
        catch ( /* console logger failures must not affect control */_c) { /* console logger failures must not affect control */ }
        (_a = this.sink) === null || _a === void 0 ? void 0 : _a.write(line);
        const droppedEvents = ((_b = this.sink) === null || _b === void 0 ? void 0 : _b.getStatus().droppedEvents) || 0;
        if (droppedEvents > this.lastReportedDroppedEvents) {
            this.writeFallback("diagnostics.events_dropped", { droppedEvents, delta: droppedEvents - this.lastReportedDroppedEvents });
            this.lastReportedDroppedEvents = droppedEvents;
        }
        return event;
    }
    writeFallback(eventName, fields) {
        try {
            const event = makeDiagnosticEvent({
                level: "error",
                event: eventName,
                component: "diagnostics-sink",
                fields: Object.assign({ runtimeBootId: exports.runtimeBootId }, fields),
            });
            process.stderr.write(`[VIIS-DIAG] ${JSON.stringify(event)}\n`);
        }
        catch ( /* stderr failure must not affect control */_a) { /* stderr failure must not affect control */ }
    }
    getStatus() {
        if (!this.enabled || !this.sink)
            return { status: "disabled", droppedEvents: 0, queuedBytes: 0 };
        return this.sink.getStatus();
    }
    async close(timeoutMs = 1000) { var _a; await ((_a = this.sink) === null || _a === void 0 ? void 0 : _a.close(timeoutMs)); }
}
exports.DiagnosticRuntime = DiagnosticRuntime;
let processRuntime;
function getDiagnosticRuntime() {
    if (!processRuntime)
        processRuntime = new DiagnosticRuntime();
    return processRuntime;
}
function resetDiagnosticRuntimeForTests() { processRuntime = undefined; }

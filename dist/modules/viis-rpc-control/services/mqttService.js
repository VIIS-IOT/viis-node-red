"use strict";
/** MQTT result delivery for VIIS RPC control. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttService = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
const diagnostic_logger_1 = require("../../../core/observability/diagnostic-logger");
const trace_context_1 = require("../../../core/observability/trace-context");
const runtime_1 = require("../../../core/observability/runtime");
class MqttService {
    constructor(options, mqttClient, publishTopic) {
        this.pendingResults = new Map();
        this.activePublishes = new Map();
        this.publishDeadlineMs = 10000;
        this.mqttClient = mqttClient;
        this.publishTopic = publishTopic;
        this.node = options.node;
        this.logger = new logger_1.Logger(options.node, "MQTT-SERVICE");
        this.diagnostic = new diagnostic_logger_1.DiagnosticLogger(options.node, "mqtt-publish");
        this.nodeInstanceId = (0, trace_context_1.createId)();
    }
    orphanContext() {
        var _a;
        const trace = (0, trace_context_1.createTraceContext)({
            runtimeBootId: runtime_1.runtimeBootId,
            nodeId: ((_a = this.node) === null || _a === void 0 ? void 0 : _a.id) || "unknown",
            nodeInstanceId: this.nodeInstanceId,
            ingress: "node_input",
            brokerRole: "none",
        });
        return (0, trace_context_1.createOperationContext)(trace);
    }
    childContext(context) {
        return (0, trace_context_1.createOperationContext)(context, { parentOperationId: context.operationId });
    }
    /** Preserve the legacy void API while exposing a trackable debounced ticket to RPC. */
    publishResult(key, value) {
        this.scheduleResultTracked(key, value, this.orphanContext());
    }
    scheduleResultTracked(key, value, context) {
        const previous = this.pendingResults.get(key);
        if (previous) {
            clearTimeout(previous.timer);
            this.settlePending(previous, { operationId: previous.operationId, status: "superseded", acknowledgement: "none" });
            this.diagnostic.emit("info", "mqtt.publish_superseded", Object.assign(Object.assign({}, previous.context), { supersededByOperationId: context.operationId, key }));
        }
        const operationId = (0, trace_context_1.createId)();
        const publishContext = (0, trace_context_1.createOperationContext)(context, { operationId, parentOperationId: context.operationId });
        let resolve;
        const completion = new Promise(done => { resolve = done; });
        const entry = {
            key,
            value,
            operationId,
            context: publishContext,
            scheduledAt: Date.now(),
            timer: setTimeout(() => {
                var _a;
                if (((_a = this.pendingResults.get(key)) === null || _a === void 0 ? void 0 : _a.operationId) !== operationId)
                    return;
                this.pendingResults.delete(key);
                this.diagnostic.emit("info", "mqtt.publish_scheduled", Object.assign(Object.assign({}, publishContext), { key, debounceMs: constants_1.DEBOUNCE_CONFIG.TIME_MS }));
                void this.publishResultPayload(key, value, publishContext).then(outcome => this.settlePending(entry, outcome));
            }, constants_1.DEBOUNCE_CONFIG.TIME_MS),
            resolve,
            settled: false,
        };
        this.pendingResults.set(key, entry);
        return { operationId, completion };
    }
    async publishResultImmediate(key, value) {
        await this.publishResultImmediateTracked(key, value, this.orphanContext());
    }
    publishResultImmediateTracked(key, value, context) {
        return this.publishResultPayload(key, value, this.childContext(context));
    }
    async publishConfigUpdate(key, value, note) {
        await this.publishConfigUpdateTracked(key, value, note, this.orphanContext());
    }
    publishConfigUpdateTracked(key, value, note, context) {
        const payload = { ts: Date.now(), [key]: value };
        if (note)
            payload.note = note;
        return this.publishPayload(payload, payload, this.childContext(context), constants_1.STATUS_MESSAGES.CONFIG_UPDATED(key));
    }
    async publishMultipleValues(values, note) {
        const payload = Object.assign({ ts: Date.now() }, values);
        if (note)
            payload.note = note;
        await this.publishPayload(payload, payload, this.childContext(this.orphanContext()), `Published: ${Object.keys(values).join(", ")}`);
    }
    async publishCustomPayload(payload) {
        const wirePayload = typeof payload === "string" ? payload : JSON.stringify(payload);
        await this.publishPayload(wirePayload, payload, this.childContext(this.orphanContext()), "Custom payload published");
    }
    async publishError(errorMessage) {
        await this.publishErrorTracked(errorMessage, this.orphanContext());
    }
    publishErrorTracked(errorMessage, context) {
        const payload = { ts: Date.now(), error: errorMessage, status: "error" };
        return this.publishPayload(payload, payload, this.childContext(context));
    }
    publishResultPayload(key, value, context) {
        const payload = { ts: Date.now(), [key]: value };
        return this.publishPayload(payload, payload, context, constants_1.STATUS_MESSAGES.PUBLISHED(key));
    }
    async publishPayload(wirePayload, outputPayload, context, successStatus) {
        const payloadString = typeof wirePayload === "string" ? wirePayload : JSON.stringify(wirePayload);
        const startedAt = Date.now();
        this.activePublishes.set(context.operationId, startedAt);
        if (this.activePublishes.size > 1024) {
            const oldestId = this.activePublishes.keys().next().value;
            if (oldestId)
                this.activePublishes.delete(oldestId);
        }
        this.latestStatusOperationId = context.operationId;
        this.diagnostic.emit("info", "mqtt.publish_started", Object.assign(Object.assign({}, context), { topic: this.publishTopic, payloadBytes: Buffer.byteLength(payloadString, "utf8"), deadlineMs: this.publishDeadlineMs }));
        let timedOut = false;
        let settled = false;
        const operation = Promise.resolve()
            .then(() => this.mqttClient.publish(this.publishTopic, payloadString, undefined, context))
            .then(() => {
            const acknowledgement = this.getAcknowledgementType();
            const outcome = { operationId: context.operationId, status: "acknowledged", acknowledgement };
            this.activePublishes.delete(context.operationId);
            this.lastPublishAcknowledgedAt = new Date().toISOString();
            try {
                this.node.send({ payload: outputPayload });
                this.diagnostic.emit("info", "node.output_sent", Object.assign(Object.assign({}, context), { publishOperationId: context.operationId }));
            }
            catch (error) {
                this.diagnostic.emit("error", "node.output_failed", Object.assign(Object.assign({}, context), { error: this.safeError(error) }));
            }
            if (timedOut) {
                this.diagnostic.emit("info", "mqtt.publish_late_settlement", Object.assign(Object.assign({}, context), { outcome: "acknowledged", elapsedMs: Date.now() - startedAt }));
            }
            else {
                this.diagnostic.emit("info", "mqtt.publish_acknowledged", Object.assign(Object.assign({}, context), { acknowledgement, elapsedMs: Date.now() - startedAt }));
            }
            if (!timedOut && this.latestStatusOperationId === context.operationId && successStatus) {
                this.safeNodeStatus({ fill: "green", shape: "dot", text: successStatus });
            }
            settled = true;
            return outcome;
        }, (error) => {
            const outcome = {
                operationId: context.operationId,
                status: timedOut ? "unknown" : "failed",
                acknowledgement: "none",
                errorCode: this.errorCode(error),
            };
            this.activePublishes.delete(context.operationId);
            if (timedOut) {
                this.diagnostic.emit("warn", "mqtt.publish_late_settlement", Object.assign(Object.assign({}, context), { outcome: "failed_after_unknown", error: this.safeError(error), elapsedMs: Date.now() - startedAt }));
            }
            else {
                this.diagnostic.emit("error", "mqtt.publish_failed", Object.assign(Object.assign({}, context), { error: this.safeError(error), elapsedMs: Date.now() - startedAt }));
                if (this.latestStatusOperationId === context.operationId) {
                    this.safeNodeStatus({ fill: "yellow", shape: "ring", text: "MQTT failed - continuing locally" });
                }
            }
            settled = true;
            return outcome;
        });
        let timeout;
        const deadline = new Promise(resolve => {
            timeout = setTimeout(() => {
                if (settled)
                    return;
                timedOut = true;
                const outcome = { operationId: context.operationId, status: "unknown", acknowledgement: "none" };
                this.diagnostic.emit("warn", "mqtt.publish_wait_timed_out", Object.assign(Object.assign({}, context), { deadlineMs: this.publishDeadlineMs, underlyingOperationMayContinue: true }));
                if (this.latestStatusOperationId === context.operationId) {
                    this.safeNodeStatus({ fill: "yellow", shape: "ring", text: "MQTT acknowledgement pending" });
                }
                resolve(outcome);
            }, this.publishDeadlineMs);
        });
        const outcome = await Promise.race([operation, deadline]);
        if (timeout)
            clearTimeout(timeout);
        return outcome;
    }
    getAcknowledgementType() {
        var _a, _b;
        try {
            return ((_b = (_a = this.mqttClient).getPublishAcknowledgement) === null || _b === void 0 ? void 0 : _b.call(_a)) || "client_callback";
        }
        catch (_c) {
            return "client_callback";
        }
    }
    safeError(error) {
        const value = error;
        return Object.assign(Object.assign({}, (typeof (value === null || value === void 0 ? void 0 : value.code) === "string" ? { code: value.code.slice(0, 64) } : {})), { message: String((value === null || value === void 0 ? void 0 : value.message) || error || "unknown error").slice(0, 256) });
    }
    errorCode(error) {
        const code = error === null || error === void 0 ? void 0 : error.code;
        return typeof code === "string" ? code.slice(0, 64) : undefined;
    }
    safeNodeStatus(status) {
        try {
            this.node.status(status);
        }
        catch ( /* node status must not affect control */_a) { /* node status must not affect control */ }
    }
    settlePending(entry, outcome) {
        var _a;
        if (entry.settled)
            return;
        entry.settled = true;
        if (((_a = this.pendingResults.get(entry.key)) === null || _a === void 0 ? void 0 : _a.operationId) === entry.operationId)
            this.pendingResults.delete(entry.key);
        entry.resolve(outcome);
    }
    clearAllTimeouts() {
        for (const entry of this.pendingResults.values()) {
            clearTimeout(entry.timer);
            this.settlePending(entry, { operationId: entry.operationId, status: "cancelled", acknowledgement: "none" });
            this.diagnostic.emit("info", "mqtt.publish_cancelled", Object.assign(Object.assign({}, entry.context), { reason: "node_closed" }));
        }
        this.pendingResults.clear();
    }
    getPendingPublishCount() {
        return this.pendingResults.size + this.activePublishes.size;
    }
    getPendingPublishKeys() { return Array.from(this.pendingResults.keys()); }
    hasPendingPublish(key) { return this.pendingResults.has(key); }
    cancelPendingPublish(key) {
        const entry = this.pendingResults.get(key);
        if (!entry)
            return false;
        clearTimeout(entry.timer);
        this.settlePending(entry, { operationId: entry.operationId, status: "cancelled", acknowledgement: "none" });
        this.diagnostic.emit("info", "mqtt.publish_cancelled", Object.assign(Object.assign({}, entry.context), { reason: "caller_cancelled" }));
        return true;
    }
    async flushPendingPublishes() {
        var _a;
        const entries = Array.from(this.pendingResults.values());
        for (const entry of entries) {
            clearTimeout(entry.timer);
            if (((_a = this.pendingResults.get(entry.key)) === null || _a === void 0 ? void 0 : _a.operationId) !== entry.operationId)
                continue;
            this.pendingResults.delete(entry.key);
            const outcome = await this.publishResultPayload(entry.key, entry.value, entry.context);
            this.settlePending(entry, outcome);
        }
    }
    getDiagnosticStatus() {
        const timestamps = [
            ...Array.from(this.pendingResults.values(), entry => entry.scheduledAt),
            ...Array.from(this.activePublishes.values()),
        ];
        return Object.assign(Object.assign({ pendingPublishCount: timestamps.length }, (timestamps.length ? { oldestPendingPublishAgeMs: Date.now() - Math.min(...timestamps) } : {})), (this.lastPublishAcknowledgedAt ? { lastPublishAcknowledgedAt: this.lastPublishAcknowledgedAt } : {}));
    }
    isConnected() { return Boolean(this.mqttClient && this.mqttClient.isConnected()); }
    getPublishTopic() { return this.publishTopic; }
}
exports.MqttService = MqttService;

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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScenarioTriggerReporter = exports.NO_WRITE_RESULT_REASON = exports.DEFAULT_WRITE_RESULT_TIMEOUT_MS = void 0;
exports.reportScenarioActionWrite = reportScenarioActionWrite;
exports.reportScenarioWriteFromMsg = reportScenarioWriteFromMsg;
exports.pendingScenarioBatchCount = pendingScenarioBatchCount;
exports.clearPendingScenarioBatches = clearPendingScenarioBatches;
/**
 * Collects the per-action outcome of OFFLINE intent triggers and sends one
 * `iot.notification.scenario.triggered` event per trigger (ADR-035, G1).
 *
 * The automation node does not write to the device itself: its output 1 goes through the flow function
 * "Intent actions -> Modbus commands" (which copies every msg property into each command) into
 * `viis-modbus-flex`. The automation node therefore tags its output with a batch id
 * ({@link SCENARIO_TRIGGER_BATCH_PROP}) and registers the pending actions here; `viis-modbus-flex`
 * calls {@link reportScenarioActionWrite} with each write result. Actions blocked by the protection gate
 * are settled at evaluation time. An action without a write result before the timeout (dropped by the
 * flow: no Modbus mapping, another device, a flow that does not carry the batch id) is `failed`.
 *
 * Both nodes load this module from the same package, so the registry is shared in-process (the same
 * pattern as the shared protection gate).
 */
const crypto_1 = require("crypto");
const scenarioTriggerEvents_1 = require("./scenarioTriggerEvents");
exports.DEFAULT_WRITE_RESULT_TIMEOUT_MS = 30000;
exports.NO_WRITE_RESULT_REASON = "no_write_result";
const pendingBatches = new Map();
function isSettled(trigger) {
    return trigger.actions.every(a => a.settled);
}
function closeBatchIfDone(batchId, batch) {
    if (batch.triggers.every(t => t.sent)) {
        if (batch.timer)
            clearTimeout(batch.timer);
        pendingBatches.delete(batchId);
    }
}
/**
 * Write outcome of one OFFLINE intent action (called by `viis-modbus-flex`). Matches the first unsettled
 * action with the same key (and device, when both sides name one). Unknown batches/keys are ignored.
 * Returns true when an action was settled.
 */
function reportScenarioActionWrite(report) {
    const batch = pendingBatches.get(String(report.batchId));
    if (!batch || !report.key)
        return false;
    for (const trigger of batch.triggers) {
        if (trigger.sent)
            continue;
        const action = trigger.actions.find(a => !a.settled &&
            a.key === report.key &&
            (!a.target_id || !report.deviceId || a.target_id === report.deviceId));
        if (!action)
            continue;
        action.settled = true;
        action.status = report.ok ? "executed" : "failed";
        if (!report.ok) {
            const reason = (0, scenarioTriggerEvents_1.shortReason)(report.error);
            if (reason)
                action.reason = reason;
        }
        if (isSettled(trigger))
            batch.finalize(trigger);
        closeBatchIfDone(String(report.batchId), batch);
        return true;
    }
    return false;
}
/**
 * `viis-modbus-flex` side: `msg` is the write command after the write (`msg.payload` = the write
 * response: `{ success: true, ... }` or `{ error }`). A msg without a trigger batch id is ignored.
 */
function reportScenarioWriteFromMsg(msg, response) {
    var _a, _b;
    const batchId = msg && msg[scenarioTriggerEvents_1.SCENARIO_TRIGGER_BATCH_PROP];
    if (!batchId)
        return false;
    const error = response && typeof response === "object" && !Array.isArray(response) ? response.error : undefined;
    const ok = response !== null && response !== undefined && !error;
    return reportScenarioActionWrite({
        batchId: String(batchId),
        key: (_a = msg.offlineKey) !== null && _a !== void 0 ? _a : null,
        deviceId: (_b = msg.device_id) !== null && _b !== void 0 ? _b : null,
        ok,
        error: ok ? undefined : error || "no write response",
    });
}
/** Test helper: pending batch count. */
function pendingScenarioBatchCount() {
    return pendingBatches.size;
}
/** Test helper: drop every pending batch without sending. */
function clearPendingScenarioBatches() {
    for (const batch of pendingBatches.values()) {
        if (batch.timer)
            clearTimeout(batch.timer);
    }
    pendingBatches.clear();
}
/**
 * One instance per automation node. {@link onEvaluation} is called after every evaluation; it never
 * throws and never waits for the backend.
 */
class ScenarioTriggerReporter {
    constructor(options) {
        var _a, _b, _c;
        this.options = options;
        this.timeoutMs = (_a = options.writeResultTimeoutMs) !== null && _a !== void 0 ? _a : exports.DEFAULT_WRITE_RESULT_TIMEOUT_MS;
        this.now = (_b = options.now) !== null && _b !== void 0 ? _b : (() => new Date());
        this.newId = (_c = options.newId) !== null && _c !== void 0 ? _c : (() => (0, crypto_1.randomUUID)());
    }
    /**
     * Updates the rising edges and opens one trigger per armed intent that acted (allowed or blocked
     * device actions). Returns the batch id to put on the output message when writes are pending,
     * otherwise null.
     */
    onEvaluation(intents, devicesData, results) {
        try {
            return this.evaluate(intents || [], devicesData || [], results || []);
        }
        catch (error) {
            this.options.logger.error(`[SCENARIO-EVENT] evaluation bookkeeping failed: ${error.message}`);
            return null;
        }
    }
    evaluate(intents, devicesData, results) {
        const { edges } = this.options;
        const active = new Map();
        for (const intent of intents) {
            if (intent && intent.enable && intent.type === "OFFLINE")
                active.set(String(intent.id), intent);
        }
        const trueIds = new Set(results.map(r => String(r.id)).filter(id => active.has(id)));
        edges.observe(trueIds);
        const triggers = [];
        for (const result of results) {
            const id = String(result.id);
            const intent = active.get(id);
            if (!intent)
                continue;
            const allowed = result.device_actions || [];
            const blocked = result.blocked_actions || [];
            // Nothing to do (every action already applied): no event, the edge stays armed.
            if (allowed.length + blocked.length === 0)
                continue;
            if (!edges.isArmed(id))
                continue;
            edges.markFired(id);
            const actions = [
                ...allowed.map(a => ({
                    kind: "device",
                    key: a.key,
                    target_id: a.device_id,
                    value: a.value,
                    status: "failed",
                    settled: false,
                })),
                ...blocked.map(a => {
                    const action = {
                        kind: "device",
                        key: a.key,
                        target_id: a.device_id,
                        value: a.value,
                        status: "blocked",
                        settled: true,
                    };
                    const reason = (0, scenarioTriggerEvents_1.shortReason)(a.reason);
                    if (reason)
                        action.reason = reason;
                    return action;
                }),
            ];
            triggers.push({
                scenarioId: id,
                scenarioName: (0, scenarioTriggerEvents_1.scenarioName)(intent),
                triggerId: this.newId(),
                triggeredAt: this.now().toISOString(),
                conditions: (0, scenarioTriggerEvents_1.conditionSnapshot)(intent, devicesData),
                actions,
                sent: false,
            });
        }
        if (!triggers.length)
            return null;
        const batchId = this.newId();
        const batch = {
            triggers,
            timer: null,
            finalize: trigger => this.finalize(trigger),
        };
        for (const trigger of triggers) {
            if (isSettled(trigger))
                this.finalize(trigger);
        }
        if (triggers.every(t => t.sent))
            return null;
        batch.timer = setTimeout(() => this.expire(batchId), this.timeoutMs);
        if (typeof batch.timer.unref === "function")
            batch.timer.unref();
        pendingBatches.set(batchId, batch);
        return batchId;
    }
    expire(batchId) {
        const batch = pendingBatches.get(batchId);
        if (!batch)
            return;
        pendingBatches.delete(batchId);
        for (const trigger of batch.triggers) {
            if (trigger.sent)
                continue;
            for (const action of trigger.actions) {
                if (action.settled)
                    continue;
                action.settled = true;
                action.status = "failed";
                action.reason = exports.NO_WRITE_RESULT_REASON;
            }
            this.finalize(trigger);
        }
    }
    finalize(trigger) {
        if (trigger.sent)
            return;
        trigger.sent = true;
        const { logger } = this.options;
        let event;
        try {
            event = (0, scenarioTriggerEvents_1.buildScenarioTriggeredEvent)({
                deviceId: this.options.deviceId,
                scenarioId: trigger.scenarioId,
                scenarioName: trigger.scenarioName,
                triggerId: trigger.triggerId,
                triggeredAt: trigger.triggeredAt,
                conditions: trigger.conditions,
                actions: trigger.actions.map((_a) => {
                    var { settled } = _a, outcome = __rest(_a, ["settled"]);
                    return outcome;
                }),
            });
        }
        catch (error) {
            logger.error(`[SCENARIO-EVENT] build failed for ${trigger.scenarioId}: ${error.message}`);
            return;
        }
        logger.log(`[SCENARIO-EVENT] ${trigger.scenarioName} (${trigger.scenarioId}) trigger ${trigger.triggerId}: ${event.message_params.result}`);
        // Fire-and-forget: the evaluation never waits for (or fails on) the backend.
        Promise.resolve()
            .then(() => this.options.sink(event))
            .catch(error => {
            var _a;
            logger.error(`[SCENARIO-EVENT] send failed for ${trigger.scenarioId}: ${(_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error}`);
        });
    }
}
exports.ScenarioTriggerReporter = ScenarioTriggerReporter;

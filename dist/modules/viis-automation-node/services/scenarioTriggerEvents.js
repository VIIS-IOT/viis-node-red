"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScenarioTriggerEdges = exports.FIRED_INTENTS_CONTEXT_KEY = exports.MAX_CONDITION_SNAPSHOTS = exports.SCENARIO_TRIGGER_BATCH_PROP = exports.SCENARIO_TRIGGERED_MESSAGE_KEY = void 0;
exports.worstScenarioResult = worstScenarioResult;
exports.scenarioName = scenarioName;
exports.shortReason = shortReason;
exports.conditionSnapshot = conditionSnapshot;
exports.buildScenarioTriggeredEvent = buildScenarioTriggeredEvent;
/**
 * Scenario (Kịch bản) trigger events of OFFLINE intents (ADR-035, design
 * `.plans/2026-10-15-scenario-trigger-events-design.md` "Event contract" + "Gateway" G1).
 *
 * Pure parts: the event payload, the worst-result rule, the condition snapshot and the rising-edge
 * debounce. The write correlation lives in ./scenarioTriggerTracker.ts, the HTTP transport in
 * ./scenarioTriggerSender.ts.
 */
const intentValue_1 = require("../../../core/intentValue");
exports.SCENARIO_TRIGGERED_MESSAGE_KEY = "iot.notification.scenario.triggered";
/** Message property that carries the trigger batch from the automation node to the Modbus write node. */
exports.SCENARIO_TRIGGER_BATCH_PROP = "scenario_trigger_batch";
exports.MAX_CONDITION_SNAPSHOTS = 5;
const MAX_REASON_LENGTH = 200;
const RESULT_RANK = { executed: 0, blocked: 1, failed: 2 };
/** Worst action status: failed > blocked > executed. No actions → executed. */
function worstScenarioResult(statuses) {
    return statuses.reduce((worst, status) => (RESULT_RANK[status] > RESULT_RANK[worst] ? status : worst), "executed");
}
function scenarioName(intent) {
    return String(intent.label || intent.name || intent.id || "");
}
function shortReason(reason) {
    if (reason === undefined || reason === null || reason === "")
        return undefined;
    const text = String(reason);
    return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 1)}…` : text;
}
function collectPredicates(conditions, into) {
    var _a;
    for (const condition of conditions || []) {
        if (condition === null || condition === void 0 ? void 0 : condition.predicate)
            into.push(condition.predicate);
        if ((_a = condition === null || condition === void 0 ? void 0 : condition.conditions) === null || _a === void 0 ? void 0 : _a.length)
            collectPredicates(condition.conditions, into);
    }
    return into;
}
function latestValue(devicesData, deviceId, key) {
    var _a;
    const device = devicesData.find(d => d.device_id === deviceId);
    const item = (_a = device === null || device === void 0 ? void 0 : device.latest_data) === null || _a === void 0 ? void 0 : _a.find(d => d.key === key);
    return item ? item.value : null;
}
/**
 * Values at trigger: one entry per predicate (≤ 5), the predicates that held first, then tree order.
 */
function conditionSnapshot(intent, devicesData) {
    const entries = collectPredicates(intent.conditions, []).map((predicate, index) => {
        var _a, _b, _c;
        const key = String(predicate.identifier || ((_a = predicate.function) === null || _a === void 0 ? void 0 : _a.identifier) || "");
        const dataType = (_b = predicate.function) === null || _b === void 0 ? void 0 : _b.data_type;
        const value = latestValue(devicesData, predicate.device_id, key);
        const threshold = (0, intentValue_1.resolveIntentActionValue)(predicate, dataType);
        const held = value !== null && (0, intentValue_1.compareIntentPredicate)(value, predicate, dataType);
        const snapshot = {
            key,
            value,
            operator: predicate.operation,
            threshold: threshold === undefined ? null : threshold,
        };
        if ((_c = predicate.function) === null || _c === void 0 ? void 0 : _c.unit)
            snapshot.unit = predicate.function.unit;
        return { snapshot, held, index };
    });
    entries.sort((a, b) => Number(b.held) - Number(a.held) || a.index - b.index);
    return entries.slice(0, exports.MAX_CONDITION_SNAPSHOTS).map(e => e.snapshot);
}
const FALLBACK_MESSAGE = {
    executed: name => `Kịch bản "${name}" đã kích hoạt`,
    failed: name => `Kịch bản "${name}" đã kích hoạt nhưng không thực hiện được`,
    blocked: name => `Kịch bản "${name}" đã kích hoạt nhưng bị chặn bởi bảo vệ`,
};
function buildScenarioTriggeredEvent(input) {
    const result = worstScenarioResult(input.actions.map(a => a.status));
    const params = {
        scenarioName: input.scenarioName,
        scenarioId: input.scenarioId,
        triggerId: input.triggerId,
        runsOn: "device",
        result,
        conditions: input.conditions,
        actions: input.actions,
        triggeredAt: input.triggeredAt,
    };
    return {
        alarm_name: input.scenarioName,
        id: input.deviceId,
        msg: FALLBACK_MESSAGE[result](input.scenarioName),
        message_key: exports.SCENARIO_TRIGGERED_MESSAGE_KEY,
        message_params: params,
        message_locale: "vi-VN",
        severity: result === "failed" ? "error" : "notification",
        trigger_time: input.triggeredAt,
        tb_alarm_id: `scenario:${input.scenarioId}:${input.triggerId}`,
        alarm_status: "Pending",
        clear_by: "",
        clear_by_user_id: "",
        entity: input.deviceId,
    };
}
exports.FIRED_INTENTS_CONTEXT_KEY = "scenarioTriggerFiredIntents";
/**
 * Rising-edge debounce: one event per intent per false→true edge. An intent is "fired" from the
 * evaluation that reported it until an evaluation where its condition no longer holds. The fired set
 * is kept in the node context, so a restart (persistent context store) does not repeat the event of
 * a condition that is still true.
 */
class ScenarioTriggerEdges {
    constructor(store) {
        this.store = store;
        const saved = this.read();
        this.fired = new Set(saved);
    }
    read() {
        var _a;
        try {
            const value = (_a = this.store) === null || _a === void 0 ? void 0 : _a.get(exports.FIRED_INTENTS_CONTEXT_KEY);
            return Array.isArray(value) ? value.map(String) : [];
        }
        catch (_b) {
            return [];
        }
    }
    persist() {
        var _a;
        try {
            (_a = this.store) === null || _a === void 0 ? void 0 : _a.set(exports.FIRED_INTENTS_CONTEXT_KEY, Array.from(this.fired));
        }
        catch (_b) {
            // memory state still debounces until restart
        }
    }
    /**
     * Re-arm every fired intent whose condition is not true in this evaluation (or that is no longer an
     * active OFFLINE intent).
     */
    observe(trueIntentIds) {
        let changed = false;
        for (const id of Array.from(this.fired)) {
            if (!trueIntentIds.has(id)) {
                this.fired.delete(id);
                changed = true;
            }
        }
        if (changed)
            this.persist();
    }
    isArmed(intentId) {
        return !this.fired.has(intentId);
    }
    markFired(intentId) {
        if (this.fired.has(intentId))
            return;
        this.fired.add(intentId);
        this.persist();
    }
}
exports.ScenarioTriggerEdges = ScenarioTriggerEdges;

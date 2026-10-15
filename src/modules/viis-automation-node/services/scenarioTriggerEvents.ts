/**
 * Scenario (Kịch bản) trigger events of OFFLINE intents (ADR-035, design
 * `.plans/2026-10-15-scenario-trigger-events-design.md` "Event contract" + "Gateway" G1).
 *
 * Pure parts: the event payload, the worst-result rule, the condition snapshot and the rising-edge
 * debounce. The write correlation lives in ./scenarioTriggerTracker.ts, the HTTP transport in
 * ./scenarioTriggerSender.ts.
 */
import { compareIntentPredicate, resolveIntentActionValue } from "../../../core/intentValue";
import { DeviceIntent, DeviceLatestData, IntentCondition, IntentPredicate } from "../../../core/type";

export const SCENARIO_TRIGGERED_MESSAGE_KEY = "iot.notification.scenario.triggered";

/** Message property that carries the trigger batch from the automation node to the Modbus write node. */
export const SCENARIO_TRIGGER_BATCH_PROP = "scenario_trigger_batch";

export type ScenarioActionStatus = "executed" | "failed" | "blocked";

export interface ScenarioConditionSnapshot {
    key: string;
    value: unknown;
    operator: string;
    threshold: unknown;
    unit?: string;
}

export interface ScenarioActionOutcome {
    kind: "device" | "schedule" | "plan";
    key?: string;
    target_id?: string;
    value: unknown;
    status: ScenarioActionStatus;
    reason?: string;
}

export interface ScenarioTriggeredParams {
    scenarioName: string;
    scenarioId: string;
    triggerId: string;
    runsOn: "server" | "device";
    result: ScenarioActionStatus;
    conditions: ScenarioConditionSnapshot[];
    actions: ScenarioActionOutcome[];
    triggeredAt: string;
}

/** Body of `POST /api/v2/alarm/notification-by-token` (same shape as the schedule events). */
export interface ScenarioTriggeredEvent {
    alarm_name: string;
    id: string;
    msg: string;
    message_key: typeof SCENARIO_TRIGGERED_MESSAGE_KEY;
    message_params: ScenarioTriggeredParams;
    message_locale: "vi-VN";
    severity: "notification" | "error";
    trigger_time: string;
    tb_alarm_id: string;
    alarm_status: string;
    clear_by: string;
    clear_by_user_id: string;
    entity: string;
}

export const MAX_CONDITION_SNAPSHOTS = 5;
const MAX_REASON_LENGTH = 200;

const RESULT_RANK: Record<ScenarioActionStatus, number> = { executed: 0, blocked: 1, failed: 2 };

/** Worst action status: failed > blocked > executed. No actions → executed. */
export function worstScenarioResult(statuses: ScenarioActionStatus[]): ScenarioActionStatus {
    return statuses.reduce<ScenarioActionStatus>(
        (worst, status) => (RESULT_RANK[status] > RESULT_RANK[worst] ? status : worst),
        "executed"
    );
}

export function scenarioName(intent: Pick<DeviceIntent, "id" | "label"> & { name?: string }): string {
    return String(intent.label || intent.name || intent.id || "");
}

export function shortReason(reason: unknown): string | undefined {
    if (reason === undefined || reason === null || reason === "") return undefined;
    const text = String(reason);
    return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 1)}…` : text;
}

function collectPredicates(conditions: IntentCondition[] | null | undefined, into: IntentPredicate[]): IntentPredicate[] {
    for (const condition of conditions || []) {
        if (condition?.predicate) into.push(condition.predicate);
        if (condition?.conditions?.length) collectPredicates(condition.conditions, into);
    }
    return into;
}

function latestValue(devicesData: DeviceLatestData[], deviceId: string, key: string): unknown {
    const device = devicesData.find(d => d.device_id === deviceId);
    const item = device?.latest_data?.find(d => d.key === key);
    return item ? item.value : null;
}

/**
 * Values at trigger: one entry per predicate (≤ 5), the predicates that held first, then tree order.
 */
export function conditionSnapshot(intent: DeviceIntent, devicesData: DeviceLatestData[]): ScenarioConditionSnapshot[] {
    const entries = collectPredicates(intent.conditions, []).map((predicate, index) => {
        const key = String(predicate.identifier || predicate.function?.identifier || "");
        const dataType = predicate.function?.data_type;
        const value = latestValue(devicesData, predicate.device_id, key);
        const threshold = resolveIntentActionValue(predicate, dataType);
        const held = value !== null && compareIntentPredicate(value, predicate, dataType);
        const snapshot: ScenarioConditionSnapshot = {
            key,
            value,
            operator: predicate.operation,
            threshold: threshold === undefined ? null : threshold,
        };
        if (predicate.function?.unit) snapshot.unit = predicate.function.unit;
        return { snapshot, held, index };
    });
    entries.sort((a, b) => Number(b.held) - Number(a.held) || a.index - b.index);
    return entries.slice(0, MAX_CONDITION_SNAPSHOTS).map(e => e.snapshot);
}

const FALLBACK_MESSAGE: Record<ScenarioActionStatus, (name: string) => string> = {
    executed: name => `Kịch bản "${name}" đã kích hoạt`,
    failed: name => `Kịch bản "${name}" đã kích hoạt nhưng không thực hiện được`,
    blocked: name => `Kịch bản "${name}" đã kích hoạt nhưng bị chặn bởi bảo vệ`,
};

export function buildScenarioTriggeredEvent(input: {
    deviceId: string;
    scenarioId: string;
    scenarioName: string;
    triggerId: string;
    triggeredAt: string;
    conditions: ScenarioConditionSnapshot[];
    actions: ScenarioActionOutcome[];
}): ScenarioTriggeredEvent {
    const result = worstScenarioResult(input.actions.map(a => a.status));
    const params: ScenarioTriggeredParams = {
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
        message_key: SCENARIO_TRIGGERED_MESSAGE_KEY,
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

/** Minimal key/value store (a Node-RED context). */
export interface KeyValueStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
}

export const FIRED_INTENTS_CONTEXT_KEY = "scenarioTriggerFiredIntents";

/**
 * Rising-edge debounce: one event per intent per false→true edge. An intent is "fired" from the
 * evaluation that reported it until an evaluation where its condition no longer holds. The fired set
 * is kept in the node context, so a restart (persistent context store) does not repeat the event of
 * a condition that is still true.
 */
export class ScenarioTriggerEdges {
    private fired: Set<string>;

    constructor(private readonly store: KeyValueStore | null) {
        const saved = this.read();
        this.fired = new Set(saved);
    }

    private read(): string[] {
        try {
            const value = this.store?.get(FIRED_INTENTS_CONTEXT_KEY);
            return Array.isArray(value) ? value.map(String) : [];
        } catch {
            return [];
        }
    }

    private persist(): void {
        try {
            this.store?.set(FIRED_INTENTS_CONTEXT_KEY, Array.from(this.fired));
        } catch {
            // memory state still debounces until restart
        }
    }

    /**
     * Re-arm every fired intent whose condition is not true in this evaluation (or that is no longer an
     * active OFFLINE intent).
     */
    observe(trueIntentIds: Set<string>): void {
        let changed = false;
        for (const id of Array.from(this.fired)) {
            if (!trueIntentIds.has(id)) {
                this.fired.delete(id);
                changed = true;
            }
        }
        if (changed) this.persist();
    }

    isArmed(intentId: string): boolean {
        return !this.fired.has(intentId);
    }

    markFired(intentId: string): void {
        if (this.fired.has(intentId)) return;
        this.fired.add(intentId);
        this.persist();
    }
}

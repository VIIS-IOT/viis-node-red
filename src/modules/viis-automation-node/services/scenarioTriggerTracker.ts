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
import { randomUUID } from "crypto";
import { DeviceIntent, DeviceLatestData } from "../../../core/type";
import { IntentProcessingResult } from "../interfaces/types";
import {
    SCENARIO_TRIGGER_BATCH_PROP,
    buildScenarioTriggeredEvent,
    conditionSnapshot,
    ScenarioActionOutcome,
    ScenarioConditionSnapshot,
    ScenarioTriggerEdges,
    ScenarioTriggeredEvent,
    scenarioName,
    shortReason,
} from "./scenarioTriggerEvents";

export const DEFAULT_WRITE_RESULT_TIMEOUT_MS = 30000;
export const NO_WRITE_RESULT_REASON = "no_write_result";

export type ScenarioEventSink = (event: ScenarioTriggeredEvent) => Promise<unknown>;

export interface ScenarioTriggerLogger {
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

interface PendingAction extends ScenarioActionOutcome {
    settled: boolean;
}

interface PendingTrigger {
    scenarioId: string;
    scenarioName: string;
    triggerId: string;
    triggeredAt: string;
    conditions: ScenarioConditionSnapshot[];
    actions: PendingAction[];
    sent: boolean;
}

interface PendingBatch {
    triggers: PendingTrigger[];
    timer: NodeJS.Timeout | null;
    finalize: (trigger: PendingTrigger) => void;
}

const pendingBatches = new Map<string, PendingBatch>();

export interface ScenarioActionWriteReport {
    batchId: string;
    key?: string | null;
    deviceId?: string | null;
    ok: boolean;
    error?: unknown;
}

function isSettled(trigger: PendingTrigger): boolean {
    return trigger.actions.every(a => a.settled);
}

function closeBatchIfDone(batchId: string, batch: PendingBatch): void {
    if (batch.triggers.every(t => t.sent)) {
        if (batch.timer) clearTimeout(batch.timer);
        pendingBatches.delete(batchId);
    }
}

/**
 * Write outcome of one OFFLINE intent action (called by `viis-modbus-flex`). Matches the first unsettled
 * action with the same key (and device, when both sides name one). Unknown batches/keys are ignored.
 * Returns true when an action was settled.
 */
export function reportScenarioActionWrite(report: ScenarioActionWriteReport): boolean {
    const batch = pendingBatches.get(String(report.batchId));
    if (!batch || !report.key) return false;
    for (const trigger of batch.triggers) {
        if (trigger.sent) continue;
        const action = trigger.actions.find(a =>
            !a.settled &&
            a.key === report.key &&
            (!a.target_id || !report.deviceId || a.target_id === report.deviceId)
        );
        if (!action) continue;
        action.settled = true;
        action.status = report.ok ? "executed" : "failed";
        if (!report.ok) {
            const reason = shortReason(report.error);
            if (reason) action.reason = reason;
        }
        if (isSettled(trigger)) batch.finalize(trigger);
        closeBatchIfDone(String(report.batchId), batch);
        return true;
    }
    return false;
}

/**
 * `viis-modbus-flex` side: `msg` is the write command after the write (`msg.payload` = the write
 * response: `{ success: true, ... }` or `{ error }`). A msg without a trigger batch id is ignored.
 */
export function reportScenarioWriteFromMsg(msg: any, response: any): boolean {
    const batchId = msg && msg[SCENARIO_TRIGGER_BATCH_PROP];
    if (!batchId) return false;
    const error = response && typeof response === "object" && !Array.isArray(response) ? response.error : undefined;
    const ok = response !== null && response !== undefined && !error;
    return reportScenarioActionWrite({
        batchId: String(batchId),
        key: msg.offlineKey ?? null,
        deviceId: msg.device_id ?? null,
        ok,
        error: ok ? undefined : error || "no write response",
    });
}

/** Test helper: pending batch count. */
export function pendingScenarioBatchCount(): number {
    return pendingBatches.size;
}

/** Test helper: drop every pending batch without sending. */
export function clearPendingScenarioBatches(): void {
    for (const batch of pendingBatches.values()) {
        if (batch.timer) clearTimeout(batch.timer);
    }
    pendingBatches.clear();
}

export interface ScenarioTriggerReporterOptions {
    deviceId: string;
    edges: ScenarioTriggerEdges;
    sink: ScenarioEventSink;
    logger: ScenarioTriggerLogger;
    writeResultTimeoutMs?: number;
    now?: () => Date;
    newId?: () => string;
}

/**
 * One instance per automation node. {@link onEvaluation} is called after every evaluation; it never
 * throws and never waits for the backend.
 */
export class ScenarioTriggerReporter {
    private readonly timeoutMs: number;
    private readonly now: () => Date;
    private readonly newId: () => string;

    constructor(private readonly options: ScenarioTriggerReporterOptions) {
        this.timeoutMs = options.writeResultTimeoutMs ?? DEFAULT_WRITE_RESULT_TIMEOUT_MS;
        this.now = options.now ?? (() => new Date());
        this.newId = options.newId ?? (() => randomUUID());
    }

    /**
     * Updates the rising edges and opens one trigger per armed intent that acted (allowed or blocked
     * device actions). Returns the batch id to put on the output message when writes are pending,
     * otherwise null.
     */
    onEvaluation(
        intents: DeviceIntent[],
        devicesData: DeviceLatestData[],
        results: IntentProcessingResult[]
    ): string | null {
        try {
            return this.evaluate(intents || [], devicesData || [], results || []);
        } catch (error) {
            this.options.logger.error(`[SCENARIO-EVENT] evaluation bookkeeping failed: ${(error as Error).message}`);
            return null;
        }
    }

    private evaluate(
        intents: DeviceIntent[],
        devicesData: DeviceLatestData[],
        results: IntentProcessingResult[]
    ): string | null {
        const { edges } = this.options;
        const active = new Map<string, DeviceIntent>();
        for (const intent of intents) {
            if (intent && intent.enable && intent.type === "OFFLINE") active.set(String(intent.id), intent);
        }
        const trueIds = new Set(results.map(r => String(r.id)).filter(id => active.has(id)));
        edges.observe(trueIds);

        const triggers: PendingTrigger[] = [];
        for (const result of results) {
            const id = String(result.id);
            const intent = active.get(id);
            if (!intent) continue;
            const allowed = result.device_actions || [];
            const blocked = result.blocked_actions || [];
            // Nothing to do (every action already applied): no event, the edge stays armed.
            if (allowed.length + blocked.length === 0) continue;
            if (!edges.isArmed(id)) continue;
            edges.markFired(id);

            const actions: PendingAction[] = [
                ...allowed.map(a => ({
                    kind: "device" as const,
                    key: a.key,
                    target_id: a.device_id,
                    value: a.value,
                    status: "failed" as const,
                    settled: false,
                })),
                ...blocked.map(a => {
                    const action: PendingAction = {
                        kind: "device",
                        key: a.key,
                        target_id: a.device_id,
                        value: a.value,
                        status: "blocked",
                        settled: true,
                    };
                    const reason = shortReason(a.reason);
                    if (reason) action.reason = reason;
                    return action;
                }),
            ];
            triggers.push({
                scenarioId: id,
                scenarioName: scenarioName(intent as any),
                triggerId: this.newId(),
                triggeredAt: this.now().toISOString(),
                conditions: conditionSnapshot(intent, devicesData),
                actions,
                sent: false,
            });
        }
        if (!triggers.length) return null;

        const batchId = this.newId();
        const batch: PendingBatch = {
            triggers,
            timer: null,
            finalize: trigger => this.finalize(trigger),
        };
        for (const trigger of triggers) {
            if (isSettled(trigger)) this.finalize(trigger);
        }
        if (triggers.every(t => t.sent)) return null;

        batch.timer = setTimeout(() => this.expire(batchId), this.timeoutMs);
        if (typeof batch.timer.unref === "function") batch.timer.unref();
        pendingBatches.set(batchId, batch);
        return batchId;
    }

    private expire(batchId: string): void {
        const batch = pendingBatches.get(batchId);
        if (!batch) return;
        pendingBatches.delete(batchId);
        for (const trigger of batch.triggers) {
            if (trigger.sent) continue;
            for (const action of trigger.actions) {
                if (action.settled) continue;
                action.settled = true;
                action.status = "failed";
                action.reason = NO_WRITE_RESULT_REASON;
            }
            this.finalize(trigger);
        }
    }

    private finalize(trigger: PendingTrigger): void {
        if (trigger.sent) return;
        trigger.sent = true;
        const { logger } = this.options;
        let event: ScenarioTriggeredEvent;
        try {
            event = buildScenarioTriggeredEvent({
                deviceId: this.options.deviceId,
                scenarioId: trigger.scenarioId,
                scenarioName: trigger.scenarioName,
                triggerId: trigger.triggerId,
                triggeredAt: trigger.triggeredAt,
                conditions: trigger.conditions,
                actions: trigger.actions.map(({ settled, ...outcome }) => outcome),
            });
        } catch (error) {
            logger.error(`[SCENARIO-EVENT] build failed for ${trigger.scenarioId}: ${(error as Error).message}`);
            return;
        }
        logger.log(
            `[SCENARIO-EVENT] ${trigger.scenarioName} (${trigger.scenarioId}) trigger ${trigger.triggerId}: ${event.message_params.result}`
        );
        // Fire-and-forget: the evaluation never waits for (or fails on) the backend.
        Promise.resolve()
            .then(() => this.options.sink(event))
            .catch(error => {
                logger.error(`[SCENARIO-EVENT] send failed for ${trigger.scenarioId}: ${(error as Error)?.message ?? error}`);
            });
    }
}

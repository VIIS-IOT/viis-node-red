/** MQTT result delivery for VIIS RPC control. */

import {
    IMqttService,
    ServiceOptions,
    MqttPayload,
    PublishOutcome,
} from "../interfaces/types";
import { OperationContext } from "../../../core/observability/types";
import { DEBOUNCE_CONFIG, STATUS_MESSAGES } from "../constants";
import { Logger } from "../utils/logger";
import { DiagnosticLogger } from "../../../core/observability/diagnostic-logger";
import { createId, createOperationContext, createTraceContext } from "../../../core/observability/trace-context";
import { runtimeBootId } from "../../../core/observability/runtime";

interface PendingResult {
    key: string;
    value: number | boolean;
    operationId: string;
    context: OperationContext;
    scheduledAt: number;
    timer: NodeJS.Timeout;
    resolve: (outcome: PublishOutcome) => void;
    settled: boolean;
}

export class MqttService implements IMqttService {
    private mqttClient: any;
    private publishTopic: string;
    private node: any;
    private logger: Logger;
    private diagnostic: DiagnosticLogger;
    private nodeInstanceId: string;
    private pendingResults = new Map<string, PendingResult>();
    private activePublishes = new Map<string, number>();
    private latestStatusOperationId?: string;
    private lastPublishAcknowledgedAt?: string;
    private readonly publishDeadlineMs = 10000;

    constructor(options: ServiceOptions, mqttClient: any, publishTopic: string) {
        this.mqttClient = mqttClient;
        this.publishTopic = publishTopic;
        this.node = options.node;
        this.logger = new Logger(options.node, "MQTT-SERVICE");
        this.diagnostic = new DiagnosticLogger(options.node, "mqtt-publish");
        this.nodeInstanceId = createId();
    }

    private orphanContext(): OperationContext {
        const trace = createTraceContext({
            runtimeBootId,
            nodeId: this.node?.id || "unknown",
            nodeInstanceId: this.nodeInstanceId,
            ingress: "node_input",
            brokerRole: "none",
        });
        return createOperationContext(trace);
    }

    private childContext(context: OperationContext): OperationContext {
        return createOperationContext(context, { parentOperationId: context.operationId });
    }

    /** Preserve the legacy void API while exposing a trackable debounced ticket to RPC. */
    publishResult(key: string, value: number | boolean): void {
        this.scheduleResultTracked(key, value, this.orphanContext());
    }

    scheduleResultTracked(key: string, value: number | boolean, context: OperationContext): { operationId: string; completion: Promise<PublishOutcome> } {
        const previous = this.pendingResults.get(key);
        if (previous) {
            clearTimeout(previous.timer);
            this.settlePending(previous, { operationId: previous.operationId, status: "superseded", acknowledgement: "none" });
            this.diagnostic.emit("info", "mqtt.publish_superseded", {
                ...previous.context,
                supersededByOperationId: context.operationId,
                key,
            });
        }

        const operationId = createId();
        const publishContext = createOperationContext(context, { operationId, parentOperationId: context.operationId });
        let resolve!: (outcome: PublishOutcome) => void;
        const completion = new Promise<PublishOutcome>(done => { resolve = done; });
        const entry: PendingResult = {
            key,
            value,
            operationId,
            context: publishContext,
            scheduledAt: Date.now(),
            timer: setTimeout(() => {
                if (this.pendingResults.get(key)?.operationId !== operationId) return;
                this.pendingResults.delete(key);
                this.diagnostic.emit("info", "mqtt.publish_scheduled", {
                    ...publishContext,
                    key,
                    debounceMs: DEBOUNCE_CONFIG.TIME_MS,
                });
                void this.publishResultPayload(key, value, publishContext).then(outcome => this.settlePending(entry, outcome));
            }, DEBOUNCE_CONFIG.TIME_MS),
            resolve,
            settled: false,
        };
        this.pendingResults.set(key, entry);
        return { operationId, completion };
    }

    async publishResultImmediate(key: string, value: number | boolean): Promise<void> {
        await this.publishResultImmediateTracked(key, value, this.orphanContext());
    }

    publishResultImmediateTracked(key: string, value: number | boolean, context: OperationContext): Promise<PublishOutcome> {
        return this.publishResultPayload(key, value, this.childContext(context));
    }

    async publishConfigUpdate(key: string, value: any, note?: string): Promise<void> {
        await this.publishConfigUpdateTracked(key, value, note, this.orphanContext());
    }

    publishConfigUpdateTracked(key: string, value: any, note: string | undefined, context: OperationContext): Promise<PublishOutcome> {
        const payload: MqttPayload = { ts: Date.now(), [key]: value };
        if (note) payload.note = note;
        return this.publishPayload(payload, payload, this.childContext(context), STATUS_MESSAGES.CONFIG_UPDATED(key));
    }

    async publishMultipleValues(values: Record<string, any>, note?: string): Promise<void> {
        const payload: MqttPayload = { ts: Date.now(), ...values };
        if (note) payload.note = note;
        await this.publishPayload(payload, payload, this.childContext(this.orphanContext()), `Published: ${Object.keys(values).join(", ")}`);
    }

    async publishCustomPayload(payload: any): Promise<void> {
        const wirePayload = typeof payload === "string" ? payload : JSON.stringify(payload);
        await this.publishPayload(wirePayload, payload, this.childContext(this.orphanContext()), "Custom payload published");
    }

    async publishError(errorMessage: string): Promise<void> {
        await this.publishErrorTracked(errorMessage, this.orphanContext());
    }

    publishErrorTracked(errorMessage: string, context: OperationContext): Promise<PublishOutcome> {
        const payload: MqttPayload = { ts: Date.now(), error: errorMessage, status: "error" };
        return this.publishPayload(payload, payload, this.childContext(context));
    }

    private publishResultPayload(key: string, value: number | boolean, context: OperationContext): Promise<PublishOutcome> {
        const payload: MqttPayload = { ts: Date.now(), [key]: value };
        return this.publishPayload(payload, payload, context, STATUS_MESSAGES.PUBLISHED(key));
    }

    private async publishPayload(wirePayload: unknown, outputPayload: unknown, context: OperationContext, successStatus?: string): Promise<PublishOutcome> {
        const payloadString = typeof wirePayload === "string" ? wirePayload : JSON.stringify(wirePayload);
        const startedAt = Date.now();
        this.activePublishes.set(context.operationId, startedAt);
        if (this.activePublishes.size > 1024) {
            const oldestId = this.activePublishes.keys().next().value as string | undefined;
            if (oldestId) this.activePublishes.delete(oldestId);
        }
        this.latestStatusOperationId = context.operationId;
        this.diagnostic.emit("info", "mqtt.publish_started", {
            ...context,
            topic: this.publishTopic,
            payloadBytes: Buffer.byteLength(payloadString, "utf8"),
            deadlineMs: this.publishDeadlineMs,
        });

        let timedOut = false;
        let settled = false;
        const operation = Promise.resolve()
            .then(() => this.mqttClient.publish(this.publishTopic, payloadString, undefined, context))
            .then((): PublishOutcome => {
                const acknowledgement = this.getAcknowledgementType();
                const outcome: PublishOutcome = { operationId: context.operationId, status: "acknowledged", acknowledgement };
                this.activePublishes.delete(context.operationId);
                this.lastPublishAcknowledgedAt = new Date().toISOString();
                try {
                    this.node.send({ payload: outputPayload });
                    this.diagnostic.emit("info", "node.output_sent", { ...context, publishOperationId: context.operationId });
                } catch (error) {
                    this.diagnostic.emit("error", "node.output_failed", { ...context, error: this.safeError(error) });
                }
                if (timedOut) {
                    this.diagnostic.emit("info", "mqtt.publish_late_settlement", { ...context, outcome: "acknowledged", elapsedMs: Date.now() - startedAt });
                } else {
                    this.diagnostic.emit("info", "mqtt.publish_acknowledged", { ...context, acknowledgement, elapsedMs: Date.now() - startedAt });
                }
                if (!timedOut && this.latestStatusOperationId === context.operationId && successStatus) {
                    this.safeNodeStatus({ fill: "green", shape: "dot", text: successStatus });
                }
                settled = true;
                return outcome;
            }, (error: unknown): PublishOutcome => {
                const outcome: PublishOutcome = {
                    operationId: context.operationId,
                    status: timedOut ? "unknown" : "failed",
                    acknowledgement: "none",
                    errorCode: this.errorCode(error),
                };
                this.activePublishes.delete(context.operationId);
                if (timedOut) {
                    this.diagnostic.emit("warn", "mqtt.publish_late_settlement", {
                        ...context,
                        outcome: "failed_after_unknown",
                        error: this.safeError(error),
                        elapsedMs: Date.now() - startedAt,
                    });
                } else {
                    this.diagnostic.emit("error", "mqtt.publish_failed", {
                        ...context,
                        error: this.safeError(error),
                        elapsedMs: Date.now() - startedAt,
                    });
                    if (this.latestStatusOperationId === context.operationId) {
                        this.safeNodeStatus({ fill: "yellow", shape: "ring", text: "MQTT failed - continuing locally" });
                    }
                }
                settled = true;
                return outcome;
            });

        let timeout: NodeJS.Timeout | undefined;
        const deadline = new Promise<PublishOutcome>(resolve => {
            timeout = setTimeout(() => {
                if (settled) return;
                timedOut = true;
                const outcome: PublishOutcome = { operationId: context.operationId, status: "unknown", acknowledgement: "none" };
                this.diagnostic.emit("warn", "mqtt.publish_wait_timed_out", {
                    ...context,
                    deadlineMs: this.publishDeadlineMs,
                    underlyingOperationMayContinue: true,
                });
                if (this.latestStatusOperationId === context.operationId) {
                    this.safeNodeStatus({ fill: "yellow", shape: "ring", text: "MQTT acknowledgement pending" });
                }
                resolve(outcome);
            }, this.publishDeadlineMs);
        });
        const outcome = await Promise.race([operation, deadline]);
        if (timeout) clearTimeout(timeout);
        return outcome;
    }

    private getAcknowledgementType(): PublishOutcome["acknowledgement"] {
        try {
            return this.mqttClient.getPublishAcknowledgement?.() || "client_callback";
        } catch { return "client_callback"; }
    }

    private safeError(error: unknown): { code?: string; message: string } {
        const value = error as any;
        return {
            ...(typeof value?.code === "string" ? { code: value.code.slice(0, 64) } : {}),
            message: String(value?.message || error || "unknown error").slice(0, 256),
        };
    }

    private errorCode(error: unknown): string | undefined {
        const code = (error as any)?.code;
        return typeof code === "string" ? code.slice(0, 64) : undefined;
    }

    private safeNodeStatus(status: any): void {
        try { this.node.status(status); } catch { /* node status must not affect control */ }
    }

    private settlePending(entry: PendingResult, outcome: PublishOutcome): void {
        if (entry.settled) return;
        entry.settled = true;
        if (this.pendingResults.get(entry.key)?.operationId === entry.operationId) this.pendingResults.delete(entry.key);
        entry.resolve(outcome);
    }

    clearAllTimeouts(): void {
        for (const entry of this.pendingResults.values()) {
            clearTimeout(entry.timer);
            this.settlePending(entry, { operationId: entry.operationId, status: "cancelled", acknowledgement: "none" });
            this.diagnostic.emit("info", "mqtt.publish_cancelled", { ...entry.context, reason: "node_closed" });
        }
        this.pendingResults.clear();
    }

    getPendingPublishCount(): number {
        return this.pendingResults.size + this.activePublishes.size;
    }

    getPendingPublishKeys(): string[] { return Array.from(this.pendingResults.keys()); }
    hasPendingPublish(key: string): boolean { return this.pendingResults.has(key); }

    cancelPendingPublish(key: string): boolean {
        const entry = this.pendingResults.get(key);
        if (!entry) return false;
        clearTimeout(entry.timer);
        this.settlePending(entry, { operationId: entry.operationId, status: "cancelled", acknowledgement: "none" });
        this.diagnostic.emit("info", "mqtt.publish_cancelled", { ...entry.context, reason: "caller_cancelled" });
        return true;
    }

    async flushPendingPublishes(): Promise<void> {
        const entries = Array.from(this.pendingResults.values());
        for (const entry of entries) {
            clearTimeout(entry.timer);
            if (this.pendingResults.get(entry.key)?.operationId !== entry.operationId) continue;
            this.pendingResults.delete(entry.key);
            const outcome = await this.publishResultPayload(entry.key, entry.value, entry.context);
            this.settlePending(entry, outcome);
        }
    }

    getDiagnosticStatus(): { pendingPublishCount: number; oldestPendingPublishAgeMs?: number; lastPublishAcknowledgedAt?: string } {
        const timestamps = [
            ...Array.from(this.pendingResults.values(), entry => entry.scheduledAt),
            ...Array.from(this.activePublishes.values()),
        ];
        return {
            pendingPublishCount: timestamps.length,
            ...(timestamps.length ? { oldestPendingPublishAgeMs: Date.now() - Math.min(...timestamps) } : {}),
            ...(this.lastPublishAcknowledgedAt ? { lastPublishAcknowledgedAt: this.lastPublishAcknowledgedAt } : {}),
        };
    }

    isConnected(): boolean { return Boolean(this.mqttClient && this.mqttClient.isConnected()); }
    getPublishTopic(): string { return this.publishTopic; }
}

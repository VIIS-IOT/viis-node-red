/**
 * RPC Handler for VIIS RPC Control Node
 * Handles RPC request processing and coordination between services
 */

import {
    IRpcHandler,
    RpcMessage,
    ServiceOptions,
    IConfigService,
    IValidationService,
    IModbusService,
    IMqttService
} from "../interfaces/types";
import { LuoiMappingHandler } from "../luoi-mapping-handler";
import { ERROR_MESSAGES, STATUS_MESSAGES, FERTIGATION_KEY_DELAY_MS } from "../constants";
import { Logger } from "../utils/logger";
import { ProtectionGateService } from "../../viis-device-protection/services/protection-gate-service";
import {
    FertigationWriteOp,
    isFertigationBatch,
    planFertigationStartWrites,
    WATER_HAMMER_DELAY_MS,
} from "../../shared/fertigation-start-sequence";
import { isNumberedValveKey } from "../../viis-schedule-executor/schedule-coil-classify";
import { isValveOn } from "../../viis-schedule-executor/schedule-valve-program";
import { DiagnosticLogger } from "../../../core/observability/diagnostic-logger";
import { createId, createOperationContext, createTraceContext } from "../../../core/observability/trace-context";
import { runtimeBootId } from "../../../core/observability/runtime";
import { OperationContext, TraceContext } from "../../../core/observability/types";
import { PublishOutcome } from "../interfaces/types";

interface TraceExecutionState {
    tickets: Promise<PublishOutcome>[];
    knownOutcomes: PublishOutcome[];
    pendingTicketCount: number;
    underlyingSettled: boolean;
    executionFinished: boolean;
    deliveryFinalizing: boolean;
    deliveryFinished: boolean;
    lateAfterTimeout: boolean;
    outstandingLateOperations: number;
    controlOutcome?: string;
    queueWaitMs?: number;
    executionMs?: number;
    error?: { message: string };
}

export class RpcHandler implements IRpcHandler {
    private readonly maxBatchSize = 100;
    private readonly RPC_REQUEST_TIMEOUT = 30000; // 30s overall timeout per RPC request
    private configService: IConfigService;
    private validationService: IValidationService;
    private modbusService: IModbusService;
    private mqttService: IMqttService;
    private luoiHandler: LuoiMappingHandler;
    private node: any;
    private logger: Logger;
    private diagnostic: DiagnosticLogger;
    private readonly nodeInstanceId: string;
    private requestQueue: Promise<unknown> = Promise.resolve();
    private queueLength: number = 0;
    private activeCount = 0;
    private underlyingPendingCount = 0;
    private pendingLateOperationCount = 0;
    private activePhase?: string;
    private lastRpcStartedAt?: string;
    private lastExecutionFinishedAt?: string;
    private readonly traceStates = new Map<string, TraceExecutionState>();
    private protectionGate: ProtectionGateService | null = null;
    private waterHammerDelayMs = WATER_HAMMER_DELAY_MS;

    private readonly defaultBatchOptions = {
        sequential: true,
        modbus_delay_ms: 150,
        timeout_per_cmd: 5000,
        rollback_on_fail: false,
        continue_on_error: false,
    };

    private static readonly COMMAND_PRIORITY: Record<string, number> = {
        valve: 0,
        pump: 1,
        power: 2,
    };

    static getCommandPriority(key: string): number {
        const lower = key.toLowerCase();
        if (isNumberedValveKey(key)) {
            return RpcHandler.COMMAND_PRIORITY.valve;
        }
        if (lower.includes("pump")) {
            return RpcHandler.COMMAND_PRIORITY.pump;
        }
        if (lower.includes("power")) {
            return RpcHandler.COMMAND_PRIORITY.power;
        }
        return 3;
    }

    sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

    constructor(
        options: ServiceOptions,
        configService: IConfigService,
        validationService: IValidationService,
        modbusService: IModbusService,
        mqttService: IMqttService,
        luoiHandler: LuoiMappingHandler
    ) {
        this.configService = configService;
        this.validationService = validationService;
        this.modbusService = modbusService;
        this.mqttService = mqttService;
        this.luoiHandler = luoiHandler;
        this.node = options.node;
        this.logger = new Logger(options.node, "RPC-HANDLER");
        this.diagnostic = new DiagnosticLogger(options.node, "rpc-handler");
        this.nodeInstanceId = createId();
        if (typeof (this.luoiHandler as any).setPublishTracker === "function") {
            this.luoiHandler.setPublishTracker((context, completion) => this.trackPublish(context, completion));
        }
    }

    getDiagnosticStatus(): Record<string, unknown> {
        return {
            queuedCount: this.queueLength,
            activeCount: this.activeCount,
            pendingUnderlyingOperations: this.underlyingPendingCount,
            pendingLateOperations: this.pendingLateOperationCount,
            pendingTraceCount: this.traceStates.size,
            activePhase: this.activePhase,
            lastRpcStartedAt: this.lastRpcStartedAt,
            lastExecutionFinishedAt: this.lastExecutionFinishedAt,
        };
    }

    /**
     * Set protection gate service for coil write protection
     */
    setProtectionGate(gate: ProtectionGateService): void {
        this.protectionGate = gate;
    }

    setWaterHammerDelayMs(ms: number): void {
        this.waterHammerDelayMs = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : WATER_HAMMER_DELAY_MS;
    }

    /**
     * Handle incoming RPC request with retry logic
     */
    async handleRpcRequest(rpcBody: RpcMessage, maxRetries: number = 3, suppliedContext?: TraceContext): Promise<void> {
        const context = suppliedContext || createTraceContext({
            runtimeBootId,
            nodeId: this.node?.id || "unknown",
            nodeInstanceId: this.nodeInstanceId,
            ingress: "node_input",
            brokerRole: "none",
            payload: rpcBody,
        });
        const queuedAt = Date.now();
        this.queueLength++;
        this.logger.log(`[QUEUE] RPC request queued (queue: ${this.queueLength})`);
        this.diagnostic.emit("info", "rpc.queued", {
            ...context,
            method: rpcBody?.method,
            queuePosition: this.queueLength,
        });
        this.pendingTraceContexts.set(context.traceId, context);
        this.registerTrace(context.traceId);

        const execution = this.requestQueue.then(async () => {
            this.logger.log(`[QUEUE] RPC request dequeued, starting execution (remaining: ${this.queueLength - 1})`);
            const queueWaitMs = Date.now() - queuedAt;
            const startedAt = Date.now();
            this.lastRpcStartedAt = new Date(startedAt).toISOString();
            this.activeCount++;
            this.activePhase = "rpc_dispatch";
            this.diagnostic.emit("info", "rpc.started", { ...context, method: rpcBody?.method, queueWaitMs });
            const underlying = this.handleRpcRequestInternal(rpcBody, maxRetries, context);
            this.underlyingPendingCount++;
            let timedOut = false;
            void underlying.then(
                outcome => {
                    if (timedOut) this.diagnostic.emit("warn", "rpc.late_settlement", { ...context, controlOutcome: outcome, elapsedMs: Date.now() - startedAt });
                },
                error => {
                    if (timedOut) this.diagnostic.emit("error", "rpc.late_settlement", { ...context, controlOutcome: "failed", error: { message: (error as Error).message }, elapsedMs: Date.now() - startedAt });
                }
            ).then(() => {
                this.underlyingPendingCount = Math.max(0, this.underlyingPendingCount - 1);
                this.markUnderlyingSettled(context.traceId);
            });
            try {
                const controlOutcome = await this.withTimeout(
                    underlying,
                    this.RPC_REQUEST_TIMEOUT,
                    `RPC request timeout after ${this.RPC_REQUEST_TIMEOUT}ms`
                );
                return { controlOutcome, queueWaitMs, executionMs: Date.now() - startedAt };
            } catch (error) {
                timedOut = (error as Error).message.toLowerCase().includes("timeout");
                if (timedOut) {
                    this.activePhase = "rpc_timeout";
                    this.diagnostic.emit("error", "rpc.timeout", {
                        ...context,
                        queueWaitMs,
                        executionMs: Date.now() - startedAt,
                        underlyingOperationMayContinue: true,
                    });
                }
                throw error;
            } finally {
                this.activeCount = Math.max(0, this.activeCount - 1);
                this.activePhase = undefined;
            }
        });

        this.requestQueue = execution.catch(() => { /* keep queue alive */ }).finally(() => {
            this.queueLength--;
        });

        let controlOutcome: string;
        try {
            const result = await execution;
            controlOutcome = result.controlOutcome;
            this.finishTrace(context, controlOutcome, result.queueWaitMs, result.executionMs);
        } catch (error) {
            controlOutcome = (error as Error).message.toLowerCase().includes("timeout") ? "timed_out" : "failed";
            this.finishTrace(context, controlOutcome, Date.now() - queuedAt, 0, { message: (error as Error).message });
            throw error;
        }
    }

    private registerTrace(traceId: string): void {
        this.traceStates.set(traceId, {
            tickets: [],
            knownOutcomes: [],
            pendingTicketCount: 0,
            underlyingSettled: false,
            executionFinished: false,
            deliveryFinalizing: false,
            deliveryFinished: false,
            lateAfterTimeout: false,
            outstandingLateOperations: 0,
        });
        while (this.traceStates.size > 1024) {
            const oldestTraceId = this.traceStates.keys().next().value as string | undefined;
            if (!oldestTraceId) break;
            this.traceStates.delete(oldestTraceId);
            this.pendingTraceContexts.delete(oldestTraceId);
            this.diagnostic.emit("warn", "rpc.trace_state_evicted", { traceId: oldestTraceId, reason: "capacity", maxTracked: 1024 });
        }
    }

    private summarizeOutcomes(outcomes: PublishOutcome[], pending = false): string {
        if (pending) return "pending";
        if (outcomes.length === 0) return "not_applicable";
        if (outcomes.every(item => item.status === "acknowledged")) return "acknowledged";
        if (outcomes.some(item => item.status === "acknowledged")) return "partial";
        if (outcomes.some(item => item.status === "unknown")) return "unknown";
        if (outcomes.every(item => item.status === "superseded" || item.status === "cancelled")) return "superseded";
        return "failed";
    }

    private finishTrace(context: TraceContext, controlOutcome: string, queueWaitMs: number, executionMs: number, error?: { message: string }): void {
        let state = this.traceStates.get(context.traceId);
        if (!state) {
            this.registerTrace(context.traceId);
            state = this.traceStates.get(context.traceId)!;
        }
        if (state.executionFinished) return;
        state.executionFinished = true;
        state.controlOutcome = controlOutcome;
        state.queueWaitMs = queueWaitMs;
        state.executionMs = executionMs;
        state.error = error;
        state.lateAfterTimeout = controlOutcome === "timed_out";
        this.lastExecutionFinishedAt = new Date().toISOString();
        this.diagnostic.emit(controlOutcome === "failed" || controlOutcome === "timed_out" ? "error" : "info", "rpc.execution_finished", {
            ...context,
            controlOutcome,
            deliveryOutcome: this.summarizeOutcomes(state.knownOutcomes, state.pendingTicketCount > 0 || state.lateAfterTimeout),
            publishCount: state.tickets.length,
            pendingPublishCount: state.pendingTicketCount,
            acknowledgedCount: state.knownOutcomes.filter(item => item.status === "acknowledged").length,
            failedCount: state.knownOutcomes.filter(item => item.status === "failed").length,
            unknownCount: state.knownOutcomes.filter(item => item.status === "unknown").length,
            queueWaitMs,
            executionMs,
            ...(state.lateAfterTimeout ? { underlyingOperationMayContinue: true } : {}),
            ...(error ? { error } : {}),
        });
        if (state.underlyingSettled) void this.finalizeDelivery(context, state);
    }

    private markUnderlyingSettled(traceId: string): void {
        const state = this.traceStates.get(traceId);
        if (!state) return;
        state.underlyingSettled = true;
        if (state.executionFinished && state.outstandingLateOperations === 0) {
            const context = this.pendingTraceContexts.get(traceId);
            if (context) void this.finalizeDelivery(context, state);
        }
    }

    private readonly pendingTraceContexts = new Map<string, TraceContext>();

    private async finalizeDelivery(context: TraceContext, state: TraceExecutionState): Promise<void> {
        if (state.deliveryFinalizing || state.deliveryFinished || !state.underlyingSettled || state.outstandingLateOperations > 0) return;
        state.deliveryFinalizing = true;
        try {
            const outcomes = await Promise.all(state.tickets.map(ticket => ticket));
            state.deliveryFinished = true;
            this.diagnostic.emit("info", "rpc.delivery_finished", {
                ...context,
                controlOutcome: state.controlOutcome,
                deliveryOutcome: this.summarizeOutcomes(outcomes),
                publishCount: outcomes.length,
                acknowledgedCount: outcomes.filter(item => item.status === "acknowledged").length,
                failedCount: outcomes.filter(item => item.status === "failed").length,
                unknownCount: outcomes.filter(item => item.status === "unknown").length,
                lateAfterTimeout: state.lateAfterTimeout,
                queueWaitMs: state.queueWaitMs,
                executionMs: state.executionMs,
                ...(state.error ? { error: state.error } : {}),
            });
        } finally {
            this.traceStates.delete(context.traceId);
            this.pendingTraceContexts.delete(context.traceId);
        }
    }

    private trackPublish(context: TraceContext | undefined, completion: Promise<PublishOutcome>): void {
        if (!context) return;
        const state = this.traceStates.get(context.traceId);
        if (!state) return;
        this.pendingTraceContexts.set(context.traceId, context);
        const safeCompletion = completion.then(
            outcome => outcome,
            () => ({ operationId: createId(), status: "failed", acknowledgement: "none" } as PublishOutcome),
        );
        const ticketIndex = state.tickets.length;
        state.pendingTicketCount++;
        state.tickets.push(safeCompletion);
        void safeCompletion.then(outcome => {
            state!.knownOutcomes[ticketIndex] = outcome;
            state!.pendingTicketCount = Math.max(0, state!.pendingTicketCount - 1);
        });
    }

    private trackLateOperation<T>(context: OperationContext | undefined, operation: Promise<T>, label: string): void {
        if (!context) return;
        const state = this.traceStates.get(context.traceId);
        if (!state) return;
        state.outstandingLateOperations++;
        this.pendingLateOperationCount++;
        const traceContext = this.pendingTraceContexts.get(context.traceId) || context;
        let completed = false;
        const complete = () => {
            if (completed) return;
            completed = true;
            state.outstandingLateOperations = Math.max(0, state.outstandingLateOperations - 1);
            this.pendingLateOperationCount = Math.max(0, this.pendingLateOperationCount - 1);
            if (state.executionFinished && state.underlyingSettled && state.outstandingLateOperations === 0) {
                void this.finalizeDelivery(traceContext, state);
            }
        };
        void operation.then(
            outcome => {
                this.diagnostic.emit("warn", "rpc.late_settlement", {
                    ...context,
                    operationScope: label,
                    lateOutcome: "resolved",
                    controlOutcome: outcome,
                    lateAfterTimeout: true,
                });
            },
            error => {
                this.diagnostic.emit("error", "rpc.late_settlement", {
                    ...context,
                    operationScope: label,
                    lateOutcome: "failed",
                    error: { message: (error as Error).message },
                    lateAfterTimeout: true,
                });
            },
        ).then(complete, complete);
    }

    private operationContext(context: TraceContext, values: Partial<OperationContext> = {}): OperationContext {
        return createOperationContext(context, values);
    }

    /**
     * Internal request processor executed in serialized queue
     */
    private async handleRpcRequestInternal(rpcBody: RpcMessage, maxRetries: number = 3, context?: TraceContext): Promise<string> {
        let lastError: Error | null = null;
        const startTime = Date.now();

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (rpcBody.method === "set_state" && rpcBody.params) {
                    this.logger.log(`Processing RPC request (attempt ${attempt}/${maxRetries}, keys=${Object.keys(rpcBody.params).length})`);
                    this.diagnostic.emit("debug", "rpc.attempt_started", { ...context, attempt, maxAttempts: maxRetries, method: rpcBody.method });
                    const result = await this.handleSetStateRequest(rpcBody.params, context);
                    this.logger.log(`[RPC-DONE] Request completed in ${Date.now() - startTime}ms`);
                    this.diagnostic.emit("debug", "rpc.attempt_finished", { ...context, attempt, outcome: result });
                    return result;
                } else if (rpcBody.method === "set_state_batch" && rpcBody.params) {
                    this.logger.log(`Processing batch RPC request (attempt ${attempt}/${maxRetries})`);
                    const result = await this.handleSetStateBatchRequest(rpcBody.params, context);
                    this.logger.log(`[RPC-DONE] Batch request completed in ${Date.now() - startTime}ms`);
                    return result;
                } else {
                    this.logger.warn(`Unsupported RPC method: ${rpcBody.method}`);
                    return "unsupported"; // No need to retry for unsupported methods
                }
            } catch (error) {
                lastError = error as Error;
                this.logger.error(`[RPC-ERROR] Attempt ${attempt}/${maxRetries} failed after ${Date.now() - startTime}ms: ${lastError.message}`);

                // Check if error is retryable
                if (this.isRetryableError(lastError.message) && attempt < maxRetries) {
                    this.logger.warn(`RPC request failed (attempt ${attempt}/${maxRetries}), retrying: ${lastError.message}`);
                    this.diagnostic.emit("warn", "rpc.retry", { ...context, attempt, nextAttempt: attempt + 1, maxAttempts: maxRetries, error: { message: lastError.message } });
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
                    continue;
                }

                // Non-retryable error or last attempt
                break;
            }
        }

        // Handle the final error
        if (lastError) {
            await this.handleRpcError(lastError, context);
        }
        return lastError ? "failed" : "no_op";
    }

    /**
     * Handle set_state_batch RPC request
     */
    private async handleSetStateBatchRequest(params: Record<string, any>, context?: TraceContext): Promise<string> {
        const commands = Array.isArray(params.commands) ? params.commands : [];
        const options = {
            ...this.defaultBatchOptions,
            ...(params.options || {}),
        };

        if (commands.length === 0) {
            throw new Error("Invalid set_state_batch payload: commands must be a non-empty array");
        }

        if (commands.length > this.maxBatchSize) {
            throw new Error(`Batch size exceeds limit: ${commands.length}/${this.maxBatchSize}`);
        }

        if (!options.sequential) {
            this.logger.warn("set_state_batch received with sequential=false; forcing sequential execution");
            options.sequential = true;
        }

        const batchId = params.batch_id || params.batchId || `batch_${Date.now()}`;
        this.diagnostic.emit("info", "rpc.batch_planned", {
            ...context,
            batchId: String(batchId),
            plannedCount: commands.length,
            executableCount: commands.filter((cmd: any) => cmd?.kind !== "delay").length,
            sequential: true,
        });
        const holdings = this.modbusService.getModbusHoldingRegisters() || {};
        const coils = this.modbusService.getModbusCoils() || {};
        const commandKeys = commands.map((cmd: any) => String(cmd?.key || ""));
        const sortedCommands = isFertigationBatch(commandKeys)
            ? this.buildFertigationBatchCommands(commands, holdings, coils)
            : [...commands].sort((a, b) => {
                const aOrder = typeof a?.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
                const bOrder = typeof b?.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
                const aPriority = RpcHandler.getCommandPriority(String(a?.key || ""));
                const bPriority = RpcHandler.getCommandPriority(String(b?.key || ""));
                const priorityDiff = aPriority - bPriority;
                return priorityDiff !== 0 ? priorityDiff : aOrder - bOrder;
            });

        const results: Array<{
            order: number;
            key: string;
            status: "success" | "failed";
            error?: string;
            timestamp: string;
        }> = [];

        const successfulCommands: Array<{ key: string; value: any; order: number }> = [];

        for (let i = 0; i < sortedCommands.length; i++) {
            const cmd = sortedCommands[i] || {};
            if (cmd.kind === "delay") {
                this.diagnostic.emit("info", "rpc.delay_started", { ...context, batchId, executionIndex: i, delayMs: Number(cmd.ms) || 0 });
                await this.sleep(Number(cmd.ms) || 0);
                this.diagnostic.emit("info", "rpc.delay_finished", { ...context, batchId, executionIndex: i });
                continue;
            }
            const key = String(cmd.key || "");
            const order = typeof cmd.order === "number" ? cmd.order : i;

            if (!key) {
                results.push({
                    order,
                    key: "",
                    status: "failed",
                    error: "Missing command key",
                    timestamp: new Date().toISOString(),
                });
                if (options.sequential && !options.continue_on_error) {
                    break;
                }
                continue;
            }

            const commandContext = context ? createOperationContext(context, {
                commandIndex: order,
                executionIndex: i,
                batchId: String(batchId),
            }) : undefined;
            const commandTimeoutMs = Number(options.timeout_per_cmd) || this.defaultBatchOptions.timeout_per_cmd;
            let commandOperation: Promise<any> | undefined;
            let commandSettled = false;
            try {
                this.diagnostic.emit("info", "rpc.batch_command_started", { ...commandContext, key, executionIndex: i, plannedCount: sortedCommands.length });
                commandOperation = this.handleSetStateRequest({ [key]: cmd.value }, commandContext);
                void commandOperation.then(() => { commandSettled = true; }, () => { commandSettled = true; });
                await this.withTimeout(
                    commandOperation,
                    commandTimeoutMs,
                    `Command timeout for ${key}`
                );

                successfulCommands.push({ key, value: cmd.value, order });
                results.push({
                    order,
                    key,
                    status: "success",
                    timestamp: new Date().toISOString(),
                });
                this.diagnostic.emit("info", "rpc.batch_command_finished", { ...commandContext, key, outcome: "success" });
            } catch (error) {
                const errorMessage = (error as Error).message;
                const timedOut = errorMessage.toLowerCase().includes("timeout") && !commandSettled;
                if (timedOut && commandOperation) {
                    this.trackLateOperation(commandContext, commandOperation, "batch_command");
                    this.diagnostic.emit("error", "rpc.batch_command_timeout", {
                        ...commandContext,
                        key,
                        timeoutMs: commandTimeoutMs,
                        underlyingOperationMayContinue: true,
                    });
                }
                results.push({
                    order,
                    key,
                    status: "failed",
                    error: errorMessage,
                    timestamp: new Date().toISOString(),
                });

                this.logger.error(`Batch command failed [${batchId}] ${key}: ${errorMessage}`);
                this.diagnostic.emit("error", "rpc.batch_command_finished", {
                    ...commandContext,
                    batchId: String(batchId),
                    commandIndex: order,
                    executionIndex: i,
                    key,
                    outcome: "failed",
                    underlyingOperationMayContinue: timedOut,
                    error: { message: errorMessage },
                });

                if (options.rollback_on_fail && successfulCommands.length > 0) {
                    await this.rollbackBatch(successfulCommands, batchId, context);
                }

                if (options.sequential && !options.continue_on_error) {
                    break;
                }
            }

            if (i < sortedCommands.length - 1) {
                const next = sortedCommands[i + 1];
                if (next?.kind === "delay") {
                    continue;
                }
                const delayMs = isFertigationBatch(commandKeys)
                    ? FERTIGATION_KEY_DELAY_MS
                    : Number(options.modbus_delay_ms);
                if (delayMs > 0) {
                    await this.sleep(delayMs);
                }
            }
        }

        const successCount = results.filter(r => r.status === "success").length;
        const overallStatus = successCount === results.length
            ? "success"
            : successCount > 0
                ? "partial"
                : "failed";
        const writeCount = sortedCommands.filter((cmd: any) => cmd?.kind !== "delay").length;
        const unexecutedCount = Math.max(0, writeCount - results.length);

        const batchResultContext = context ? createOperationContext(context, { batchId: String(batchId) }) : undefined;
        const batchResultOutcome = batchResultContext ? await this.mqttService.publishConfigUpdateTracked("rpc_batch_result", {
            batch_id: batchId,
            status: overallStatus,
            total: writeCount,
            success_count: successCount,
            failed_count: results.length - successCount,
            results,
            completed_at: new Date().toISOString(),
        }, "set_state_batch completed", batchResultContext) : undefined;
        if (batchResultContext && batchResultOutcome) this.trackPublish(context, Promise.resolve(batchResultOutcome));

        this.node.status({ fill: overallStatus === "success" ? "green" : "yellow", shape: "dot", text: `batch ${overallStatus}` });
        this.logger.log(`Batch ${batchId} completed: ${overallStatus} (${successCount}/${writeCount})`);
        this.diagnostic.emit(overallStatus === "success" ? "info" : "warn", "rpc.batch_finished", {
            ...context,
            batchId: String(batchId),
            status: overallStatus,
            total: writeCount,
            executedCount: results.length,
            successCount,
            failedCount: results.length - successCount,
            unexecutedCount,
            resultPublishStatus: batchResultOutcome?.status,
        });
        return overallStatus;
    }

    private buildFertigationBatchCommands(
        commands: Array<{ key?: string; value?: unknown; order?: number }>,
        holdings: Record<string, number>,
        coils: Record<string, number>
    ): Array<{ key?: string; value?: unknown; order?: number; kind?: string; ms?: number }> {
        const ops = planFertigationStartWrites({
            commands: commands.map((cmd) => ({ key: String(cmd?.key || ""), value: cmd?.value })),
            holdings,
            coils,
        }, { waterHammerDelayMs: this.waterHammerDelayMs });
        const plannedKeys = new Set(
            ops
                .filter((op): op is Extract<FertigationWriteOp, { kind: "write" }> => op.kind === "write")
                .map((op) => op.key)
        );
        const sequenced: Array<{ key?: string; value?: unknown; order?: number; kind?: string; ms?: number }> = [];
        for (const op of ops) {
            if (op.kind === "delay") {
                sequenced.push({ kind: "delay", ms: op.ms });
                continue;
            }
            sequenced.push({ key: op.key, value: op.value, order: sequenced.length });
        }
        for (const cmd of commands) {
            const key = String(cmd?.key || "");
            if (!key || plannedKeys.has(key)) continue;
            if (Object.prototype.hasOwnProperty.call(coils, key) && !isValveOn(cmd.value)) continue;
            sequenced.push({ key, value: cmd.value, order: sequenced.length });
        }
        return sequenced;
    }

    /**
     * Best-effort rollback for commands that were already applied.
     * Supports boolean and binary numeric commands only.
     */
    private async rollbackBatch(
        successfulCommands: Array<{ key: string; value: any; order: number }>,
        batchId: string,
        context?: TraceContext,
    ): Promise<void> {
        this.logger.warn(`Starting rollback for batch ${batchId} (${successfulCommands.length} commands)`);

        for (const cmd of [...successfulCommands].reverse()) {
            const rollbackValue = this.getRollbackValue(cmd.value);
            if (rollbackValue === null) {
                this.logger.warn(`Skipping rollback for ${cmd.key}: unsupported value ${JSON.stringify(cmd.value)}`);
                continue;
            }

            try {
                const rollbackContext = context ? createOperationContext(context, {
                    parentOperationId: context.traceId,
                    batchId,
                    commandIndex: cmd.order,
                }) : undefined;
                this.diagnostic.emit("warn", "rpc.rollback_started", { ...rollbackContext, key: cmd.key });
                await this.handleSetStateRequest({ [cmd.key]: rollbackValue }, rollbackContext);
                this.diagnostic.emit("info", "rpc.rollback_finished", { ...rollbackContext, key: cmd.key, outcome: "success" });
            } catch (error) {
                this.logger.error(`Rollback failed for ${cmd.key}: ${(error as Error).message}`);
                this.diagnostic.emit("error", "rpc.rollback_finished", { ...context, batchId, commandIndex: cmd.order, key: cmd.key, outcome: "failed", error: { message: (error as Error).message } });
            }
        }
    }

    private getRollbackValue(value: any): any {
        if (value === true) return false;
        if (value === false) return true;
        if (value === 1) return 0;
        if (value === 0) return 1;
        if (value === "1") return "0";
        if (value === "0") return "1";
        if (value === "true") return "false";
        if (value === "false") return "true";
        return null;
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<T>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
                }),
            ]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    /**
     * Check if an error is retryable
     */
    private isRetryableError(errorMessage: string): boolean {
        const retryablePatterns = [
            "timeout",
            "TIMEOUT",
            "Port Not Open",
            "connection lost",
            "ECONNREFUSED",
            "ETIMEDOUT",
            "ECONNRESET",
            "socket hang up"
        ];

        return retryablePatterns.some(pattern =>
            errorMessage.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    /**
     * Handle RPC error with proper logging and status updates
     */
    private async handleRpcError(error: Error, context?: TraceContext): Promise<void> {
        try {
            const err = error as Error;
            let errorMessage = ERROR_MESSAGES.RPC_HANDLING_ERROR + `: ${err.message}`;

            // Handle specific timeout errors
            if (err.message.includes("timeout") || err.message.includes("TIMEOUT")) {
                const boardType = err.message.includes("STM32") ? "STM32" :
                    err.message.includes("ATMEGA") ? "ATMEGA" : "UNKNOWN";
                errorMessage = `${boardType} board timeout error: ${err.message}. Consider increasing timeout values or checking board responsiveness.`;
                this.node.status({ fill: "yellow", shape: "ring", text: `${boardType} timeout` });
                this.logger.error(`${boardType} timeout detected: ${err.message}`);
            }
            // Handle specific Modbus connection errors
            else if (err.message.includes("Port Not Open") ||
                err.message.includes("Modbus client not connected") ||
                err.message.includes("Failed to establish a stable connection")) {

                errorMessage = `Modbus connection error: ${err.message}. Please check device connection and configuration.`;
                this.node.status({ fill: "red", shape: "ring", text: "Modbus disconnected" });
                this.logger.error(`Modbus connection lost: ${err.message}`);

                // Attempt to trigger reconnection by notifying the service
                try {
                    await this.modbusService.checkConnection(undefined, context ? this.operationContext(context) : undefined);
                } catch (reconnectError) {
                    this.logger.error(`Reconnection attempt failed: ${(reconnectError as Error).message}`);
                }
            }
            // Handle write operation failures
            else if (err.message.includes("WRITE-FAILED")) {
                errorMessage = `Modbus write operation failed: ${err.message}. Check board compatibility and configuration.`;
                this.node.status({ fill: "red", shape: "ring", text: "Write failed" });
                this.logger.error(`Write operation failed: ${err.message}`);
            }
            else {
                this.node.status({ fill: "red", shape: "ring", text: "RPC error" });
            }

            this.logger.error(errorMessage);

            // Publish error status via MQTT with retry
            if (context) {
                const publishContext = createOperationContext(context, { parentOperationId: context.traceId });
                const outcome = await this.mqttService.publishErrorTracked(errorMessage, publishContext);
                this.trackPublish(context, Promise.resolve(outcome));
            } else {
                await this.mqttService.publishError(errorMessage);
            }
        } catch (publishError) {
            this.logger.error(`Failed to handle RPC error: ${(publishError as Error).message}`);
        }
    }

    /**
     * Publish error with retry logic
     */
    private async publishErrorWithRetry(errorMessage: string, context?: TraceContext): Promise<void> {
        if (!context) {
            await this.mqttService.publishError(errorMessage);
            return;
        }
        const publishContext = createOperationContext(context, { parentOperationId: context.traceId });
        const outcome = await this.mqttService.publishErrorTracked(errorMessage, publishContext);
        this.trackPublish(context, Promise.resolve(outcome));
    }

    /**
     * Handle set_state RPC request
     */
    private async handleSetStateRequest(params: Record<string, any>, context?: TraceContext): Promise<string> {
        try {
            // Filter out parameters with "undefined" values
            const filteredParams = this.filterUndefinedParams(params);

            if (Object.keys(filteredParams).length === 0) {
                this.logger.warn("All parameters were filtered out due to undefined values");
                this.node.status({ fill: "yellow", shape: "ring", text: "No valid parameters" });
                this.diagnostic.emit("warn", "rpc.no_valid_parameters", { ...context, suppliedCount: Object.keys(params || {}).length });
                return "no_op";
            }

            this.logger.log(`[SET-STATE] Processing ${Object.keys(filteredParams).length} parameters`);

            // Try luoi mapping handler first - it now handles actual Modbus writes
            const hasLuoiMapping = await this.luoiHandler.processRpcBody(filteredParams, context);

            // Create a copy of filteredParams without luoi parameters for standard processing
            const standardParams = { ...filteredParams };
            const luoiMappingKeys = Object.keys(this.luoiHandler['luoiMapping'] || {});
            luoiMappingKeys.forEach(key => {
                delete standardParams[key];
            });

            // Process remaining non-luoi parameters with standard handler
            // Only process if there are remaining parameters after removing luoi keys
            if (Object.keys(standardParams).length > 0) {
                await this.handleStandardParams(standardParams, context);
            }

            this.logger.log(`[SET-STATE] Completed successfully`);
            return Object.keys(standardParams).length === 0 && !hasLuoiMapping ? "no_op" : "success";
        } catch (error) {
            this.logger.error(`Error in handleSetStateRequest: ${(error as Error).message}`);
            throw error;
        }
    }



    /**
     * Filter out parameters with "undefined" values (string or actual undefined)
     */
    private filterUndefinedParams(params: Record<string, any>): Record<string, any> {
        const filteredParams: Record<string, any> = {};
        const filteredKeys: string[] = [];

        for (const [key, value] of Object.entries(params)) {
            // Filter out "undefined" string values and actual undefined values
            if (value === "undefined" || value === undefined) {
                filteredKeys.push(key);
                continue;
            }
            filteredParams[key] = value;
        }

        if (filteredKeys.length > 0) {
            this.logger.warn(`Filtered out parameters with undefined values: ${filteredKeys.join(", ")}`);
        }

        return filteredParams;
    }

    /**
     * Handle standard parameter processing
     * Sort to process holding registers first, then coils
     */
    private async handleStandardParams(params: Record<string, any>, context?: TraceContext): Promise<void> {

        // Get modbus mappings from global variables
        const modbusHoldingRegisters = this.modbusService.getModbusHoldingRegisters() || {};
        const modbusCoils = this.modbusService.getModbusCoils() || {};

        // Separate parameters into holding registers, coils, and config-only
        const holdingParams: Array<[string, any]> = [];
        const coilParams: Array<[string, any]> = [];
        const configParams: Array<[string, any]> = [];

        for (const [key, rawValue] of Object.entries(params)) {
            if (modbusHoldingRegisters.hasOwnProperty(key)) {
                holdingParams.push([key, rawValue]);
            } else if (modbusCoils.hasOwnProperty(key)) {
                coilParams.push([key, rawValue]);
            } else {
                configParams.push([key, rawValue]);
            }
        }

        this.logger.log(`Processing parameters - Holding: ${holdingParams.length}, Coils: ${coilParams.length}, Config: ${configParams.length}`);

        // Process in order: holding registers first, then coils, then config-only
        let executionIndex = 0;
        for (const [key, rawValue] of holdingParams) {
            await this.processParameter(key, rawValue, context ? createOperationContext(context, { executionIndex: executionIndex++ }) : undefined);
            // Small delay between each holding register write
            if (holdingParams.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // Add 1 second delay between processing holding registers and coils
        if (holdingParams.length > 0 && coilParams.length > 0) {
            this.logger.log('Adding 1 second delay between holding registers and coils processing');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        for (const [key, rawValue] of coilParams) {
            await this.processParameter(key, rawValue, context ? createOperationContext(context, { executionIndex: executionIndex++ }) : undefined);
            // Small delay between each coil write to ensure proper sequencing
            if (coilParams.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        for (const [key, rawValue] of configParams) {
            await this.processParameter(key, rawValue, context ? createOperationContext(context, { executionIndex: executionIndex++ }) : undefined);
        }
    }

    /**
     * Process a single parameter
     */
    private async processParameter(key: string, rawValue: any, context?: OperationContext): Promise<void> {
        const mapping = this.modbusService.findModbusMapping(key);
        this.diagnostic.emit("info", "rpc.key_classified", {
            ...context,
            key,
            classification: mapping ? "modbus_mapped" : "config_only",
            ...(mapping ? { boardId: mapping.boardId, functionCode: mapping.fc, address: mapping.address } : {}),
            valueType: typeof rawValue,
        });
        if (mapping) {
            await this.handleModbusMappedParameter(key, rawValue, mapping, context);
        } else {
            await this.handleConfigOnlyParameter(key, rawValue, context);
        }
    }

    /**
     * Handle parameter that has Modbus mapping
     */
    private async handleModbusMappedParameter(key: string, rawValue: any, mapping: any, parentContext?: OperationContext): Promise<void> {
        // Validate and convert value
        const value = this.validationService.validateAndConvertValue(key, rawValue);
        const writeContext = parentContext ? createOperationContext(parentContext, {
            parentOperationId: parentContext.operationId,
            boardId: mapping.boardId,
            functionCode: mapping.fc,
            address: mapping.address,
        }) : undefined;

        // Protection gate check for coils (fc=5)
        if (mapping.fc === 5 && this.protectionGate) {
            const gate = this.protectionGate.checkGate(key, Boolean(value), 'rpc');
            if (!gate.allowed) {
                this.logger.warn(`[PROTECTION] Blocked ${key}=${value}: ${gate.reason}`);
                this.diagnostic.emit("warn", "rpc.protection_blocked", {
                    ...writeContext,
                    key,
                    requestedValue: typeof value === "number" || typeof value === "boolean" ? value : undefined,
                    reason: gate.reason,
                    action: gate.action,
                });
                try {
                    const publishContext = writeContext ? createOperationContext(writeContext, { parentOperationId: writeContext.operationId }) : undefined;
                    const outcome = publishContext ? await this.mqttService.publishConfigUpdateTracked(`_blocked_${key}`, {
                        requested: value,
                        reason: gate.reason,
                        source: 'rpc',
                        action: gate.action,
                    }, undefined, publishContext) : undefined;
                    if (publishContext && outcome) this.trackPublish(parentContext, Promise.resolve(outcome));
                } catch (pubErr) {
                    this.logger.warn(`Failed to publish blocked telemetry: ${(pubErr as Error).message}`);
                }
                throw new Error(`Protection blocked: ${gate.reason}`);
            }
        }

        this.logger.log(`[MODBUS-WRITE] Writing ${key}=${value} (fc=${mapping.fc}, address=${mapping.address})`);

        // Write to Modbus with connection error handling.
        // If this throws, the outer handleRpcRequest retry loop may re-attempt — which is safe
        // because the write did not actually succeed yet.
        try {
            await this.writeToModbusWithRetry(key, mapping, value, 2, writeContext);
            this.logger.log(`[MODBUS-WRITE] Write ${key} completed successfully`);
        } catch (error) {
            this.logger.error(`[MODBUS-WRITE] Failed to write ${key}: ${(error as Error).message}`);
            throw error; // Propagate: write failed, retry is safe
        }

        // Read-back to confirm.
        // CRITICAL: handled in its own try-catch so that a read failure after a SUCCESSFUL write
        // does NOT propagate a retryable error back to handleRpcRequest. If it did, the outer
        // retry loop would execute the write AGAIN — causing double-writes on relays/coils.
        let readValue: number | boolean;
        let readbackSucceeded = false;
        let readContext: OperationContext | undefined;
        try {
            readContext = writeContext ? createOperationContext(writeContext, { parentOperationId: writeContext.operationId }) : undefined;
            readValue = await this.readFromModbusWithRetry(key, mapping, 2, readContext);
            readbackSucceeded = true;
        } catch (readError) {
            // Write succeeded but read-back failed. Publish the written value as fallback and
            // return without throwing — the outer retry must NOT re-write.
            this.logger.warn(`[RPC-HANDLER] Write succeeded but read-back failed for ${key}: ${(readError as Error).message}. Publishing written value as fallback.`);
            this.diagnostic.emit("warn", "modbus.readback_unavailable", {
                ...readContext,
                key,
                boardId: mapping.boardId,
                functionCode: mapping.fc,
                address: mapping.address,
                error: { message: (readError as Error).message },
                writeSucceeded: true,
            });
            readValue = value;
        }

        // These are post-write bookkeeping operations. Their failure must not escape to the
        // outer RPC retry loop, which would repeat a write that already succeeded.
        try {
            if (readbackSucceeded) this.modbusService.updateGlobalContextCacheAfterVerification(key, readValue, mapping.fc);
            if (mapping.fc === 5 && this.protectionGate) this.protectionGate.updateState(key, Boolean(readValue));
            this.node.status(readbackSucceeded
                ? { fill: "green", shape: "dot", text: `${key}=${readValue}` }
                : { fill: "yellow", shape: "ring", text: `${key} written (no readback)` });
        } catch (postWriteError) {
            this.diagnostic.emit("error", "rpc.post_write_processing_failed", {
                ...writeContext,
                key,
                writeSucceeded: true,
                readbackSucceeded,
                error: { message: (postWriteError as Error).message },
            });
        }

        const publishContext = parentContext ? createOperationContext(parentContext, {
            parentOperationId: (readbackSucceeded ? readContext?.operationId : writeContext?.operationId),
            boardId: mapping.boardId,
            functionCode: mapping.fc,
            address: mapping.address,
        }) : undefined;
        if (publishContext) {
            try {
                const ticket = this.mqttService.scheduleResultTracked(key, readValue, publishContext);
                this.trackPublish(parentContext, ticket.completion);
                this.diagnostic.emit("info", "modbus.readback_observed", {
                    ...publishContext,
                    key,
                    readbackOutcome: readbackSucceeded ? "succeeded" : "unavailable_written_value_fallback",
                    publishOperationId: ticket.operationId,
                });
            } catch (publishError) {
                this.diagnostic.emit("error", "rpc.telemetry_schedule_failed", {
                    ...publishContext,
                    key,
                    writeSucceeded: true,
                    readbackSucceeded,
                    error: { message: (publishError as Error).message },
                });
            }
        }
    }

    /**
     * Handle parameter that only updates configuration (no Modbus mapping)
     */
    private async handleConfigOnlyParameter(key: string, rawValue: any, context?: OperationContext): Promise<void> {
        try {
            // Skip if value is falsy (empty string, null, undefined, 0, false)
            // Note: 0 and false are valid values, so only skip empty strings and null/undefined
            if (rawValue === "" || rawValue === null || rawValue === undefined) {
                this.logger.warn(`Skipping config write for ${key}: value is empty/null/undefined`);
                this.node.status({ fill: "yellow", shape: "ring", text: `Skipped: ${key} (empty value)` });
                return;
            }

            // Validate and convert value
            const value = this.validationService.validateAndConvertValue(key, rawValue);

            // Update configuration
            const currentConfig = this.configService.getConfigKeyValues();
            currentConfig[key] = value;
            this.configService.setConfigKeyValues(currentConfig);

            // Publish the validated value directly (not from config) to ensure correct type
            if (context) {
                const publishContext = createOperationContext(context, { parentOperationId: context.operationId });
                const outcome = await this.mqttService.publishConfigUpdateTracked(key, value, undefined, publishContext);
                this.trackPublish(context, Promise.resolve(outcome));
                if (outcome.status !== "acknowledged") {
                    this.diagnostic.emit(outcome.status === "failed" ? "error" : "warn", "rpc.config_delivery_outcome", {
                        ...publishContext,
                        key,
                        status: outcome.status,
                    });
                }
            } else {
                await this.mqttService.publishConfigUpdate(key, value);
            }

            this.node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.CONFIG_UPDATED(key) });
        } catch (error) {
            this.logger.error(`Failed to process config ${key}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Validate RPC message structure
     */
    validateRpcMessage(rpcBody: any): boolean {
        if (!rpcBody || typeof rpcBody !== 'object') {
            this.logger.warn("Invalid RPC body: not an object");
            return false;
        }

        if (!rpcBody.method) {
            this.logger.warn("Invalid RPC body: missing method");
            return false;
        }

        if (rpcBody.method === "set_state" && !rpcBody.params) {
            this.logger.warn("Invalid RPC body: set_state method requires params");
            return false;
        }

        if (rpcBody.method === "set_state_batch") {
            if (!rpcBody.params || !Array.isArray(rpcBody.params.commands)) {
                this.logger.warn("Invalid RPC body: set_state_batch method requires params.commands array");
                return false;
            }
        }

        return true;
    }

    /**
     * Process RPC request with validation
     */
    async processRpcRequest(rpcBody: any): Promise<void> {
        if (!this.validateRpcMessage(rpcBody)) {
            throw new Error("Invalid RPC message structure");
        }

        await this.handleRpcRequest(rpcBody, 3); // Use retry logic
    }

    /**
     * Publish result with retry logic
     */
    private async publishResultWithRetry(key: string, value: any, maxRetries: number = 3): Promise<void> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.mqttService.publishResult(key, value);
                return; // Success
            } catch (error) {
                this.logger.error(`Failed to publish result for ${key} (attempt ${attempt}/${maxRetries}): ${(error as Error).message}`);

                if (attempt < maxRetries) {
                    if (!this.mqttService.isConnected()) {
                        this.logger.warn("MQTT disconnected, waiting for reconnection...");
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                    }
                }
            }
        }

        this.logger.error(`Failed to publish result for ${key} after all retries`);
    }

    /**
     * Handle batch RPC requests
     */
    async handleBatchRpcRequests(rpcBodies: RpcMessage[]): Promise<void> {
        if (!Array.isArray(rpcBodies)) {
            throw new Error("Batch RPC requests must be an array");
        }

        this.logger.log(`Processing batch of ${rpcBodies.length} RPC requests`);

        const results: Array<{ success: boolean; error?: string }> = [];

        for (let i = 0; i < rpcBodies.length; i++) {
            try {
                await this.handleRpcRequest(rpcBodies[i]);
                results.push({ success: true });
                this.logger.debug(`Batch request ${i + 1}/${rpcBodies.length} completed successfully`);
            } catch (error) {
                const errorMessage = `Batch request ${i + 1}/${rpcBodies.length} failed: ${(error as Error).message}`;
                this.logger.error(errorMessage);
                results.push({ success: false, error: errorMessage });
            }
        }

        const successCount = results.filter(r => r.success).length;
        this.logger.log(`Batch processing completed: ${successCount}/${rpcBodies.length} successful`);

        if (successCount < rpcBodies.length) {
            const failedCount = rpcBodies.length - successCount;
            throw new Error(`Batch processing partially failed: ${failedCount} requests failed`);
        }
    }

    /**
     * Write to Modbus with connection error handling and retry logic
     */
    private async writeToModbusWithRetry(key: string, mapping: any, value: any, maxRetries: number = 2, context?: OperationContext): Promise<void> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (context) this.diagnostic.emit("info", "modbus.service_attempt", { ...context, operation: "write", attempt, maxAttempts: maxRetries });
                await this.modbusService.writeToModbus(key, mapping, value, context);
                return; // Success, exit retry loop
            } catch (error) {
                lastError = error as Error;
                const errorMessage = lastError.message;

                // Check if this is a connection-related error
                if (this.isConnectionError(errorMessage)) {
                    this.logger.error(`[RPC-HANDLER] Modbus connection lost: ${errorMessage}`);
                    this.diagnostic.emit("warn", "modbus.retry", { ...context, operation: "write", attempt, maxAttempts: maxRetries, error: { message: errorMessage } });

                    if (attempt < maxRetries) {
                        this.logger.warn(`[RPC-HANDLER] Attempting reconnection (${attempt}/${maxRetries})...`);

                        try {
                            // Pass boardId so the correct board client is reconnected in multi-board mode
                            await this.modbusService.checkConnection(mapping.boardId, context);
                            this.logger.warn(`[RPC-HANDLER] Reconnection successful, retrying operation...`);
                            // Continue to next iteration to retry the operation
                        } catch (reconnectError) {
                            this.logger.error(`[RPC-HANDLER] Reconnection attempt failed: ${(reconnectError as Error).message}`);
                            // Continue to next iteration anyway, maybe the connection will work
                        }

                        // Wait before retry
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                } else {
                    // Non-connection error, don't retry
                    throw lastError;
                }
            }
        }

        // All retries failed
        const finalError = `[RPC-HANDLER] Modbus connection error: ${lastError?.message}. Please check device connection and configuration.`;
        this.logger.error(finalError);
        throw new Error(finalError);
    }

    /**
     * Read from Modbus with connection error handling and retry logic
     */
    private async readFromModbusWithRetry(key: string, mapping: any, maxRetries: number = 2, context?: OperationContext): Promise<number | boolean> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (context) this.diagnostic.emit("info", "modbus.service_attempt", { ...context, operation: "read", attempt, maxAttempts: maxRetries });
                return await this.modbusService.readFromModbus(key, mapping, context);
            } catch (error) {
                lastError = error as Error;
                const errorMessage = lastError.message;

                // Check if this is a connection-related error
                if (this.isConnectionError(errorMessage)) {
                    this.logger.error(`[RPC-HANDLER] Modbus connection lost during read: ${errorMessage}`);
                    this.diagnostic.emit("warn", "modbus.retry", { ...context, operation: "read", attempt, maxAttempts: maxRetries, error: { message: errorMessage } });

                    if (attempt < maxRetries) {
                        this.logger.warn(`[RPC-HANDLER] Attempting reconnection for read (${attempt}/${maxRetries})...`);

                        try {
                            // Pass boardId so the correct board client is reconnected in multi-board mode
                            await this.modbusService.checkConnection(mapping.boardId, context);
                            this.logger.warn(`[RPC-HANDLER] Reconnection successful, retrying read operation...`);
                        } catch (reconnectError) {
                            this.logger.error(`[RPC-HANDLER] Reconnection attempt failed: ${(reconnectError as Error).message}`);
                        }

                        // Wait before retry
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                } else {
                    // Non-connection error, don't retry
                    throw lastError;
                }
            }
        }

        // All retries failed
        const finalError = `[RPC-HANDLER] Modbus read error: ${lastError?.message}. Please check device connection and configuration.`;
        this.logger.error(finalError);
        throw new Error(finalError);
    }

    /**
     * Check if an error is related to connection issues
     */
    private isConnectionError(errorMessage: string): boolean {
        const connectionErrorPatterns = [
            "Port Not Open",
            "Timed out",
            "ECONNREFUSED",
            "ETIMEDOUT",
            "ECONNRESET",
            "EPIPE",
            "EHOSTUNREACH",
            "ENETUNREACH",
            "socket hang up",
            "socket closed",
            "Connection lost",
            "timeout",
            "TIMEOUT"
        ];

        return connectionErrorPatterns.some(pattern =>
            errorMessage.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    /**
     * Get handler statistics
     */
    getStatistics(): {
        luoiHandlerAvailable: boolean;
        servicesInitialized: boolean;
    } {
        return {
            luoiHandlerAvailable: !!this.luoiHandler,
            servicesInitialized: !!(this.configService && this.validationService && this.modbusService && this.mqttService),
        };
    }
}

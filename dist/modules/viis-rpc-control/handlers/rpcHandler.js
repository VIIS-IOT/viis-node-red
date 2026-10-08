"use strict";
/**
 * RPC Handler for VIIS RPC Control Node
 * Handles RPC request processing and coordination between services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcHandler = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
const fertigation_start_sequence_1 = require("../../shared/fertigation-start-sequence");
const schedule_coil_classify_1 = require("../../viis-schedule-executor/schedule-coil-classify");
const schedule_valve_program_1 = require("../../viis-schedule-executor/schedule-valve-program");
const diagnostic_logger_1 = require("../../../core/observability/diagnostic-logger");
const trace_context_1 = require("../../../core/observability/trace-context");
const runtime_1 = require("../../../core/observability/runtime");
class RpcHandler {
    static getCommandPriority(key) {
        const lower = key.toLowerCase();
        if ((0, schedule_coil_classify_1.isNumberedValveKey)(key)) {
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
    constructor(options, configService, validationService, modbusService, mqttService, luoiHandler) {
        this.maxBatchSize = 100;
        this.RPC_REQUEST_TIMEOUT = 30000; // 30s overall timeout per RPC request
        this.requestQueue = Promise.resolve();
        this.queueLength = 0;
        this.activeCount = 0;
        this.underlyingPendingCount = 0;
        this.pendingLateOperationCount = 0;
        this.traceStates = new Map();
        this.protectionGate = null;
        this.waterHammerDelayMs = fertigation_start_sequence_1.WATER_HAMMER_DELAY_MS;
        this.defaultBatchOptions = {
            sequential: true,
            modbus_delay_ms: 150,
            timeout_per_cmd: 5000,
            rollback_on_fail: false,
            continue_on_error: false,
        };
        this.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.pendingTraceContexts = new Map();
        this.configService = configService;
        this.validationService = validationService;
        this.modbusService = modbusService;
        this.mqttService = mqttService;
        this.luoiHandler = luoiHandler;
        this.node = options.node;
        this.logger = new logger_1.Logger(options.node, "RPC-HANDLER");
        this.diagnostic = new diagnostic_logger_1.DiagnosticLogger(options.node, "rpc-handler");
        this.nodeInstanceId = (0, trace_context_1.createId)();
        if (typeof this.luoiHandler.setPublishTracker === "function") {
            this.luoiHandler.setPublishTracker((context, completion) => this.trackPublish(context, completion));
        }
    }
    getDiagnosticStatus() {
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
    setProtectionGate(gate) {
        this.protectionGate = gate;
    }
    setWaterHammerDelayMs(ms) {
        this.waterHammerDelayMs = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : fertigation_start_sequence_1.WATER_HAMMER_DELAY_MS;
    }
    /**
     * Handle incoming RPC request with retry logic
     */
    async handleRpcRequest(rpcBody, maxRetries = 3, suppliedContext) {
        var _a;
        const context = suppliedContext || (0, trace_context_1.createTraceContext)({
            runtimeBootId: runtime_1.runtimeBootId,
            nodeId: ((_a = this.node) === null || _a === void 0 ? void 0 : _a.id) || "unknown",
            nodeInstanceId: this.nodeInstanceId,
            ingress: "node_input",
            brokerRole: "none",
            payload: rpcBody,
        });
        const queuedAt = Date.now();
        this.queueLength++;
        this.logger.log(`[QUEUE] RPC request queued (queue: ${this.queueLength})`);
        this.diagnostic.emit("info", "rpc.queued", Object.assign(Object.assign({}, context), { method: rpcBody === null || rpcBody === void 0 ? void 0 : rpcBody.method, queuePosition: this.queueLength }));
        this.pendingTraceContexts.set(context.traceId, context);
        this.registerTrace(context.traceId);
        const execution = this.requestQueue.then(async () => {
            this.logger.log(`[QUEUE] RPC request dequeued, starting execution (remaining: ${this.queueLength - 1})`);
            const queueWaitMs = Date.now() - queuedAt;
            const startedAt = Date.now();
            this.lastRpcStartedAt = new Date(startedAt).toISOString();
            this.activeCount++;
            this.activePhase = "rpc_dispatch";
            this.diagnostic.emit("info", "rpc.started", Object.assign(Object.assign({}, context), { method: rpcBody === null || rpcBody === void 0 ? void 0 : rpcBody.method, queueWaitMs }));
            const underlying = this.handleRpcRequestInternal(rpcBody, maxRetries, context);
            this.underlyingPendingCount++;
            let timedOut = false;
            void underlying.then(outcome => {
                if (timedOut)
                    this.diagnostic.emit("warn", "rpc.late_settlement", Object.assign(Object.assign({}, context), { controlOutcome: outcome, elapsedMs: Date.now() - startedAt }));
            }, error => {
                if (timedOut)
                    this.diagnostic.emit("error", "rpc.late_settlement", Object.assign(Object.assign({}, context), { controlOutcome: "failed", error: { message: error.message }, elapsedMs: Date.now() - startedAt }));
            }).then(() => {
                this.underlyingPendingCount = Math.max(0, this.underlyingPendingCount - 1);
                this.markUnderlyingSettled(context.traceId);
            });
            try {
                const controlOutcome = await this.withTimeout(underlying, this.RPC_REQUEST_TIMEOUT, `RPC request timeout after ${this.RPC_REQUEST_TIMEOUT}ms`);
                return { controlOutcome, queueWaitMs, executionMs: Date.now() - startedAt };
            }
            catch (error) {
                timedOut = error.message.toLowerCase().includes("timeout");
                if (timedOut) {
                    this.activePhase = "rpc_timeout";
                    this.diagnostic.emit("error", "rpc.timeout", Object.assign(Object.assign({}, context), { queueWaitMs, executionMs: Date.now() - startedAt, underlyingOperationMayContinue: true }));
                }
                throw error;
            }
            finally {
                this.activeCount = Math.max(0, this.activeCount - 1);
                this.activePhase = undefined;
            }
        });
        this.requestQueue = execution.catch(() => { }).finally(() => {
            this.queueLength--;
        });
        let controlOutcome;
        try {
            const result = await execution;
            controlOutcome = result.controlOutcome;
            this.finishTrace(context, controlOutcome, result.queueWaitMs, result.executionMs);
        }
        catch (error) {
            controlOutcome = error.message.toLowerCase().includes("timeout") ? "timed_out" : "failed";
            this.finishTrace(context, controlOutcome, Date.now() - queuedAt, 0, { message: error.message });
            throw error;
        }
    }
    registerTrace(traceId) {
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
            const oldestTraceId = this.traceStates.keys().next().value;
            if (!oldestTraceId)
                break;
            this.traceStates.delete(oldestTraceId);
            this.pendingTraceContexts.delete(oldestTraceId);
            this.diagnostic.emit("warn", "rpc.trace_state_evicted", { traceId: oldestTraceId, reason: "capacity", maxTracked: 1024 });
        }
    }
    summarizeOutcomes(outcomes, pending = false) {
        if (pending)
            return "pending";
        if (outcomes.length === 0)
            return "not_applicable";
        if (outcomes.every(item => item.status === "acknowledged"))
            return "acknowledged";
        if (outcomes.some(item => item.status === "acknowledged"))
            return "partial";
        if (outcomes.some(item => item.status === "unknown"))
            return "unknown";
        if (outcomes.every(item => item.status === "superseded" || item.status === "cancelled"))
            return "superseded";
        return "failed";
    }
    finishTrace(context, controlOutcome, queueWaitMs, executionMs, error) {
        let state = this.traceStates.get(context.traceId);
        if (!state) {
            this.registerTrace(context.traceId);
            state = this.traceStates.get(context.traceId);
        }
        if (state.executionFinished)
            return;
        state.executionFinished = true;
        state.controlOutcome = controlOutcome;
        state.queueWaitMs = queueWaitMs;
        state.executionMs = executionMs;
        state.error = error;
        state.lateAfterTimeout = controlOutcome === "timed_out";
        this.lastExecutionFinishedAt = new Date().toISOString();
        this.diagnostic.emit(controlOutcome === "failed" || controlOutcome === "timed_out" ? "error" : "info", "rpc.execution_finished", Object.assign(Object.assign(Object.assign(Object.assign({}, context), { controlOutcome, deliveryOutcome: this.summarizeOutcomes(state.knownOutcomes, state.pendingTicketCount > 0 || state.lateAfterTimeout), publishCount: state.tickets.length, pendingPublishCount: state.pendingTicketCount, acknowledgedCount: state.knownOutcomes.filter(item => item.status === "acknowledged").length, failedCount: state.knownOutcomes.filter(item => item.status === "failed").length, unknownCount: state.knownOutcomes.filter(item => item.status === "unknown").length, queueWaitMs,
            executionMs }), (state.lateAfterTimeout ? { underlyingOperationMayContinue: true } : {})), (error ? { error } : {})));
        if (state.underlyingSettled)
            void this.finalizeDelivery(context, state);
    }
    markUnderlyingSettled(traceId) {
        const state = this.traceStates.get(traceId);
        if (!state)
            return;
        state.underlyingSettled = true;
        if (state.executionFinished && state.outstandingLateOperations === 0) {
            const context = this.pendingTraceContexts.get(traceId);
            if (context)
                void this.finalizeDelivery(context, state);
        }
    }
    async finalizeDelivery(context, state) {
        if (state.deliveryFinalizing || state.deliveryFinished || !state.underlyingSettled || state.outstandingLateOperations > 0)
            return;
        state.deliveryFinalizing = true;
        try {
            const outcomes = await Promise.all(state.tickets.map(ticket => ticket));
            state.deliveryFinished = true;
            this.diagnostic.emit("info", "rpc.delivery_finished", Object.assign(Object.assign(Object.assign({}, context), { controlOutcome: state.controlOutcome, deliveryOutcome: this.summarizeOutcomes(outcomes), publishCount: outcomes.length, acknowledgedCount: outcomes.filter(item => item.status === "acknowledged").length, failedCount: outcomes.filter(item => item.status === "failed").length, unknownCount: outcomes.filter(item => item.status === "unknown").length, lateAfterTimeout: state.lateAfterTimeout, queueWaitMs: state.queueWaitMs, executionMs: state.executionMs }), (state.error ? { error: state.error } : {})));
        }
        finally {
            this.traceStates.delete(context.traceId);
            this.pendingTraceContexts.delete(context.traceId);
        }
    }
    trackPublish(context, completion) {
        if (!context)
            return;
        const state = this.traceStates.get(context.traceId);
        if (!state)
            return;
        this.pendingTraceContexts.set(context.traceId, context);
        const safeCompletion = completion.then(outcome => outcome, () => ({ operationId: (0, trace_context_1.createId)(), status: "failed", acknowledgement: "none" }));
        const ticketIndex = state.tickets.length;
        state.pendingTicketCount++;
        state.tickets.push(safeCompletion);
        void safeCompletion.then(outcome => {
            state.knownOutcomes[ticketIndex] = outcome;
            state.pendingTicketCount = Math.max(0, state.pendingTicketCount - 1);
        });
    }
    trackLateOperation(context, operation, label) {
        if (!context)
            return;
        const state = this.traceStates.get(context.traceId);
        if (!state)
            return;
        state.outstandingLateOperations++;
        this.pendingLateOperationCount++;
        const traceContext = this.pendingTraceContexts.get(context.traceId) || context;
        let completed = false;
        const complete = () => {
            if (completed)
                return;
            completed = true;
            state.outstandingLateOperations = Math.max(0, state.outstandingLateOperations - 1);
            this.pendingLateOperationCount = Math.max(0, this.pendingLateOperationCount - 1);
            if (state.executionFinished && state.underlyingSettled && state.outstandingLateOperations === 0) {
                void this.finalizeDelivery(traceContext, state);
            }
        };
        void operation.then(outcome => {
            this.diagnostic.emit("warn", "rpc.late_settlement", Object.assign(Object.assign({}, context), { operationScope: label, lateOutcome: "resolved", controlOutcome: outcome, lateAfterTimeout: true }));
        }, error => {
            this.diagnostic.emit("error", "rpc.late_settlement", Object.assign(Object.assign({}, context), { operationScope: label, lateOutcome: "failed", error: { message: error.message }, lateAfterTimeout: true }));
        }).then(complete, complete);
    }
    operationContext(context, values = {}) {
        return (0, trace_context_1.createOperationContext)(context, values);
    }
    /**
     * Internal request processor executed in serialized queue
     */
    async handleRpcRequestInternal(rpcBody, maxRetries = 3, context) {
        let lastError = null;
        const startTime = Date.now();
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (rpcBody.method === "set_state" && rpcBody.params) {
                    this.logger.log(`Processing RPC request (attempt ${attempt}/${maxRetries}, keys=${Object.keys(rpcBody.params).length})`);
                    this.diagnostic.emit("debug", "rpc.attempt_started", Object.assign(Object.assign({}, context), { attempt, maxAttempts: maxRetries, method: rpcBody.method }));
                    const result = await this.handleSetStateRequest(rpcBody.params, context);
                    this.logger.log(`[RPC-DONE] Request completed in ${Date.now() - startTime}ms`);
                    this.diagnostic.emit("debug", "rpc.attempt_finished", Object.assign(Object.assign({}, context), { attempt, outcome: result }));
                    return result;
                }
                else if (rpcBody.method === "set_state_batch" && rpcBody.params) {
                    this.logger.log(`Processing batch RPC request (attempt ${attempt}/${maxRetries})`);
                    const result = await this.handleSetStateBatchRequest(rpcBody.params, context);
                    this.logger.log(`[RPC-DONE] Batch request completed in ${Date.now() - startTime}ms`);
                    return result;
                }
                else {
                    this.logger.warn(`Unsupported RPC method: ${rpcBody.method}`);
                    return "unsupported"; // No need to retry for unsupported methods
                }
            }
            catch (error) {
                lastError = error;
                this.logger.error(`[RPC-ERROR] Attempt ${attempt}/${maxRetries} failed after ${Date.now() - startTime}ms: ${lastError.message}`);
                // Check if error is retryable
                if (this.isRetryableError(lastError.message) && attempt < maxRetries) {
                    this.logger.warn(`RPC request failed (attempt ${attempt}/${maxRetries}), retrying: ${lastError.message}`);
                    this.diagnostic.emit("warn", "rpc.retry", Object.assign(Object.assign({}, context), { attempt, nextAttempt: attempt + 1, maxAttempts: maxRetries, error: { message: lastError.message } }));
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
    async handleSetStateBatchRequest(params, context) {
        const commands = Array.isArray(params.commands) ? params.commands : [];
        const options = Object.assign(Object.assign({}, this.defaultBatchOptions), (params.options || {}));
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
        this.diagnostic.emit("info", "rpc.batch_planned", Object.assign(Object.assign({}, context), { batchId: String(batchId), plannedCount: commands.length, executableCount: commands.filter((cmd) => (cmd === null || cmd === void 0 ? void 0 : cmd.kind) !== "delay").length, sequential: true }));
        const holdings = this.modbusService.getModbusHoldingRegisters() || {};
        const coils = this.modbusService.getModbusCoils() || {};
        const commandKeys = commands.map((cmd) => String((cmd === null || cmd === void 0 ? void 0 : cmd.key) || ""));
        const sortedCommands = (0, fertigation_start_sequence_1.isFertigationBatch)(commandKeys)
            ? this.buildFertigationBatchCommands(commands, holdings, coils)
            : [...commands].sort((a, b) => {
                const aOrder = typeof (a === null || a === void 0 ? void 0 : a.order) === "number" ? a.order : Number.MAX_SAFE_INTEGER;
                const bOrder = typeof (b === null || b === void 0 ? void 0 : b.order) === "number" ? b.order : Number.MAX_SAFE_INTEGER;
                const aPriority = RpcHandler.getCommandPriority(String((a === null || a === void 0 ? void 0 : a.key) || ""));
                const bPriority = RpcHandler.getCommandPriority(String((b === null || b === void 0 ? void 0 : b.key) || ""));
                const priorityDiff = aPriority - bPriority;
                return priorityDiff !== 0 ? priorityDiff : aOrder - bOrder;
            });
        const results = [];
        const successfulCommands = [];
        for (let i = 0; i < sortedCommands.length; i++) {
            const cmd = sortedCommands[i] || {};
            if (cmd.kind === "delay") {
                this.diagnostic.emit("info", "rpc.delay_started", Object.assign(Object.assign({}, context), { batchId, executionIndex: i, delayMs: Number(cmd.ms) || 0 }));
                await this.sleep(Number(cmd.ms) || 0);
                this.diagnostic.emit("info", "rpc.delay_finished", Object.assign(Object.assign({}, context), { batchId, executionIndex: i }));
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
            const commandContext = context ? (0, trace_context_1.createOperationContext)(context, {
                commandIndex: order,
                executionIndex: i,
                batchId: String(batchId),
            }) : undefined;
            const commandTimeoutMs = Number(options.timeout_per_cmd) || this.defaultBatchOptions.timeout_per_cmd;
            let commandOperation;
            let commandSettled = false;
            try {
                this.diagnostic.emit("info", "rpc.batch_command_started", Object.assign(Object.assign({}, commandContext), { key, executionIndex: i, plannedCount: sortedCommands.length }));
                commandOperation = this.handleSetStateRequest({ [key]: cmd.value }, commandContext);
                void commandOperation.then(() => { commandSettled = true; }, () => { commandSettled = true; });
                await this.withTimeout(commandOperation, commandTimeoutMs, `Command timeout for ${key}`);
                successfulCommands.push({ key, value: cmd.value, order });
                results.push({
                    order,
                    key,
                    status: "success",
                    timestamp: new Date().toISOString(),
                });
                this.diagnostic.emit("info", "rpc.batch_command_finished", Object.assign(Object.assign({}, commandContext), { key, outcome: "success" }));
            }
            catch (error) {
                const errorMessage = error.message;
                const timedOut = errorMessage.toLowerCase().includes("timeout") && !commandSettled;
                if (timedOut && commandOperation) {
                    this.trackLateOperation(commandContext, commandOperation, "batch_command");
                    this.diagnostic.emit("error", "rpc.batch_command_timeout", Object.assign(Object.assign({}, commandContext), { key, timeoutMs: commandTimeoutMs, underlyingOperationMayContinue: true }));
                }
                results.push({
                    order,
                    key,
                    status: "failed",
                    error: errorMessage,
                    timestamp: new Date().toISOString(),
                });
                this.logger.error(`Batch command failed [${batchId}] ${key}: ${errorMessage}`);
                this.diagnostic.emit("error", "rpc.batch_command_finished", Object.assign(Object.assign({}, commandContext), { batchId: String(batchId), commandIndex: order, executionIndex: i, key, outcome: "failed", underlyingOperationMayContinue: timedOut, error: { message: errorMessage } }));
                if (options.rollback_on_fail && successfulCommands.length > 0) {
                    await this.rollbackBatch(successfulCommands, batchId, context);
                }
                if (options.sequential && !options.continue_on_error) {
                    break;
                }
            }
            if (i < sortedCommands.length - 1) {
                const next = sortedCommands[i + 1];
                if ((next === null || next === void 0 ? void 0 : next.kind) === "delay") {
                    continue;
                }
                const delayMs = (0, fertigation_start_sequence_1.isFertigationBatch)(commandKeys)
                    ? constants_1.FERTIGATION_KEY_DELAY_MS
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
        const writeCount = sortedCommands.filter((cmd) => (cmd === null || cmd === void 0 ? void 0 : cmd.kind) !== "delay").length;
        const unexecutedCount = Math.max(0, writeCount - results.length);
        const batchResultContext = context ? (0, trace_context_1.createOperationContext)(context, { batchId: String(batchId) }) : undefined;
        const batchResultOutcome = batchResultContext ? await this.mqttService.publishConfigUpdateTracked("rpc_batch_result", {
            batch_id: batchId,
            status: overallStatus,
            total: writeCount,
            success_count: successCount,
            failed_count: results.length - successCount,
            results,
            completed_at: new Date().toISOString(),
        }, "set_state_batch completed", batchResultContext) : undefined;
        if (batchResultContext && batchResultOutcome)
            this.trackPublish(context, Promise.resolve(batchResultOutcome));
        this.node.status({ fill: overallStatus === "success" ? "green" : "yellow", shape: "dot", text: `batch ${overallStatus}` });
        this.logger.log(`Batch ${batchId} completed: ${overallStatus} (${successCount}/${writeCount})`);
        this.diagnostic.emit(overallStatus === "success" ? "info" : "warn", "rpc.batch_finished", Object.assign(Object.assign({}, context), { batchId: String(batchId), status: overallStatus, total: writeCount, executedCount: results.length, successCount, failedCount: results.length - successCount, unexecutedCount, resultPublishStatus: batchResultOutcome === null || batchResultOutcome === void 0 ? void 0 : batchResultOutcome.status }));
        return overallStatus;
    }
    buildFertigationBatchCommands(commands, holdings, coils) {
        const ops = (0, fertigation_start_sequence_1.planFertigationStartWrites)({
            commands: commands.map((cmd) => ({ key: String((cmd === null || cmd === void 0 ? void 0 : cmd.key) || ""), value: cmd === null || cmd === void 0 ? void 0 : cmd.value })),
            holdings,
            coils,
        }, { waterHammerDelayMs: this.waterHammerDelayMs });
        const plannedKeys = new Set(ops
            .filter((op) => op.kind === "write")
            .map((op) => op.key));
        const sequenced = [];
        for (const op of ops) {
            if (op.kind === "delay") {
                sequenced.push({ kind: "delay", ms: op.ms });
                continue;
            }
            sequenced.push({ key: op.key, value: op.value, order: sequenced.length });
        }
        for (const cmd of commands) {
            const key = String((cmd === null || cmd === void 0 ? void 0 : cmd.key) || "");
            if (!key || plannedKeys.has(key))
                continue;
            if (Object.prototype.hasOwnProperty.call(coils, key) && !(0, schedule_valve_program_1.isValveOn)(cmd.value))
                continue;
            sequenced.push({ key, value: cmd.value, order: sequenced.length });
        }
        return sequenced;
    }
    /**
     * Best-effort rollback for commands that were already applied.
     * Supports boolean and binary numeric commands only.
     */
    async rollbackBatch(successfulCommands, batchId, context) {
        this.logger.warn(`Starting rollback for batch ${batchId} (${successfulCommands.length} commands)`);
        for (const cmd of [...successfulCommands].reverse()) {
            const rollbackValue = this.getRollbackValue(cmd.value);
            if (rollbackValue === null) {
                this.logger.warn(`Skipping rollback for ${cmd.key}: unsupported value ${JSON.stringify(cmd.value)}`);
                continue;
            }
            try {
                const rollbackContext = context ? (0, trace_context_1.createOperationContext)(context, {
                    parentOperationId: context.traceId,
                    batchId,
                    commandIndex: cmd.order,
                }) : undefined;
                this.diagnostic.emit("warn", "rpc.rollback_started", Object.assign(Object.assign({}, rollbackContext), { key: cmd.key }));
                await this.handleSetStateRequest({ [cmd.key]: rollbackValue }, rollbackContext);
                this.diagnostic.emit("info", "rpc.rollback_finished", Object.assign(Object.assign({}, rollbackContext), { key: cmd.key, outcome: "success" }));
            }
            catch (error) {
                this.logger.error(`Rollback failed for ${cmd.key}: ${error.message}`);
                this.diagnostic.emit("error", "rpc.rollback_finished", Object.assign(Object.assign({}, context), { batchId, commandIndex: cmd.order, key: cmd.key, outcome: "failed", error: { message: error.message } }));
            }
        }
    }
    getRollbackValue(value) {
        if (value === true)
            return false;
        if (value === false)
            return true;
        if (value === 1)
            return 0;
        if (value === 0)
            return 1;
        if (value === "1")
            return "0";
        if (value === "0")
            return "1";
        if (value === "true")
            return "false";
        if (value === "false")
            return "true";
        return null;
    }
    async withTimeout(promise, timeoutMs, timeoutMessage) {
        let timer;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
                }),
            ]);
        }
        finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
    /**
     * Check if an error is retryable
     */
    isRetryableError(errorMessage) {
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
        return retryablePatterns.some(pattern => errorMessage.toLowerCase().includes(pattern.toLowerCase()));
    }
    /**
     * Handle RPC error with proper logging and status updates
     */
    async handleRpcError(error, context) {
        try {
            const err = error;
            let errorMessage = constants_1.ERROR_MESSAGES.RPC_HANDLING_ERROR + `: ${err.message}`;
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
                }
                catch (reconnectError) {
                    this.logger.error(`Reconnection attempt failed: ${reconnectError.message}`);
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
                const publishContext = (0, trace_context_1.createOperationContext)(context, { parentOperationId: context.traceId });
                const outcome = await this.mqttService.publishErrorTracked(errorMessage, publishContext);
                this.trackPublish(context, Promise.resolve(outcome));
            }
            else {
                await this.mqttService.publishError(errorMessage);
            }
        }
        catch (publishError) {
            this.logger.error(`Failed to handle RPC error: ${publishError.message}`);
        }
    }
    /**
     * Publish error with retry logic
     */
    async publishErrorWithRetry(errorMessage, context) {
        if (!context) {
            await this.mqttService.publishError(errorMessage);
            return;
        }
        const publishContext = (0, trace_context_1.createOperationContext)(context, { parentOperationId: context.traceId });
        const outcome = await this.mqttService.publishErrorTracked(errorMessage, publishContext);
        this.trackPublish(context, Promise.resolve(outcome));
    }
    /**
     * Handle set_state RPC request
     */
    async handleSetStateRequest(params, context) {
        try {
            // Filter out parameters with "undefined" values
            const filteredParams = this.filterUndefinedParams(params);
            if (Object.keys(filteredParams).length === 0) {
                this.logger.warn("All parameters were filtered out due to undefined values");
                this.node.status({ fill: "yellow", shape: "ring", text: "No valid parameters" });
                this.diagnostic.emit("warn", "rpc.no_valid_parameters", Object.assign(Object.assign({}, context), { suppliedCount: Object.keys(params || {}).length }));
                return "no_op";
            }
            this.logger.log(`[SET-STATE] Processing ${Object.keys(filteredParams).length} parameters`);
            // Try luoi mapping handler first - it now handles actual Modbus writes
            const hasLuoiMapping = await this.luoiHandler.processRpcBody(filteredParams, context);
            // Create a copy of filteredParams without luoi parameters for standard processing
            const standardParams = Object.assign({}, filteredParams);
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
        }
        catch (error) {
            this.logger.error(`Error in handleSetStateRequest: ${error.message}`);
            throw error;
        }
    }
    /**
     * Filter out parameters with "undefined" values (string or actual undefined)
     */
    filterUndefinedParams(params) {
        const filteredParams = {};
        const filteredKeys = [];
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
    async handleStandardParams(params, context) {
        // Get modbus mappings from global variables
        const modbusHoldingRegisters = this.modbusService.getModbusHoldingRegisters() || {};
        const modbusCoils = this.modbusService.getModbusCoils() || {};
        // Separate parameters into holding registers, coils, and config-only
        const holdingParams = [];
        const coilParams = [];
        const configParams = [];
        for (const [key, rawValue] of Object.entries(params)) {
            if (modbusHoldingRegisters.hasOwnProperty(key)) {
                holdingParams.push([key, rawValue]);
            }
            else if (modbusCoils.hasOwnProperty(key)) {
                coilParams.push([key, rawValue]);
            }
            else {
                configParams.push([key, rawValue]);
            }
        }
        this.logger.log(`Processing parameters - Holding: ${holdingParams.length}, Coils: ${coilParams.length}, Config: ${configParams.length}`);
        // Process in order: holding registers first, then coils, then config-only
        let executionIndex = 0;
        for (const [key, rawValue] of holdingParams) {
            await this.processParameter(key, rawValue, context ? (0, trace_context_1.createOperationContext)(context, { executionIndex: executionIndex++ }) : undefined);
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
            await this.processParameter(key, rawValue, context ? (0, trace_context_1.createOperationContext)(context, { executionIndex: executionIndex++ }) : undefined);
            // Small delay between each coil write to ensure proper sequencing
            if (coilParams.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        for (const [key, rawValue] of configParams) {
            await this.processParameter(key, rawValue, context ? (0, trace_context_1.createOperationContext)(context, { executionIndex: executionIndex++ }) : undefined);
        }
    }
    /**
     * Process a single parameter
     */
    async processParameter(key, rawValue, context) {
        const mapping = this.modbusService.findModbusMapping(key);
        this.diagnostic.emit("info", "rpc.key_classified", Object.assign(Object.assign(Object.assign(Object.assign({}, context), { key, classification: mapping ? "modbus_mapped" : "config_only" }), (mapping ? { boardId: mapping.boardId, functionCode: mapping.fc, address: mapping.address } : {})), { valueType: typeof rawValue }));
        if (mapping) {
            await this.handleModbusMappedParameter(key, rawValue, mapping, context);
        }
        else {
            await this.handleConfigOnlyParameter(key, rawValue, context);
        }
    }
    /**
     * Handle parameter that has Modbus mapping
     */
    async handleModbusMappedParameter(key, rawValue, mapping, parentContext) {
        // Validate and convert value
        const value = this.validationService.validateAndConvertValue(key, rawValue);
        const writeContext = parentContext ? (0, trace_context_1.createOperationContext)(parentContext, {
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
                this.diagnostic.emit("warn", "rpc.protection_blocked", Object.assign(Object.assign({}, writeContext), { key, requestedValue: typeof value === "number" || typeof value === "boolean" ? value : undefined, reason: gate.reason, action: gate.action }));
                try {
                    const publishContext = writeContext ? (0, trace_context_1.createOperationContext)(writeContext, { parentOperationId: writeContext.operationId }) : undefined;
                    const outcome = publishContext ? await this.mqttService.publishConfigUpdateTracked(`_blocked_${key}`, {
                        requested: value,
                        reason: gate.reason,
                        source: 'rpc',
                        action: gate.action,
                    }, undefined, publishContext) : undefined;
                    if (publishContext && outcome)
                        this.trackPublish(parentContext, Promise.resolve(outcome));
                }
                catch (pubErr) {
                    this.logger.warn(`Failed to publish blocked telemetry: ${pubErr.message}`);
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
        }
        catch (error) {
            this.logger.error(`[MODBUS-WRITE] Failed to write ${key}: ${error.message}`);
            throw error; // Propagate: write failed, retry is safe
        }
        // Read-back to confirm.
        // CRITICAL: handled in its own try-catch so that a read failure after a SUCCESSFUL write
        // does NOT propagate a retryable error back to handleRpcRequest. If it did, the outer
        // retry loop would execute the write AGAIN — causing double-writes on relays/coils.
        let readValue;
        let readbackSucceeded = false;
        let readContext;
        try {
            readContext = writeContext ? (0, trace_context_1.createOperationContext)(writeContext, { parentOperationId: writeContext.operationId }) : undefined;
            readValue = await this.readFromModbusWithRetry(key, mapping, 2, readContext);
            readbackSucceeded = true;
        }
        catch (readError) {
            // Write succeeded but read-back failed. Publish the written value as fallback and
            // return without throwing — the outer retry must NOT re-write.
            this.logger.warn(`[RPC-HANDLER] Write succeeded but read-back failed for ${key}: ${readError.message}. Publishing written value as fallback.`);
            this.diagnostic.emit("warn", "modbus.readback_unavailable", Object.assign(Object.assign({}, readContext), { key, boardId: mapping.boardId, functionCode: mapping.fc, address: mapping.address, error: { message: readError.message }, writeSucceeded: true }));
            readValue = value;
        }
        // These are post-write bookkeeping operations. Their failure must not escape to the
        // outer RPC retry loop, which would repeat a write that already succeeded.
        try {
            if (readbackSucceeded)
                this.modbusService.updateGlobalContextCacheAfterVerification(key, readValue, mapping.fc);
            if (mapping.fc === 5 && this.protectionGate)
                this.protectionGate.updateState(key, Boolean(readValue));
            this.node.status(readbackSucceeded
                ? { fill: "green", shape: "dot", text: `${key}=${readValue}` }
                : { fill: "yellow", shape: "ring", text: `${key} written (no readback)` });
        }
        catch (postWriteError) {
            this.diagnostic.emit("error", "rpc.post_write_processing_failed", Object.assign(Object.assign({}, writeContext), { key, writeSucceeded: true, readbackSucceeded, error: { message: postWriteError.message } }));
        }
        const publishContext = parentContext ? (0, trace_context_1.createOperationContext)(parentContext, {
            parentOperationId: (readbackSucceeded ? readContext === null || readContext === void 0 ? void 0 : readContext.operationId : writeContext === null || writeContext === void 0 ? void 0 : writeContext.operationId),
            boardId: mapping.boardId,
            functionCode: mapping.fc,
            address: mapping.address,
        }) : undefined;
        if (publishContext) {
            try {
                const ticket = this.mqttService.scheduleResultTracked(key, readValue, publishContext);
                this.trackPublish(parentContext, ticket.completion);
                this.diagnostic.emit("info", "modbus.readback_observed", Object.assign(Object.assign({}, publishContext), { key, readbackOutcome: readbackSucceeded ? "succeeded" : "unavailable_written_value_fallback", publishOperationId: ticket.operationId }));
            }
            catch (publishError) {
                this.diagnostic.emit("error", "rpc.telemetry_schedule_failed", Object.assign(Object.assign({}, publishContext), { key, writeSucceeded: true, readbackSucceeded, error: { message: publishError.message } }));
            }
        }
    }
    /**
     * Handle parameter that only updates configuration (no Modbus mapping)
     */
    async handleConfigOnlyParameter(key, rawValue, context) {
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
                const publishContext = (0, trace_context_1.createOperationContext)(context, { parentOperationId: context.operationId });
                const outcome = await this.mqttService.publishConfigUpdateTracked(key, value, undefined, publishContext);
                this.trackPublish(context, Promise.resolve(outcome));
                if (outcome.status !== "acknowledged") {
                    this.diagnostic.emit(outcome.status === "failed" ? "error" : "warn", "rpc.config_delivery_outcome", Object.assign(Object.assign({}, publishContext), { key, status: outcome.status }));
                }
            }
            else {
                await this.mqttService.publishConfigUpdate(key, value);
            }
            this.node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.CONFIG_UPDATED(key) });
        }
        catch (error) {
            this.logger.error(`Failed to process config ${key}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Validate RPC message structure
     */
    validateRpcMessage(rpcBody) {
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
    async processRpcRequest(rpcBody) {
        if (!this.validateRpcMessage(rpcBody)) {
            throw new Error("Invalid RPC message structure");
        }
        await this.handleRpcRequest(rpcBody, 3); // Use retry logic
    }
    /**
     * Publish result with retry logic
     */
    async publishResultWithRetry(key, value, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.mqttService.publishResult(key, value);
                return; // Success
            }
            catch (error) {
                this.logger.error(`Failed to publish result for ${key} (attempt ${attempt}/${maxRetries}): ${error.message}`);
                if (attempt < maxRetries) {
                    if (!this.mqttService.isConnected()) {
                        this.logger.warn("MQTT disconnected, waiting for reconnection...");
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    else {
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
    async handleBatchRpcRequests(rpcBodies) {
        if (!Array.isArray(rpcBodies)) {
            throw new Error("Batch RPC requests must be an array");
        }
        this.logger.log(`Processing batch of ${rpcBodies.length} RPC requests`);
        const results = [];
        for (let i = 0; i < rpcBodies.length; i++) {
            try {
                await this.handleRpcRequest(rpcBodies[i]);
                results.push({ success: true });
                this.logger.debug(`Batch request ${i + 1}/${rpcBodies.length} completed successfully`);
            }
            catch (error) {
                const errorMessage = `Batch request ${i + 1}/${rpcBodies.length} failed: ${error.message}`;
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
    async writeToModbusWithRetry(key, mapping, value, maxRetries = 2, context) {
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (context)
                    this.diagnostic.emit("info", "modbus.service_attempt", Object.assign(Object.assign({}, context), { operation: "write", attempt, maxAttempts: maxRetries }));
                await this.modbusService.writeToModbus(key, mapping, value, context);
                return; // Success, exit retry loop
            }
            catch (error) {
                lastError = error;
                const errorMessage = lastError.message;
                // Check if this is a connection-related error
                if (this.isConnectionError(errorMessage)) {
                    this.logger.error(`[RPC-HANDLER] Modbus connection lost: ${errorMessage}`);
                    this.diagnostic.emit("warn", "modbus.retry", Object.assign(Object.assign({}, context), { operation: "write", attempt, maxAttempts: maxRetries, error: { message: errorMessage } }));
                    if (attempt < maxRetries) {
                        this.logger.warn(`[RPC-HANDLER] Attempting reconnection (${attempt}/${maxRetries})...`);
                        try {
                            // Pass boardId so the correct board client is reconnected in multi-board mode
                            await this.modbusService.checkConnection(mapping.boardId, context);
                            this.logger.warn(`[RPC-HANDLER] Reconnection successful, retrying operation...`);
                            // Continue to next iteration to retry the operation
                        }
                        catch (reconnectError) {
                            this.logger.error(`[RPC-HANDLER] Reconnection attempt failed: ${reconnectError.message}`);
                            // Continue to next iteration anyway, maybe the connection will work
                        }
                        // Wait before retry
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                }
                else {
                    // Non-connection error, don't retry
                    throw lastError;
                }
            }
        }
        // All retries failed
        const finalError = `[RPC-HANDLER] Modbus connection error: ${lastError === null || lastError === void 0 ? void 0 : lastError.message}. Please check device connection and configuration.`;
        this.logger.error(finalError);
        throw new Error(finalError);
    }
    /**
     * Read from Modbus with connection error handling and retry logic
     */
    async readFromModbusWithRetry(key, mapping, maxRetries = 2, context) {
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (context)
                    this.diagnostic.emit("info", "modbus.service_attempt", Object.assign(Object.assign({}, context), { operation: "read", attempt, maxAttempts: maxRetries }));
                return await this.modbusService.readFromModbus(key, mapping, context);
            }
            catch (error) {
                lastError = error;
                const errorMessage = lastError.message;
                // Check if this is a connection-related error
                if (this.isConnectionError(errorMessage)) {
                    this.logger.error(`[RPC-HANDLER] Modbus connection lost during read: ${errorMessage}`);
                    this.diagnostic.emit("warn", "modbus.retry", Object.assign(Object.assign({}, context), { operation: "read", attempt, maxAttempts: maxRetries, error: { message: errorMessage } }));
                    if (attempt < maxRetries) {
                        this.logger.warn(`[RPC-HANDLER] Attempting reconnection for read (${attempt}/${maxRetries})...`);
                        try {
                            // Pass boardId so the correct board client is reconnected in multi-board mode
                            await this.modbusService.checkConnection(mapping.boardId, context);
                            this.logger.warn(`[RPC-HANDLER] Reconnection successful, retrying read operation...`);
                        }
                        catch (reconnectError) {
                            this.logger.error(`[RPC-HANDLER] Reconnection attempt failed: ${reconnectError.message}`);
                        }
                        // Wait before retry
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                }
                else {
                    // Non-connection error, don't retry
                    throw lastError;
                }
            }
        }
        // All retries failed
        const finalError = `[RPC-HANDLER] Modbus read error: ${lastError === null || lastError === void 0 ? void 0 : lastError.message}. Please check device connection and configuration.`;
        this.logger.error(finalError);
        throw new Error(finalError);
    }
    /**
     * Check if an error is related to connection issues
     */
    isConnectionError(errorMessage) {
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
        return connectionErrorPatterns.some(pattern => errorMessage.toLowerCase().includes(pattern.toLowerCase()));
    }
    /**
     * Get handler statistics
     */
    getStatistics() {
        return {
            luoiHandlerAvailable: !!this.luoiHandler,
            servicesInitialized: !!(this.configService && this.validationService && this.modbusService && this.mqttService),
        };
    }
}
exports.RpcHandler = RpcHandler;
RpcHandler.COMMAND_PRIORITY = {
    valve: 0,
    pump: 1,
    power: 2,
};

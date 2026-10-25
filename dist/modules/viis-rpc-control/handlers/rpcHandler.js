"use strict";
/**
 * RPC Handler for VIIS RPC Control Node
 * Handles RPC request processing and coordination between services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcHandler = exports.RELEASE_CLAIMS_METHOD = void 0;
exports.rpcClaimSource = rpcClaimSource;
const constants_1 = require("../constants");
const rpc_deadline_1 = require("../utils/rpc-deadline");
const logger_1 = require("../utils/logger");
const protection_gate_service_1 = require("../../viis-device-protection/services/protection-gate-service");
const fertigation_start_sequence_1 = require("../../shared/fertigation-start-sequence");
const schedule_coil_classify_1 = require("../../viis-schedule-executor/schedule-coil-classify");
const schedule_valve_program_1 = require("../../viis-schedule-executor/schedule-valve-program");
const demeter_mqtt_topics_1 = require("../../../core/demeter-mqtt-topics");
const arbiter_registry_1 = require("../../viis-actuator-arbiter/arbiter-registry");
/**
 * RPC method that drops arbiter claims: `params: { keys?: string[], source?: 'manual' | 'alarm_action' }`.
 * `source` defaults to `manual`; `alarm_action` is how the backend ends the OFF a cleared alarm held.
 * Handled only while an arbiter runs.
 */
exports.RELEASE_CLAIMS_METHOD = "release_claims";
/**
 * RPC envelope `source` → arbiter claim source. Portal/mobile/MCP send none (a person: `manual`);
 * the backend tags ONLINE scenarios and alarm actions. A remote caller never claims as `safety`.
 */
function rpcClaimSource(raw) {
    return raw === "scenario" || raw === "alarm_action" ? raw : "manual";
}
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
        this.requestQueue = Promise.resolve();
        this.queueLength = 0;
        this.protectionGate = null;
        this.waterHammerDelayMs = fertigation_start_sequence_1.WATER_HAMMER_DELAY_MS;
        /** Last terminal response per command_id, re-sent when the same command is redelivered. */
        this.ackCache = new Map();
        this.defaultBatchOptions = {
            sequential: true,
            modbus_delay_ms: 150,
            timeout_per_cmd: 5000,
            rollback_on_fail: false,
            continue_on_error: false,
        };
        this.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.configService = configService;
        this.validationService = validationService;
        this.modbusService = modbusService;
        this.mqttService = mqttService;
        this.luoiHandler = luoiHandler;
        this.node = options.node;
        this.logger = new logger_1.Logger(options.node, "RPC-HANDLER");
    }
    /**
     * Set protection gate service for coil write protection
     */
    setProtectionGate(gate) {
        this.protectionGate = gate;
    }
    resolveGate() {
        var _a, _b, _c, _d, _e;
        const fromGlobal = (_e = (_d = (_c = (_b = (_a = this.node) === null || _a === void 0 ? void 0 : _a.context) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.global) === null || _d === void 0 ? void 0 : _d.get) === null || _e === void 0 ? void 0 : _e.call(_d, 'protectionGateService');
        return (0, protection_gate_service_1.resolveProtectionGate)(fromGlobal) || (0, protection_gate_service_1.resolveProtectionGate)(this.protectionGate);
    }
    setWaterHammerDelayMs(ms) {
        this.waterHammerDelayMs = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : fertigation_start_sequence_1.WATER_HAMMER_DELAY_MS;
    }
    /**
     * Handle incoming RPC request with retry logic
     */
    async handleRpcRequest(rpcBody, maxRetries = 3) {
        // Mobile `set` / `control` become `set_state` before anything answers: the deadline watchdog and the
        // queue-drop path reply with this body, and publishRpcAck only answers set_state / set_state_batch.
        rpcBody = this.normalizeRpcBody(rpcBody);
        // The deadline starts when the command is received, not when it is dequeued:
        // time spent waiting behind other requests counts against it.
        const ctx = (0, rpc_deadline_1.createRpcDeadline)((0, demeter_mqtt_topics_1.extractRpcCommandId)(rpcBody), this.resolveRequestTtl(rpcBody));
        this.queueLength++;
        this.logger.log(`[QUEUE] RPC request queued (queue: ${this.queueLength}, ttl: ${ctx.ttlMs}ms)`);
        const execution = this.requestQueue.then(async () => {
            if ((0, rpc_deadline_1.isRpcExpired)(ctx)) {
                this.logger.warn(`[RPC-EXPIRED] Dropped before execution: waited ${Date.now() - ctx.receivedAt}ms in RPC queue (ttl ${ctx.ttlMs}ms)`);
                return;
            }
            this.logger.log(`[QUEUE] RPC request dequeued, starting execution (remaining: ${this.queueLength - 1})`);
            await (0, rpc_deadline_1.runWithRpcDeadline)(ctx, () => this.handleRpcRequestInternal(rpcBody, maxRetries));
        });
        // Never rejects: errors are reported via ACK/status, so no unhandled rejection.
        const settled = execution.catch((error) => {
            this.logger.error(`[RPC-ERROR] Unexpected failure: ${error.message}`);
        });
        // Keep requests serialized, but do not let one stuck request block the queue forever.
        let releaseTimer;
        const forcedRelease = new Promise((resolve) => {
            releaseTimer = setTimeout(() => {
                this.logger.warn(`[QUEUE] Request still running ${constants_1.RPC_DEADLINE_CONFIG.QUEUE_RELEASE_GRACE_MS}ms after its deadline; releasing RPC queue (its writes stay cancelled)`);
                resolve();
            }, Math.max(0, ctx.deadline - Date.now()) + constants_1.RPC_DEADLINE_CONFIG.QUEUE_RELEASE_GRACE_MS);
        });
        this.requestQueue = Promise.race([settled, forcedRelease]).then(() => {
            if (releaseTimer)
                clearTimeout(releaseTimer);
            this.queueLength--;
        });
        // Answer by the deadline even if the device never responds.
        let deadlineTimer;
        const deadlineReached = new Promise((resolve) => {
            deadlineTimer = setTimeout(() => resolve("expired"), Math.max(0, ctx.deadline - Date.now()));
        });
        const outcome = await Promise.race([settled.then(() => "done"), deadlineReached]);
        if (deadlineTimer)
            clearTimeout(deadlineTimer);
        if (outcome === "expired" || ctx.expired) {
            ctx.expired = true;
            if (!ctx.responded) {
                const message = `RPC expired: not completed within ${ctx.ttlMs}ms (device not responding); remaining Modbus writes cancelled`;
                this.logger.warn(`[RPC-EXPIRED] ${ctx.commandId ? `command ${ctx.commandId}: ` : ""}${message}`);
                this.node.status({ fill: "yellow", shape: "ring", text: "RPC expired" });
                await this.publishRpcAck(rpcBody, { success: false, error: message }, ctx);
            }
        }
    }
    /**
     * TTL for one RPC request: rpcBody.timeout (ms, minus a margin so the answer
     * reaches the client before it gives up) or the per-method default.
     */
    resolveRequestTtl(rpcBody) {
        const cfg = constants_1.RPC_DEADLINE_CONFIG;
        const clientTimeout = Number(rpcBody === null || rpcBody === void 0 ? void 0 : rpcBody.timeout);
        const ttl = Number.isFinite(clientTimeout) && clientTimeout > 0
            ? clientTimeout - cfg.CLIENT_TIMEOUT_MARGIN_MS
            : String((rpcBody === null || rpcBody === void 0 ? void 0 : rpcBody.method) || "") === "set_state_batch"
                ? cfg.BATCH_TTL_MS
                : cfg.SET_STATE_TTL_MS;
        return Math.min(cfg.MAX_TTL_MS, Math.max(cfg.MIN_TTL_MS, ttl));
    }
    /**
     * Internal request processor executed in serialized queue
     */
    async publishRpcAck(rpcBody, result, ctx = (0, rpc_deadline_1.currentRpcDeadline)()) {
        if (!(0, demeter_mqtt_topics_1.isHandledRpcControlMethod)(rpcBody.method) && !this.isArbiterReleaseRequest(rpcBody)) {
            return;
        }
        if (ctx) {
            // Exactly one terminal response per request (the deadline watchdog may have answered)
            if (ctx.responded) {
                this.logger.warn(`[RPC-LATE] Request finished after its deadline (success=${result.success}); FAILED was already reported`);
                return;
            }
            ctx.responded = true;
        }
        const commandId = (0, demeter_mqtt_topics_1.extractRpcCommandId)(rpcBody);
        if (!commandId || typeof this.mqttService.publishRpcResponse !== 'function') {
            return;
        }
        const response = {
            success: result.success,
            status: result.success ? 'ACKED' : 'FAILED',
            method: String(rpcBody.method),
            error: result.error,
        };
        this.cacheAck(commandId, response);
        try {
            await this.mqttService.publishRpcResponse(commandId, response);
        }
        catch (error) {
            this.logger.warn(`RPC ACK publish failed (Modbus already finished): ${error.message}`);
        }
    }
    cacheAck(commandId, response) {
        var _a, _b;
        this.ackCache.set(commandId, response);
        const timer = setTimeout(() => this.ackCache.delete(commandId), constants_1.DEBOUNCE_CONFIG.COMMAND_ID_CACHE_TTL);
        (_b = (_a = timer).unref) === null || _b === void 0 ? void 0 : _b.call(_a);
    }
    /**
     * Re-publish the terminal response of an already handled command_id (duplicate
     * delivery), so the client is not left without a response. Returns false when
     * the command is still running; its final response will follow on the same topic.
     */
    async resendRpcAck(commandId) {
        if (!commandId || typeof this.mqttService.publishRpcResponse !== 'function') {
            return false;
        }
        const cached = this.ackCache.get(commandId);
        if (!cached) {
            return false;
        }
        try {
            await this.mqttService.publishRpcResponse(commandId, cached);
            this.logger.log(`[RPC-DEDUPE] Re-sent ${cached.status} for duplicate command ${commandId}`);
            return true;
        }
        catch (error) {
            this.logger.warn(`[RPC-DEDUPE] Re-send failed for ${commandId}: ${error.message}`);
            return false;
        }
    }
    normalizeRpcBody(rpcBody) {
        // Mobile generic writes: `control` (older) or `set` (Config tab / firmware
        // canonical). Both arrive as { key, value }. Map to set_state so Modbus
        // write + two-way ACK share one path.
        const method = String(rpcBody.method || '').toLowerCase();
        const isMobileWrite = method === 'control' || method === 'set';
        if (isMobileWrite && rpcBody.params && rpcBody.params.key != null && rpcBody.params.key !== '') {
            const key = String(rpcBody.params.key);
            return Object.assign(Object.assign({}, rpcBody), { method: 'set_state', params: { [key]: rpcBody.params.value } });
        }
        if (isMobileWrite && rpcBody.params && typeof rpcBody.params === 'object') {
            return Object.assign(Object.assign({}, rpcBody), { method: 'set_state' });
        }
        return rpcBody;
    }
    isArbiterReleaseRequest(rpcBody) {
        return rpcBody.method === exports.RELEASE_CLAIMS_METHOD && (0, arbiter_registry_1.getArbiter)() !== null;
    }
    async handleRpcRequestInternal(rpcBody, maxRetries = 3) {
        let lastError = null;
        const startTime = Date.now();
        rpcBody = this.normalizeRpcBody(rpcBody);
        const ctx = (0, rpc_deadline_1.currentRpcDeadline)();
        if (ctx && typeof rpcBody.source === "string") {
            ctx.source = rpcBody.source;
        }
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (attempt > 1 && (0, rpc_deadline_1.isRpcExpired)(ctx)) {
                this.logger.warn(`[RPC-EXPIRED] Not retrying (attempt ${attempt}/${maxRetries}): request deadline passed`);
                break;
            }
            try {
                if (rpcBody.method === "set_state" && rpcBody.params) {
                    this.logger.log(`Processing RPC request (attempt ${attempt}/${maxRetries}): ${JSON.stringify(rpcBody)}`);
                    await this.handleSetStateRequest(rpcBody.params);
                    this.logger.log(`[RPC-DONE] Request completed in ${Date.now() - startTime}ms`);
                    await this.publishRpcAck(rpcBody, { success: true });
                    return; // Success
                }
                else if (rpcBody.method === "set_state_batch" && rpcBody.params) {
                    this.logger.log(`Processing batch RPC request (attempt ${attempt}/${maxRetries})`);
                    await this.handleSetStateBatchRequest(rpcBody.params);
                    this.logger.log(`[RPC-DONE] Batch request completed in ${Date.now() - startTime}ms`);
                    await this.publishRpcAck(rpcBody, { success: true });
                    return;
                }
                else if (this.isArbiterReleaseRequest(rpcBody)) {
                    await this.handleReleaseClaims((0, arbiter_registry_1.getArbiter)(), rpcBody.params);
                    await this.publishRpcAck(rpcBody, { success: true });
                    return;
                }
                else {
                    // Leave schedule/oneway methods for the owning node. Do not ACK.
                    this.logger.warn(`Unsupported RPC method: ${rpcBody.method}`);
                    return; // No need to retry for unsupported methods
                }
            }
            catch (error) {
                lastError = error;
                this.logger.error(`[RPC-ERROR] Attempt ${attempt}/${maxRetries} failed after ${Date.now() - startTime}ms: ${lastError.message}`);
                if (lastError instanceof rpc_deadline_1.RpcExpiredError || (0, rpc_deadline_1.isRpcExpired)(ctx)) {
                    // The deadline watchdog in handleRpcRequest reports FAILED.
                    break;
                }
                // Check if error is retryable
                if (this.isRetryableError(lastError.message) && attempt < maxRetries) {
                    this.logger.warn(`RPC request failed (attempt ${attempt}/${maxRetries}), retrying: ${lastError.message}`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
                    continue;
                }
                // Non-retryable error or last attempt
                break;
            }
        }
        // Handle the final error (an expired request is answered by the deadline watchdog)
        if (lastError && !(0, rpc_deadline_1.isRpcExpired)(ctx)) {
            await this.publishRpcAck(rpcBody, { success: false, error: lastError.message });
            await this.handleRpcError(lastError);
        }
    }
    /**
     * Handle set_state_batch RPC request
     */
    async handleSetStateBatchRequest(params) {
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
                await this.sleep(Number(cmd.ms) || 0);
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
            try {
                await this.withTimeout(this.handleSetStateRequest({ [key]: cmd.value }), Number(options.timeout_per_cmd) || this.defaultBatchOptions.timeout_per_cmd, `Command timeout for ${key}`);
                successfulCommands.push({ key, value: cmd.value, order });
                results.push({
                    order,
                    key,
                    status: "success",
                    timestamp: new Date().toISOString(),
                });
            }
            catch (error) {
                const errorMessage = error.message;
                results.push({
                    order,
                    key,
                    status: "failed",
                    error: errorMessage,
                    timestamp: new Date().toISOString(),
                });
                this.logger.error(`Batch command failed [${batchId}] ${key}: ${errorMessage}`);
                // A timeout leaves the command running: its claim can still be waiting for a tick (up to 15 s,
                // 7 s water-hammer sleeps included) and would win later and hold the coil.
                await this.withdrawClaims([key], `batch command failed: ${errorMessage}`);
                const abortsBatch = options.sequential && !options.continue_on_error;
                let withdrawn = new Set();
                if ((options.rollback_on_fail || abortsBatch) && successfulCommands.length > 0) {
                    // A failed batch leaves nothing of its arbitrated commands behind; the claim goes instead of an
                    // opposite write (an OFF claim would linger as a block on the key).
                    withdrawn = await this.withdrawClaims(successfulCommands.map(c => c.key), 'batch failed');
                }
                if (options.rollback_on_fail && successfulCommands.length > 0) {
                    await this.rollbackBatch(successfulCommands.filter(c => !withdrawn.has(c.key)), batchId);
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
        await this.mqttService.publishConfigUpdate("rpc_batch_result", {
            batch_id: batchId,
            status: overallStatus,
            total: writeCount,
            success_count: successCount,
            failed_count: results.length - successCount,
            results,
            completed_at: new Date().toISOString(),
        }, "set_state_batch completed");
        this.node.status({ fill: overallStatus === "success" ? "green" : "yellow", shape: "dot", text: `batch ${overallStatus}` });
        this.logger.log(`Batch ${batchId} completed: ${overallStatus} (${successCount}/${writeCount})`);
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
    async rollbackBatch(successfulCommands, batchId) {
        this.logger.warn(`Starting rollback for batch ${batchId} (${successfulCommands.length} commands)`);
        for (const cmd of [...successfulCommands].reverse()) {
            const rollbackValue = this.getRollbackValue(cmd.value);
            if (rollbackValue === null) {
                this.logger.warn(`Skipping rollback for ${cmd.key}: unsupported value ${JSON.stringify(cmd.value)}`);
                continue;
            }
            try {
                await this.handleSetStateRequest({ [cmd.key]: rollbackValue });
            }
            catch (error) {
                this.logger.error(`Rollback failed for ${cmd.key}: ${error.message}`);
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
    async handleRpcError(error) {
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
                    await this.modbusService.checkConnection();
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
            await this.publishErrorWithRetry(errorMessage);
        }
        catch (publishError) {
            this.logger.error(`Failed to handle RPC error: ${publishError.message}`);
        }
    }
    /**
     * Publish error with retry logic
     */
    async publishErrorWithRetry(errorMessage, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.mqttService.publishError(errorMessage);
                return; // Success
            }
            catch (error) {
                this.logger.error(`Failed to publish error (attempt ${attempt}/${maxRetries}): ${error.message}`);
                if (attempt < maxRetries) {
                    // Check if MQTT is connected
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
        this.logger.error("Failed to publish error after all retries");
    }
    /**
     * Handle set_state RPC request
     */
    async handleSetStateRequest(params) {
        try {
            // Filter out parameters with "undefined" values
            const filteredParams = this.filterUndefinedParams(params);
            if (Object.keys(filteredParams).length === 0) {
                this.logger.warn("All parameters were filtered out due to undefined values");
                this.node.status({ fill: "yellow", shape: "ring", text: "No valid parameters" });
                return;
            }
            this.logger.log(`[SET-STATE] Processing ${Object.keys(filteredParams).length} parameters`);
            // Try luoi mapping handler first - it now handles actual Modbus writes
            const hasLuoiMapping = await this.luoiHandler.processRpcBody(filteredParams);
            // Create a copy of filteredParams without luoi parameters for standard processing
            const standardParams = Object.assign({}, filteredParams);
            const luoiMappingKeys = Object.keys(this.luoiHandler['luoiMapping'] || {});
            luoiMappingKeys.forEach(key => {
                delete standardParams[key];
            });
            // Process remaining non-luoi parameters with standard handler
            // Only process if there are remaining parameters after removing luoi keys
            if (Object.keys(standardParams).length > 0) {
                await this.handleStandardParams(standardParams);
            }
            this.logger.log(`[SET-STATE] Completed successfully`);
        }
        catch (error) {
            this.logger.error(`Error in handleSetStateRequest: ${error.message}`);
            // The caller is told this set_state failed: the claims of its other keys must not hold the coils either.
            await this.withdrawClaims(Object.keys(params), 'set_state failed');
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
    async handleStandardParams(params) {
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
        for (const [key, rawValue] of holdingParams) {
            await this.processParameter(key, rawValue);
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
            await this.processParameter(key, rawValue);
            // Small delay between each coil write to ensure proper sequencing
            if (coilParams.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        for (const [key, rawValue] of configParams) {
            await this.processParameter(key, rawValue);
        }
    }
    /**
     * Process a single parameter
     */
    async processParameter(key, rawValue) {
        const mapping = this.modbusService.findModbusMapping(key);
        if (mapping) {
            await this.handleModbusMappedParameter(key, rawValue, mapping);
        }
        else {
            await this.handleConfigOnlyParameter(key, rawValue);
        }
    }
    /**
     * Handle parameter that has Modbus mapping
     */
    async handleModbusMappedParameter(key, rawValue, mapping) {
        // Validate and convert value
        const value = this.validationService.validateAndConvertValue(key, rawValue);
        // Protection gate check for coils (fc=5)
        const protectionGate = this.resolveGate();
        if (mapping.fc === 5 && protectionGate) {
            const gate = protectionGate.checkGate(key, Boolean(value), 'rpc');
            if (!gate.allowed) {
                this.logger.warn(`[PROTECTION] Blocked ${key}=${value}: ${gate.reason}`);
                try {
                    await this.mqttService.publishConfigUpdate(`_blocked_${key}`, {
                        requested: value,
                        reason: gate.reason,
                        source: 'rpc',
                        action: gate.action,
                    });
                }
                catch (pubErr) {
                    this.logger.warn(`Failed to publish blocked telemetry: ${pubErr.message}`);
                }
                throw new Error(`Protection blocked: ${gate.reason}`);
            }
        }
        // Actuator arbiter (ARBITER_MODE observe|enforce, fc=5 keys listed managed/hold): null when off.
        const arbiter = mapping.fc === 5 ? (0, arbiter_registry_1.getArbiter)() : null;
        const arbitrated = arbiter !== null && arbiter.manages(key);
        if (arbitrated && arbiter.mode() === 'enforce') {
            await this.claimThroughArbiter(arbiter, key, Boolean(value), mapping);
            return;
        }
        (0, rpc_deadline_1.assertRpcNotExpired)(`Modbus write ${key}=${value}`);
        this.logger.log(`[MODBUS-WRITE] Writing ${key}=${value} (fc=${mapping.fc}, address=${mapping.address})`);
        // Write to Modbus with connection error handling.
        // If this throws, the outer handleRpcRequest retry loop may re-attempt — which is safe
        // because the write did not actually succeed yet.
        try {
            await this.writeToModbusWithRetry(key, mapping, value);
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
        try {
            const readValue = await this.readFromModbusWithRetry(key, mapping);
            // Update global context cache only after successful read-back verification
            this.modbusService.updateGlobalContextCacheAfterVerification(key, readValue, mapping.fc);
            // Update protection gate state after successful coil write
            if (mapping.fc === 5 && this.resolveGate()) {
                this.resolveGate().updateState(key, Boolean(readValue));
            }
            // Publish the confirmed read-back value
            await this.publishResultWithRetry(key, readValue);
            this.node.status({ fill: "green", shape: "dot", text: `${key}=${readValue}` });
        }
        catch (readError) {
            // Write succeeded but read-back failed. Publish the written value as fallback and
            // return without throwing — the outer retry must NOT re-write.
            this.logger.warn(`[RPC-HANDLER] Write succeeded but read-back failed for ${key}: ${readError.message}. Publishing written value as fallback.`);
            await this.publishResultWithRetry(key, value);
            this.node.status({ fill: "yellow", shape: "ring", text: `${key} written (no readback)` });
            // Update gate state even on read-back failure (write succeeded)
            if (mapping.fc === 5 && this.resolveGate()) {
                this.resolveGate().updateState(key, Boolean(value));
            }
        }
        if (arbitrated) {
            // observe: the write above is today's; the claim only records who owns the coil.
            const claim = this.buildArbiterClaim(arbiter, key, Boolean(value));
            void arbiter.claim(claim).catch((error) => {
                this.logger.warn(`[ARBITER] Observe claim for ${key} not recorded: ${error.message}`);
            });
        }
    }
    /** Arbiter claim owner of the RPC being handled: one per source and command (a local input without command_id has one per source). */
    currentClaimOwner() {
        const ctx = (0, rpc_deadline_1.currentRpcDeadline)();
        return `${rpcClaimSource(ctx === null || ctx === void 0 ? void 0 : ctx.source)}:${(ctx === null || ctx === void 0 ? void 0 : ctx.commandId) || 'local'}`;
    }
    /**
     * Withdraws the claims this RPC made on `keys` (only keys the arbiter manages): a command the caller was told
     * failed must not take effect later (ADR-038 amendment 4), and that holds for the siblings of a failed
     * multi-key set_state / batch as well as for a command that timed out while its claim still waited for a tick.
     * Returns the keys the arbiter manages (whose claims are gone now).
     */
    async withdrawClaims(keys, why) {
        const withdrawn = new Set();
        const arbiter = (0, arbiter_registry_1.getArbiter)();
        if (arbiter === null)
            return withdrawn;
        const owner = this.currentClaimOwner();
        for (const key of keys) {
            if (!key || !arbiter.manages(key))
                continue;
            try {
                await arbiter.release(owner, key);
                withdrawn.add(key);
                this.logger.warn(`[ARBITER] Withdrew claim ${owner} on ${key}: ${why}`);
            }
            catch (error) {
                this.logger.warn(`[ARBITER] Could not withdraw claim ${owner} on ${key}: ${error.message}`);
            }
        }
        return withdrawn;
    }
    buildArbiterClaim(arbiter, key, value) {
        const ctx = (0, rpc_deadline_1.currentRpcDeadline)();
        const source = rpcClaimSource(ctx === null || ctx === void 0 ? void 0 : ctx.source);
        const lease = arbiter.leaseMs(source, key);
        return {
            key,
            value,
            source,
            // A command without command_id (local flow input) has one owner per source: the newer replaces it.
            ownerId: this.currentClaimOwner(),
            // null = never lapses (alarm_action): it ends on release_claims, not on a lease.
            expiresAt: lease === null ? null : Date.now() + lease,
        };
    }
    /**
     * enforce: the RPC does not write a managed coil; it claims it and the arbiter writes the winner.
     * ACKED only when this claim won, the coil reads the requested value and the request deadline has not
     * passed. Every other outcome answers FAILED and withdraws the claim, so a command the caller was told
     * failed never takes effect later (same rule as the RPC deadline: a stale command is not applied late).
     */
    async claimThroughArbiter(arbiter, key, value, mapping) {
        var _a, _b, _c;
        (0, rpc_deadline_1.assertRpcNotExpired)(`Arbiter claim ${key}=${value}`);
        const claim = this.buildArbiterClaim(arbiter, key, value);
        this.logger.log(`[ARBITER] Claim ${key}=${value} (${claim.ownerId})`);
        const result = await arbiter.claim(claim);
        const withdraw = async (why) => {
            try {
                await arbiter.release(claim.ownerId, key);
                this.logger.warn(`[ARBITER] Withdrew claim ${claim.ownerId} on ${key}: ${why}`);
            }
            catch (error) {
                this.logger.warn(`[ARBITER] Could not withdraw claim ${claim.ownerId}: ${error.message}`);
            }
        };
        if ((0, rpc_deadline_1.isRpcExpired)((0, rpc_deadline_1.currentRpcDeadline)())) {
            await withdraw('request deadline passed');
            throw new rpc_deadline_1.RpcExpiredError(`Arbiter claim ${key}=${value}`);
        }
        if (!result.applied) {
            await withdraw(`blocked by ${(_a = result.blockedBy) !== null && _a !== void 0 ? _a : 'expired'}`);
            this.node.status({ fill: "yellow", shape: "ring", text: `${key} blocked by ${(_b = result.blockedBy) !== null && _b !== void 0 ? _b : 'expired'}` });
            throw new Error(`blocked_by:${(_c = result.blockedBy) !== null && _c !== void 0 ? _c : 'expired'}`);
        }
        if (result.boardOffline) {
            // The board is down (circuit breaker open): answered at once, and the command must not apply when it returns.
            await withdraw(`board offline: ${result.boardOffline}`);
            this.node.status({ fill: "red", shape: "ring", text: `${key} board offline` });
            throw new Error(`board_offline:${result.boardOffline}`);
        }
        if (result.gateBlocked) {
            // Device protection holds this ON back at the tick (it is checked again on every tick).
            await withdraw(`protection: ${result.gateBlocked}`);
            this.node.status({ fill: "yellow", shape: "ring", text: `${key} protection blocked` });
            throw new Error(`Protection blocked: ${result.gateBlocked}`);
        }
        if (result.actual !== value) {
            await withdraw(`coil reads ${String(result.actual)}`);
            this.node.status({ fill: "yellow", shape: "ring", text: `${key} not confirmed` });
            throw new Error(`not_confirmed:${key} reads ${String(result.actual)}`);
        }
        this.modbusService.updateGlobalContextCacheAfterVerification(key, result.actual, mapping.fc);
        if (this.resolveGate()) {
            this.resolveGate().updateState(key, result.actual);
        }
        await this.publishResultWithRetry(key, result.actual);
        this.node.status({ fill: "green", shape: "dot", text: `${key}=${result.actual} (arbiter)` });
    }
    /**
     * `release_claims`: drops the claims of `params.source` (default `manual`; `alarm_action` is the other one a
     * remote caller may release) on `params.keys`, or on every key when none are given.
     */
    async handleReleaseClaims(arbiter, params) {
        var _a;
        const source = (_a = params === null || params === void 0 ? void 0 : params.source) !== null && _a !== void 0 ? _a : "manual";
        if (source !== "manual" && source !== "alarm_action") {
            throw new Error(`release_claims: unsupported source ${JSON.stringify(source)}`);
        }
        const owner = `${source}:*`;
        const keys = Array.isArray(params === null || params === void 0 ? void 0 : params.keys) ? params.keys.map((k) => String(k)) : null;
        if (keys && keys.length > 0) {
            for (const key of keys) {
                await arbiter.release(owner, key);
            }
        }
        else {
            await arbiter.release(owner);
        }
        this.logger.log(`[ARBITER] Released ${source} claims${keys && keys.length > 0 ? ` on ${keys.join(', ')}` : ''}`);
    }
    /**
     * Handle parameter that only updates configuration (no Modbus mapping)
     */
    async handleConfigOnlyParameter(key, rawValue) {
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
            await this.mqttService.publishConfigUpdate(key, value);
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
    async writeToModbusWithRetry(key, mapping, value, maxRetries = 2) {
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            (0, rpc_deadline_1.assertRpcNotExpired)(`Modbus write ${key} (attempt ${attempt}/${maxRetries})`);
            try {
                await this.modbusService.writeToModbus(key, mapping, value);
                return; // Success, exit retry loop
            }
            catch (error) {
                lastError = error;
                const errorMessage = lastError.message;
                // Check if this is a connection-related error
                if (this.isConnectionError(errorMessage)) {
                    this.logger.error(`[RPC-HANDLER] Modbus connection lost: ${errorMessage}`);
                    if (attempt < maxRetries) {
                        this.logger.warn(`[RPC-HANDLER] Attempting reconnection (${attempt}/${maxRetries})...`);
                        try {
                            // Pass boardId so the correct board client is reconnected in multi-board mode
                            await this.modbusService.checkConnection(mapping.boardId);
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
    async readFromModbusWithRetry(key, mapping, maxRetries = 2) {
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.modbusService.readFromModbus(key, mapping);
            }
            catch (error) {
                lastError = error;
                const errorMessage = lastError.message;
                // Check if this is a connection-related error
                if (this.isConnectionError(errorMessage)) {
                    this.logger.error(`[RPC-HANDLER] Modbus connection lost during read: ${errorMessage}`);
                    if (attempt < maxRetries) {
                        this.logger.warn(`[RPC-HANDLER] Attempting reconnection for read (${attempt}/${maxRetries})...`);
                        try {
                            // Pass boardId so the correct board client is reconnected in multi-board mode
                            await this.modbusService.checkConnection(mapping.boardId);
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

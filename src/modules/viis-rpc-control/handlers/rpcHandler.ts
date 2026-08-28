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
import { ProtectionGateService, resolveProtectionGate } from "../../viis-device-protection/services/protection-gate-service";
import {
    FertigationWriteOp,
    isFertigationBatch,
    planFertigationStartWrites,
} from "../../shared/fertigation-start-sequence";
import { isValveOn } from "../../viis-schedule-executor/schedule-valve-program";
import {
    extractRpcCommandId,
    isHandledRpcControlMethod,
} from "../../../core/demeter-mqtt-topics";

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
    private requestQueue: Promise<void> = Promise.resolve();
    private queueLength: number = 0;
    private protectionGate: ProtectionGateService | null = null;

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
        if (/^valve_\d+$/i.test(key)) {
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
    }

    /**
     * Set protection gate service for coil write protection
     */
    setProtectionGate(gate: ProtectionGateService): void {
        this.protectionGate = gate;
    }

    private resolveGate(): ProtectionGateService | null {
        const fromGlobal = this.node?.context?.()?.global?.get?.('protectionGateService');
        return resolveProtectionGate(fromGlobal) || resolveProtectionGate(this.protectionGate);
    }

    /**
     * Handle incoming RPC request with retry logic
     */
    async handleRpcRequest(rpcBody: RpcMessage, maxRetries: number = 3): Promise<void> {
        this.queueLength++;
        this.logger.log(`[QUEUE] RPC request queued (queue: ${this.queueLength})`);

        const execution = this.requestQueue.then(async () => {
            this.logger.log(`[QUEUE] RPC request dequeued, starting execution (remaining: ${this.queueLength - 1})`);
            return this.withTimeout(
                this.handleRpcRequestInternal(rpcBody, maxRetries),
                this.RPC_REQUEST_TIMEOUT,
                `RPC request timeout after ${this.RPC_REQUEST_TIMEOUT}ms`
            );
        });

        this.requestQueue = execution.catch(() => { /* keep queue alive */ }).finally(() => {
            this.queueLength--;
        });

        return execution;
    }

    /**
     * Internal request processor executed in serialized queue
     */
    private async publishRpcAck(
        rpcBody: RpcMessage,
        result: { success: boolean; error?: string },
    ): Promise<void> {
        if (!isHandledRpcControlMethod(rpcBody.method)) {
            return;
        }
        const commandId = extractRpcCommandId(rpcBody);
        if (!commandId || typeof this.mqttService.publishRpcResponse !== 'function') {
            return;
        }
        try {
            await this.mqttService.publishRpcResponse(commandId, {
                success: result.success,
                status: result.success ? 'ACKED' : 'FAILED',
                method: String(rpcBody.method),
                error: result.error,
            });
        } catch (error) {
            this.logger.warn(`RPC ACK publish failed (Modbus already finished): ${(error as Error).message}`);
        }
    }

    private normalizeRpcBody(rpcBody: RpcMessage): RpcMessage {
        // Mobile generic writes: `control` (older) or `set` (Config tab / firmware
        // canonical). Both arrive as { key, value }. Map to set_state so Modbus
        // write + two-way ACK share one path.
        const method = String(rpcBody.method || '').toLowerCase();
        const isMobileWrite = method === 'control' || method === 'set';
        if (isMobileWrite && rpcBody.params && rpcBody.params.key != null && rpcBody.params.key !== '') {
            const key = String(rpcBody.params.key);
            return {
                ...rpcBody,
                method: 'set_state',
                params: { [key]: rpcBody.params.value },
            };
        }
        if (isMobileWrite && rpcBody.params && typeof rpcBody.params === 'object') {
            return { ...rpcBody, method: 'set_state' };
        }
        return rpcBody;
    }

    private async handleRpcRequestInternal(rpcBody: RpcMessage, maxRetries: number = 3): Promise<void> {
        let lastError: Error | null = null;
        const startTime = Date.now();
        rpcBody = this.normalizeRpcBody(rpcBody);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (rpcBody.method === "set_state" && rpcBody.params) {
                    this.logger.log(`Processing RPC request (attempt ${attempt}/${maxRetries}): ${JSON.stringify(rpcBody)}`);
                    await this.handleSetStateRequest(rpcBody.params);
                    this.logger.log(`[RPC-DONE] Request completed in ${Date.now() - startTime}ms`);
                    await this.publishRpcAck(rpcBody, { success: true });
                    return; // Success
                } else if (rpcBody.method === "set_state_batch" && rpcBody.params) {
                    this.logger.log(`Processing batch RPC request (attempt ${attempt}/${maxRetries})`);
                    await this.handleSetStateBatchRequest(rpcBody.params);
                    this.logger.log(`[RPC-DONE] Batch request completed in ${Date.now() - startTime}ms`);
                    await this.publishRpcAck(rpcBody, { success: true });
                    return;
                } else {
                    // Leave schedule/oneway methods for the owning node. Do not ACK.
                    this.logger.warn(`Unsupported RPC method: ${rpcBody.method}`);
                    return; // No need to retry for unsupported methods
                }
            } catch (error) {
                lastError = error as Error;
                this.logger.error(`[RPC-ERROR] Attempt ${attempt}/${maxRetries} failed after ${Date.now() - startTime}ms: ${lastError.message}`);

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

        // Handle the final error
        if (lastError) {
            await this.publishRpcAck(rpcBody, { success: false, error: lastError.message });
            await this.handleRpcError(lastError);
        }
    }

    /**
     * Handle set_state_batch RPC request
     */
    private async handleSetStateBatchRequest(params: Record<string, any>): Promise<void> {
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
                await this.withTimeout(
                    this.handleSetStateRequest({ [key]: cmd.value }),
                    Number(options.timeout_per_cmd) || this.defaultBatchOptions.timeout_per_cmd,
                    `Command timeout for ${key}`
                );

                successfulCommands.push({ key, value: cmd.value, order });
                results.push({
                    order,
                    key,
                    status: "success",
                    timestamp: new Date().toISOString(),
                });
            } catch (error) {
                const errorMessage = (error as Error).message;
                results.push({
                    order,
                    key,
                    status: "failed",
                    error: errorMessage,
                    timestamp: new Date().toISOString(),
                });

                this.logger.error(`Batch command failed [${batchId}] ${key}: ${errorMessage}`);

                if (options.rollback_on_fail && successfulCommands.length > 0) {
                    await this.rollbackBatch(successfulCommands, batchId);
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

    private buildFertigationBatchCommands(
        commands: Array<{ key?: string; value?: unknown; order?: number }>,
        holdings: Record<string, number>,
        coils: Record<string, number>
    ): Array<{ key?: string; value?: unknown; order?: number; kind?: string; ms?: number }> {
        const ops = planFertigationStartWrites({
            commands: commands.map((cmd) => ({ key: String(cmd?.key || ""), value: cmd?.value })),
            holdings,
            coils,
        });
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
        batchId: string
    ): Promise<void> {
        this.logger.warn(`Starting rollback for batch ${batchId} (${successfulCommands.length} commands)`);

        for (const cmd of [...successfulCommands].reverse()) {
            const rollbackValue = this.getRollbackValue(cmd.value);
            if (rollbackValue === null) {
                this.logger.warn(`Skipping rollback for ${cmd.key}: unsupported value ${JSON.stringify(cmd.value)}`);
                continue;
            }

            try {
                await this.handleSetStateRequest({ [cmd.key]: rollbackValue });
            } catch (error) {
                this.logger.error(`Rollback failed for ${cmd.key}: ${(error as Error).message}`);
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
    private async handleRpcError(error: Error): Promise<void> {
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
                    await this.modbusService.checkConnection();
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
            await this.publishErrorWithRetry(errorMessage);
        } catch (publishError) {
            this.logger.error(`Failed to handle RPC error: ${(publishError as Error).message}`);
        }
    }

    /**
     * Publish error with retry logic
     */
    private async publishErrorWithRetry(errorMessage: string, maxRetries: number = 3): Promise<void> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.mqttService.publishError(errorMessage);
                return; // Success
            } catch (error) {
                this.logger.error(`Failed to publish error (attempt ${attempt}/${maxRetries}): ${(error as Error).message}`);

                if (attempt < maxRetries) {
                    // Check if MQTT is connected
                    if (!this.mqttService.isConnected()) {
                        this.logger.warn("MQTT disconnected, waiting for reconnection...");
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
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
    private async handleSetStateRequest(params: Record<string, any>): Promise<void> {
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
            const standardParams = { ...filteredParams };
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
    private async handleStandardParams(params: Record<string, any>): Promise<void> {

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
    private async processParameter(key: string, rawValue: any): Promise<void> {
        const mapping = this.modbusService.findModbusMapping(key);
        if (mapping) {
            await this.handleModbusMappedParameter(key, rawValue, mapping);
        } else {
            await this.handleConfigOnlyParameter(key, rawValue);
        }
    }

    /**
     * Handle parameter that has Modbus mapping
     */
    private async handleModbusMappedParameter(key: string, rawValue: any, mapping: any): Promise<void> {
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
            await this.writeToModbusWithRetry(key, mapping, value);
            this.logger.log(`[MODBUS-WRITE] Write ${key} completed successfully`);
        } catch (error) {
            this.logger.error(`[MODBUS-WRITE] Failed to write ${key}: ${(error as Error).message}`);
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
                this.resolveGate()!.updateState(key, Boolean(readValue));
            }

            // Publish the confirmed read-back value
            await this.publishResultWithRetry(key, readValue);

            this.node.status({ fill: "green", shape: "dot", text: `${key}=${readValue}` });
        } catch (readError) {
            // Write succeeded but read-back failed. Publish the written value as fallback and
            // return without throwing — the outer retry must NOT re-write.
            this.logger.warn(`[RPC-HANDLER] Write succeeded but read-back failed for ${key}: ${(readError as Error).message}. Publishing written value as fallback.`);
            await this.publishResultWithRetry(key, value);
            this.node.status({ fill: "yellow", shape: "ring", text: `${key} written (no readback)` });

            // Update gate state even on read-back failure (write succeeded)
            if (mapping.fc === 5 && this.resolveGate()) {
                this.resolveGate()!.updateState(key, Boolean(value));
            }
        }
    }

    /**
     * Handle parameter that only updates configuration (no Modbus mapping)
     */
    private async handleConfigOnlyParameter(key: string, rawValue: any): Promise<void> {
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
    private async writeToModbusWithRetry(key: string, mapping: any, value: any, maxRetries: number = 2): Promise<void> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.modbusService.writeToModbus(key, mapping, value);
                return; // Success, exit retry loop
            } catch (error) {
                lastError = error as Error;
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
    private async readFromModbusWithRetry(key: string, mapping: any, maxRetries: number = 2): Promise<number | boolean> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.modbusService.readFromModbus(key, mapping);
            } catch (error) {
                lastError = error as Error;
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

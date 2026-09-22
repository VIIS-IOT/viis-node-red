"use strict";
/**
 * RPC Handler for VIIS RPC Control Node
 * Handles RPC request processing and coordination between services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcHandler = void 0;
exports.resetVietplantsRpcQueueForTests = resetVietplantsRpcQueueForTests;
exports.notePumpCoilCommand = notePumpCoilCommand;
exports.releasePumpOnPending = releasePumpOnPending;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
const PUMP_ON_KEY = /^COIL_BOM_(1[0-6]|[1-9])$/;
const BOOKKEEPING_ERROR_PUBLISH_TIMEOUT_MS = 5000;
const pumpOnPending = new Set();
const pumpGeneration = new Map();
const pumpBookkeepingOwned = new Map();
const activatedInCurrentRequest = new Set();
let deviceRpcQueue = Promise.resolve();
function resetVietplantsRpcQueueForTests() {
    pumpOnPending.clear();
    pumpGeneration.clear();
    pumpBookkeepingOwned.clear();
    activatedInCurrentRequest.clear();
    deviceRpcQueue = Promise.resolve();
}
function notePumpCoilCommand(key, value) {
    const turningOn = value === true || value === 1;
    if (!PUMP_ON_KEY.test(key) || !turningOn) {
        if (PUMP_ON_KEY.test(key)) {
            pumpOnPending.delete(key);
        }
        return "run";
    }
    if (pumpOnPending.has(key)) {
        return "drop";
    }
    pumpOnPending.add(key);
    return "run";
}
function releasePumpOnPending(key) {
    pumpOnPending.delete(key);
}
class RpcHandler {
    constructor(options, configService, validationService, modbusService, mqttService, luoiHandler) {
        this.configService = configService;
        this.validationService = validationService;
        this.modbusService = modbusService;
        this.mqttService = mqttService;
        this.luoiHandler = luoiHandler;
        this.node = options.node;
        this.logger = new logger_1.Logger(options.node, "RPC-HANDLER");
    }
    /**
     * Handle incoming RPC request with retry logic
     */
    async handleRpcRequest(rpcBody, maxRetries = 3) {
        const pumpKeys = this.pumpOnKeys(rpcBody);
        const droppedPumpKeys = new Set();
        for (const pumpKey of pumpKeys) {
            if (notePumpCoilCommand(pumpKey, true) === "drop") {
                droppedPumpKeys.add(pumpKey);
                this.logger.warn(`[QUEUE] Coalesced duplicate ${pumpKey} ON`);
            }
        }
        const acquiredPumpKeys = pumpKeys.filter((pumpKey) => !droppedPumpKeys.has(pumpKey));
        const rpcBodyToRun = droppedPumpKeys.size > 0 && rpcBody.params
            ? Object.assign(Object.assign({}, rpcBody), { params: this.paramsWithoutCoalescedPumps(rpcBody.params, droppedPumpKeys) }) : rpcBody;
        if (rpcBodyToRun.params && Object.keys(rpcBodyToRun.params).length === 0) {
            return;
        }
        const execution = deviceRpcQueue.then(() => this.handleRpcRequestBody(rpcBodyToRun, maxRetries));
        deviceRpcQueue = execution.catch(() => undefined);
        try {
            await execution;
        }
        finally {
            for (const pumpKey of acquiredPumpKeys) {
                const pumpNumber = this.extractPumpNumber(pumpKey);
                if (pumpNumber === null
                    || !pumpBookkeepingOwned.has(pumpKey)
                    || pumpBookkeepingOwned.get(pumpKey) !== pumpGeneration.get(pumpNumber)) {
                    releasePumpOnPending(pumpKey);
                }
            }
        }
    }
    paramsWithoutCoalescedPumps(params, droppedPumpKeys) {
        const droppedSuffixes = [...droppedPumpKeys]
            .map((key) => this.extractPumpNumber(key))
            .filter((pumpNumber) => pumpNumber !== null)
            .map((pumpNumber) => `_BOM_${pumpNumber}`);
        return Object.fromEntries(Object.entries(params).filter(([key]) => !droppedSuffixes.some((suffix) => key.endsWith(suffix))));
    }
    pumpOnKeys(rpcBody) {
        const params = rpcBody === null || rpcBody === void 0 ? void 0 : rpcBody.params;
        if (!params)
            return [];
        return Object.entries(params)
            .filter(([key, value]) => PUMP_ON_KEY.test(key) && (value === true || value === 1))
            .map(([key]) => key);
    }
    async handleRpcRequestBody(rpcBody, maxRetries) {
        activatedInCurrentRequest.clear();
        try {
            let lastError = null;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    if (rpcBody.method === "set_state" && rpcBody.params) {
                        this.logger.debug(`Processing RPC request (attempt ${attempt}/${maxRetries})`);
                        await this.handleSetStateRequest(rpcBody.params);
                        return;
                    }
                    this.logger.debug(`Unsupported RPC method: ${rpcBody.method}`);
                    return;
                }
                catch (error) {
                    lastError = error;
                    if (this.isRetryableError(lastError.message) && attempt < maxRetries) {
                        this.logger.debug(`RPC request failed (attempt ${attempt}/${maxRetries}), retrying`);
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                        continue;
                    }
                    break;
                }
            }
            if (lastError) {
                await this.handleRpcError(lastError);
            }
        }
        finally {
            activatedInCurrentRequest.clear();
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
                        this.logger.debug("MQTT disconnected, waiting for reconnection...");
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
                this.logger.debug("All parameters were filtered out due to undefined values");
                this.node.status({ fill: "yellow", shape: "ring", text: "No valid parameters" });
                return;
            }
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
            this.logger.debug(`Filtered out parameters with undefined values: ${filteredKeys.join(", ")}`);
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
        this.logger.debug(`Processing parameters - Holding: ${holdingParams.length}, Coils: ${coilParams.length}, Config: ${configParams.length}`);
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
            this.logger.debug('Adding delay between holding registers and coils');
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
        var _a;
        try {
            // Validate and convert value
            const value = this.validationService.validateAndConvertValue(key, rawValue);
            if (PUMP_ON_KEY.test(key) && !(value === true || value === 1)) {
                notePumpCoilCommand(key, value);
                const pumpNumber = this.extractPumpNumber(key);
                if (pumpNumber !== null) {
                    pumpGeneration.set(pumpNumber, ((_a = pumpGeneration.get(pumpNumber)) !== null && _a !== void 0 ? _a : 0) + 1);
                }
            }
            // Check if this is a pump coil (COIL_BOM_1 to COIL_BOM_16) being turned on
            if (this.isPumpCoilBeingTurnedOn(key, value)) {
                await this.handlePumpActivation(key, value, mapping);
            }
            else {
                // Standard handling for non-pump parameters
                await this.writeToModbusWithRetry(key, mapping, value);
                const readValue = await this.readFromModbusWithRetry(key, mapping);
                await this.publishResultWithRetry(key, readValue);
                this.node.status({ fill: "green", shape: "dot", text: `${key}=${readValue}` });
            }
        }
        catch (error) {
            this.logger.error(`Failed to process ${key}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Handle parameter that only updates configuration (no Modbus mapping)
     */
    async handleConfigOnlyParameter(key, rawValue) {
        try {
            // Skip if value is falsy (empty string, null, undefined, 0, false)
            // Note: 0 and false are valid values, so only skip empty strings and null/undefined
            if (rawValue === "" || rawValue === null || rawValue === undefined) {
                this.logger.debug(`Skipping config write for ${key}: value is empty/null/undefined`);
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
            this.logger.debug("Invalid RPC body: not an object");
            return false;
        }
        if (!rpcBody.method) {
            this.logger.debug("Invalid RPC body: missing method");
            return false;
        }
        if (rpcBody.method === "set_state" && !rpcBody.params) {
            this.logger.debug("Invalid RPC body: set_state method requires params");
            return false;
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
                        this.logger.debug("MQTT disconnected, waiting for reconnection...");
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
        this.logger.debug(`Processing batch of ${rpcBodies.length} RPC requests`);
        const results = [];
        for (let i = 0; i < rpcBodies.length; i++) {
            try {
                await this.handleRpcRequest(rpcBodies[i]);
                results.push({ success: true });
            }
            catch (error) {
                const errorMessage = `Batch request ${i + 1}/${rpcBodies.length} failed: ${error.message}`;
                this.logger.error(errorMessage);
                results.push({ success: false, error: errorMessage });
            }
        }
        const successCount = results.filter(r => r.success).length;
        this.logger.debug(`Batch processing completed: ${successCount}/${rpcBodies.length} successful`);
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
                        this.logger.debug(`[RPC-HANDLER] Attempting reconnection (${attempt}/${maxRetries})...`);
                        try {
                            await this.modbusService.checkConnection();
                            this.logger.debug(`[RPC-HANDLER] Reconnection successful, retrying operation...`);
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
                        this.logger.debug(`[RPC-HANDLER] Attempting reconnection for read (${attempt}/${maxRetries})...`);
                        try {
                            await this.modbusService.checkConnection();
                            this.logger.debug(`[RPC-HANDLER] Reconnection successful, retrying read operation...`);
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
     * Check if the key is a pump coil (COIL_BOM_1 to COIL_BOM_16) being turned on
     */
    isPumpCoilBeingTurnedOn(key, value) {
        // Check if key matches COIL_BOM_1 to COIL_BOM_16
        const pumpCoilPattern = /^COIL_BOM_(1[0-6]|[1-9])$/;
        return pumpCoilPattern.test(key) && (value === true || value === 1);
    }
    /**
     * Extract pump number from coil key (e.g., "COIL_BOM_5" -> 5)
     */
    extractPumpNumber(key) {
        const match = key.match(/^COIL_BOM_(\d+)$/);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
        return null;
    }
    async handlePumpActivation(key, value, mapping) {
        var _a;
        if (activatedInCurrentRequest.has(key)) {
            return;
        }
        const pumpNumber = this.extractPumpNumber(key);
        if (pumpNumber === null) {
            throw new Error(`Invalid pump coil key: ${key}`);
        }
        const currentGeneration = (_a = pumpGeneration.get(pumpNumber)) !== null && _a !== void 0 ? _a : 0;
        if (pumpBookkeepingOwned.get(key) === currentGeneration) {
            return;
        }
        const generation = currentGeneration + 1;
        pumpGeneration.set(pumpNumber, generation);
        await this.writeToModbusWithRetry(key, mapping, value);
        const pumpValue = await this.readFromModbusWithRetry(key, mapping);
        await this.publishResultWithRetry(key, pumpValue);
        activatedInCurrentRequest.add(key);
        this.node.status({ fill: "green", shape: "dot", text: `Pump ${pumpNumber} ON` });
        pumpBookkeepingOwned.set(key, generation);
        void this.runBoard2PumpBookkeeping(pumpNumber, generation)
            .catch((error) => {
            this.logger.error(`[PUMP-BOOKKEEPING] Pump ${pumpNumber}: ${error.message}`);
        })
            .finally(() => {
            if (pumpBookkeepingOwned.get(key) === generation) {
                pumpBookkeepingOwned.delete(key);
                if (pumpGeneration.get(pumpNumber) === generation) {
                    releasePumpOnPending(key);
                }
            }
        });
    }
    async runBoard2PumpBookkeeping(pumpNumber, generation) {
        const stillCurrent = () => pumpGeneration.get(pumpNumber) === generation;
        try {
            if (!stillCurrent())
                return;
            const board2Client = await this.modbusService.getBoard2Client();
            if (!board2Client)
                throw new Error("Board2 Modbus client not available");
            const resetKey = `RESET_TOTAL_VOLUME_BOM_${pumpNumber}`;
            const resetMapping = this.modbusService.findModbusMappingForBoard(resetKey, "board2");
            if (!resetMapping)
                throw new Error(`Reset coil mapping not found: ${resetKey}`);
            await this.modbusService.writeToModbusBoard(resetKey, resetMapping, 1, "board2");
            if (!stillCurrent())
                return;
            await this.modbusService.readFromModbusBoard(resetKey, resetMapping, "board2");
            await new Promise((resolve) => setTimeout(resolve, 200));
            if (!stillCurrent())
                return;
            const statusKey = `PUMP_STATUS_BOM_${pumpNumber}`;
            const statusMapping = this.modbusService.findModbusMappingForBoard(statusKey, "board2");
            if (statusMapping) {
                if (!stillCurrent())
                    return;
                await this.modbusService.writeToModbusBoard(statusKey, statusMapping, 1, "board2");
            }
        }
        catch (error) {
            if (!stillCurrent())
                return;
            const message = error.message;
            this.logger.error(`[PUMP-BOOKKEEPING] RESET_TOTAL_VOLUME_BOM_${pumpNumber} failed: ${message}`);
            let timeout;
            try {
                const publishTimedOut = await Promise.race([
                    this.mqttService.publishConfigUpdate(`RESET_TOTAL_VOLUME_BOM_${pumpNumber}_error`, message).then(() => false),
                    new Promise((resolve) => {
                        timeout = setTimeout(() => resolve(true), BOOKKEEPING_ERROR_PUBLISH_TIMEOUT_MS);
                    }),
                ]);
                if (publishTimedOut) {
                    this.logger.error(`[PUMP-BOOKKEEPING] Pump ${pumpNumber}: error publish timed out after ${BOOKKEEPING_ERROR_PUBLISH_TIMEOUT_MS}ms`);
                }
            }
            finally {
                if (timeout)
                    clearTimeout(timeout);
            }
        }
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

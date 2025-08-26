"use strict";
/**
 * RPC Handler for VIIS RPC Control Node
 * Handles RPC request processing and coordination between services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcHandler = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
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
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (rpcBody.method === "set_state" && rpcBody.params) {
                    this.logger.log(`Processing RPC request (attempt ${attempt}/${maxRetries}): ${JSON.stringify(rpcBody)}`);
                    await this.handleSetStateRequest(rpcBody.params);
                    return; // Success
                }
                else {
                    this.logger.warn(`Unsupported RPC method: ${rpcBody.method}`);
                    return; // No need to retry for unsupported methods
                }
            }
            catch (error) {
                lastError = error;
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
            await this.handleRpcError(lastError);
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
            // First, process luoi mapping parameters (luoi_1, luoi_2, luoi_3)
            const hasLuoiMapping = await this.luoiHandler.processRpcBody(params);
            // Create a copy of params without luoi parameters for standard processing
            const standardParams = Object.assign({}, params);
            Object.keys(this.luoiHandler['luoiMapping'] || {}).forEach(key => {
                delete standardParams[key];
            });
            // Process remaining parameters with standard handler
            if (Object.keys(standardParams).length > 0) {
                await this.handleStandardParams(standardParams);
            }
            // Set success status
            if (hasLuoiMapping && Object.keys(standardParams).length > 0) {
                this.node.status({ fill: "green", shape: "dot", text: "Luoi + standard commands processed" });
                this.logger.log("Both luoi and standard commands processed successfully");
            }
            else if (hasLuoiMapping) {
                this.node.status({ fill: "green", shape: "dot", text: "Luoi commands processed" });
                this.logger.log("Luoi commands processed successfully");
            }
            else {
                this.node.status({ fill: "green", shape: "dot", text: "Standard commands processed" });
                this.logger.log("Standard commands processed successfully");
            }
        }
        catch (error) {
            this.logger.error(`Error in handleSetStateRequest: ${error.message}`);
            throw error;
        }
    }
    /**
     * Handle standard parameter processing
     * Sort to process holding registers first, then coils
     */
    async handleStandardParams(params) {
        console.log("handleStandardParams", params);
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
        console.log("processParameter", key, rawValue, mapping);
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
        try {
            // Add debug log at the start
            this.logger.warn(`Processing Modbus parameter: key=${key}, rawValue=${rawValue}, mapping=${JSON.stringify(mapping)}`);
            // Validate and convert value
            const value = this.validationService.validateAndConvertValue(key, rawValue);
            this.logger.warn(`Validated value: ${value}`);
            // Write to Modbus with connection error handling
            this.logger.warn(`Attempting to write to Modbus: key=${key}, value=${value}`);
            await this.writeToModbusWithRetry(key, mapping, value);
            this.logger.warn(`Modbus write completed for: ${key}`);
            // Read back the value to confirm
            this.logger.warn(`Reading back value from Modbus: ${key}`);
            const readValue = await this.readFromModbusWithRetry(key, mapping);
            this.logger.warn(`Read value from Modbus: ${key}=${readValue} (type: ${typeof readValue})`);
            // Publish the result with retry
            await this.publishResultWithRetry(key, readValue);
            this.logger.warn(`Successfully processed Modbus parameter: ${key}=${readValue}`);
        }
        catch (error) {
            this.logger.error(`Failed to process Modbus parameter ${key}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Handle parameter that only updates configuration (no Modbus mapping)
     */
    async handleConfigOnlyParameter(key, rawValue) {
        try {
            // Validate and convert value
            const value = this.validationService.validateAndConvertValue(key, rawValue);
            this.logger.warn(`Config-only parameter validated: ${key}=${value} (type: ${typeof value})`);
            // Update configuration
            const currentConfig = this.configService.getConfigKeyValues();
            currentConfig[key] = value;
            this.configService.setConfigKeyValues(currentConfig);
            // Publish the validated value directly (not from config) to ensure correct type
            await this.mqttService.publishConfigUpdate(key, value);
            this.node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.CONFIG_UPDATED(key) });
            this.logger.log(`Successfully updated config parameter: ${key}=${value} (type: ${typeof value})`);
        }
        catch (error) {
            this.logger.error(`Failed to process config parameter ${key}: ${error.message}`);
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
                            await this.modbusService.checkConnection();
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
                            await this.modbusService.checkConnection();
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

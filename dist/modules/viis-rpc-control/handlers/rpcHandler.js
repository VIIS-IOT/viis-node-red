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
     * Handle incoming RPC request
     */
    async handleRpcRequest(rpcBody) {
        try {
            if (rpcBody.method === "set_state" && rpcBody.params) {
                this.logger.log(`Processing RPC request: ${JSON.stringify(rpcBody)}`);
                await this.handleSetStateRequest(rpcBody.params);
            }
            else {
                this.logger.warn(`Unsupported RPC method: ${rpcBody.method}`);
            }
        }
        catch (error) {
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
            // Don't re-throw the error to prevent uncaught exceptions
            // Instead, publish error status via MQTT if possible
            try {
                await this.mqttService.publishError(errorMessage);
            }
            catch (publishError) {
                this.logger.error(`Failed to publish error status: ${publishError.message}`);
            }
        }
    }
    /**
     * Handle set_state RPC request
     */
    async handleSetStateRequest(params) {
        try {
            // Try luoi mapping handler first - it now handles actual Modbus writes
            const hasLuoiMapping = await this.luoiHandler.processRpcBody(params);
            if (hasLuoiMapping) {
                // Luoi mapping was processed, set success status
                this.node.status({ fill: "green", shape: "dot", text: "Luoi commands processed" });
                this.logger.log("Luoi commands processed successfully");
                return;
            }
            // Fallback to standard processing for non-luoi cases
            await this.handleStandardParams(params);
        }
        catch (error) {
            this.logger.error(`Error in handleSetStateRequest: ${error.message}`);
            throw error;
        }
    }
    /**
     * Handle standard parameter processing
     */
    async handleStandardParams(params) {
        console.log("handleStandardParams", params);
        for (const [key, rawValue] of Object.entries(params)) {
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
            // Write to Modbus
            this.logger.warn(`Attempting to write to Modbus: key=${key}, value=${value}`);
            await this.modbusService.writeToModbus(key, mapping, value);
            this.logger.warn(`Modbus write completed for: ${key}`);
            // Read back the value to confirm
            this.logger.warn(`Reading back value from Modbus: ${key}`);
            const readValue = await this.modbusService.readFromModbus(key, mapping);
            this.logger.warn(`Read value from Modbus: ${key}=${readValue} (type: ${typeof readValue})`);
            // Publish the result
            this.mqttService.publishResult(key, readValue);
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
        await this.handleRpcRequest(rpcBody);
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

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
import { ERROR_MESSAGES, STATUS_MESSAGES } from "../constants";
import { Logger } from "../utils/logger";

export class RpcHandler implements IRpcHandler {
    private configService: IConfigService;
    private validationService: IValidationService;
    private modbusService: IModbusService;
    private mqttService: IMqttService;
    private luoiHandler: LuoiMappingHandler;
    private node: any;
    private logger: Logger;

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
     * Handle incoming RPC request with retry logic
     */
    async handleRpcRequest(rpcBody: RpcMessage, maxRetries: number = 3): Promise<void> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (rpcBody.method === "set_state" && rpcBody.params) {
                    this.logger.debug(`Processing RPC request (attempt ${attempt}/${maxRetries})`);
                    await this.handleSetStateRequest(rpcBody.params);
                    return; // Success
                } else {
                    this.logger.debug(`Unsupported RPC method: ${rpcBody.method}`);
                    return; // No need to retry for unsupported methods
                }
            } catch (error) {
                lastError = error as Error;

                // Check if error is retryable
                if (this.isRetryableError(lastError.message) && attempt < maxRetries) {
                    this.logger.debug(`RPC request failed (attempt ${attempt}/${maxRetries}), retrying`);
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
                        this.logger.debug("MQTT disconnected, waiting for reconnection...");
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
                this.logger.debug("All parameters were filtered out due to undefined values");
                this.node.status({ fill: "yellow", shape: "ring", text: "No valid parameters" });
                return;
            }

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
            this.logger.debug(`Filtered out parameters with undefined values: ${filteredKeys.join(", ")}`);
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
        try {
            // Validate and convert value
            const value = this.validationService.validateAndConvertValue(key, rawValue);

            // Check if this is a pump coil (COIL_BOM_1 to COIL_BOM_16) being turned on
            if (this.isPumpCoilBeingTurnedOn(key, value)) {
                await this.handlePumpActivation(key, value, mapping);
            } else {
                // Standard handling for non-pump parameters
                await this.writeToModbusWithRetry(key, mapping, value);
                const readValue = await this.readFromModbusWithRetry(key, mapping);
                await this.publishResultWithRetry(key, readValue);
                this.node.status({ fill: "green", shape: "dot", text: `${key}=${readValue}` });
            }
        } catch (error) {
            this.logger.error(`Failed to process ${key}: ${(error as Error).message}`);
            throw error;
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
                        this.logger.debug("MQTT disconnected, waiting for reconnection...");
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

        this.logger.debug(`Processing batch of ${rpcBodies.length} RPC requests`);

        const results: Array<{ success: boolean; error?: string }> = [];

        for (let i = 0; i < rpcBodies.length; i++) {
            try {
                await this.handleRpcRequest(rpcBodies[i]);
                results.push({ success: true });
            } catch (error) {
                const errorMessage = `Batch request ${i + 1}/${rpcBodies.length} failed: ${(error as Error).message}`;
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
                        this.logger.debug(`[RPC-HANDLER] Attempting reconnection (${attempt}/${maxRetries})...`);

                        try {
                            await this.modbusService.checkConnection();
                            this.logger.debug(`[RPC-HANDLER] Reconnection successful, retrying operation...`);
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
                        this.logger.debug(`[RPC-HANDLER] Attempting reconnection for read (${attempt}/${maxRetries})...`);

                        try {
                            await this.modbusService.checkConnection();
                            this.logger.debug(`[RPC-HANDLER] Reconnection successful, retrying read operation...`);
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
     * Check if the key is a pump coil (COIL_BOM_1 to COIL_BOM_16) being turned on
     */
    private isPumpCoilBeingTurnedOn(key: string, value: any): boolean {
        // Check if key matches COIL_BOM_1 to COIL_BOM_16
        const pumpCoilPattern = /^COIL_BOM_(1[0-6]|[1-9])$/;
        return pumpCoilPattern.test(key) && (value === true || value === 1);
    }

    /**
     * Extract pump number from coil key (e.g., "COIL_BOM_5" -> 5)
     */
    private extractPumpNumber(key: string): number | null {
        const match = key.match(/^COIL_BOM_(\d+)$/);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
        return null;
    }

    /**
     * Handle pump activation with reset logic
     * 1. Reset total volume on board2
     * 2. Confirm reset write
     * 3. Turn on pump on board1
     * 4. Update pump status on board2
     */
    private async handlePumpActivation(key: string, value: any, mapping: any): Promise<void> {
        const pumpNumber = this.extractPumpNumber(key);
        if (pumpNumber === null) {
            this.logger.error(`Failed to extract pump number from key: ${key}`);
            throw new Error(`Invalid pump coil key: ${key}`);
        }

        this.logger.debug(`[PUMP-ACTIVATION] Starting activation for pump ${pumpNumber}`);

        try {
            // Step 1: Reset total volume on board2
            const resetKey = `RESET_TOTAL_VOLUME_BOM_${pumpNumber}`;

            const board2Client = await this.modbusService.getBoard2Client();
            if (!board2Client) {
                throw new Error("Board2 Modbus client not available");
            }

            // Get reset coil mapping from board2
            const resetMapping = this.modbusService.findModbusMappingForBoard(resetKey, 'board2');
            if (!resetMapping) {
                throw new Error(`Reset coil mapping not found: ${resetKey}`);
            }

            // Write reset coil to 1 (true)
            await this.modbusService.writeToModbusBoard(resetKey, resetMapping, 1, 'board2');

            // Step 2: Verify reset write
            const resetValue = await this.modbusService.readFromModbusBoard(resetKey, resetMapping, 'board2');

            // Small delay to ensure reset is processed
            await new Promise(resolve => setTimeout(resolve, 200));

            // Step 3: Turn on pump on board1
            await this.writeToModbusWithRetry(key, mapping, value);
            const pumpValue = await this.readFromModbusWithRetry(key, mapping);

            // Step 4: Update pump status on board2
            const statusKey = `PUMP_STATUS_BOM_${pumpNumber}`;

            const statusMapping = this.modbusService.findModbusMappingForBoard(statusKey, 'board2');
            if (statusMapping) {
                await this.modbusService.writeToModbusBoard(statusKey, statusMapping, 1, 'board2');
            }

            // Publish the result
            await this.publishResultWithRetry(key, pumpValue);
            this.node.status({ fill: "green", shape: "dot", text: `Pump ${pumpNumber} ON (reset done)` });

            this.logger.debug(`[PUMP-ACTIVATION] Completed for pump ${pumpNumber}`);
        } catch (error) {
            this.logger.error(`[PUMP-ACTIVATION] Failed to activate pump ${pumpNumber}: ${(error as Error).message}`);
            throw error;
        }
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

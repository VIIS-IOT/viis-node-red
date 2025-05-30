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
     * Handle incoming RPC request
     */
    async handleRpcRequest(rpcBody: RpcMessage): Promise<void> {
        try {
            if (rpcBody.method === "set_state" && rpcBody.params) {
                this.logger.warn(`Fuck you handleRpcRequest`);
                await this.handleSetStateRequest(rpcBody.params);
            } else {
                this.logger.warn(`Unsupported RPC method: ${rpcBody.method}`);
            }
        } catch (error) {
            const errorMessage = ERROR_MESSAGES.RPC_HANDLING_ERROR + `: ${(error as Error).message}`;
            this.logger.error(errorMessage);
            this.node.status({ fill: "red", shape: "ring", text: "RPC error" });
            throw new Error(errorMessage);
        }
    }

    /**
     * Handle set_state RPC request
     */
    private async handleSetStateRequest(params: Record<string, any>): Promise<void> {
        //Try luoi mapping handler first
        const luoiResult = this.luoiHandler.processRpcBody(params);

        if (luoiResult !== null) {
            await this.handleLuoiResult(luoiResult);
            return;
        }

        // Fallback to standard processing for non-luoi cases
        await this.handleStandardParams(params);
    }

    /**
     * Handle luoi mapping result
     */
    private async handleLuoiResult(luoiResult: any): Promise<void> {
        if ('messages' in luoiResult) {
            // Luoi case - send multiple messages
            this.node.send([luoiResult.messages]);
            this.node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.LUOI_COMMANDS_SENT });
            this.logger.log("Luoi commands sent successfully");
        } else {
            // Standard case - send single message
            this.node.send({ payload: luoiResult.payload });
            this.node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.MODBUS_COMMAND_SENT });
            this.logger.log("Modbus command sent successfully");
        }
    }

    /**
     * Handle standard parameter processing
     */
    private async handleStandardParams(params: Record<string, any>): Promise<void> {
        console.log("handleStandardParams", params)
        for (const [key, rawValue] of Object.entries(params)) {
            await this.processParameter(key, rawValue);
        }
    }

    /**
     * Process a single parameter
     */
    private async processParameter(key: string, rawValue: any): Promise<void> {
        const mapping = this.modbusService.findModbusMapping(key);
        console.log("processParameter", key, rawValue, mapping);
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
            this.logger.warn(`Read value from Modbus: ${key}=${readValue}`);

            // Publish the result
            this.mqttService.publishResult(key, readValue);

            this.logger.warn(`Successfully processed Modbus parameter: ${key}=${readValue}`);
        } catch (error) {
            this.logger.error(`Failed to process Modbus parameter ${key}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Handle parameter that only updates configuration (no Modbus mapping)
     */
    private async handleConfigOnlyParameter(key: string, rawValue: any): Promise<void> {
        try {
            // Validate and convert value
            const value = this.validationService.validateAndConvertValue(key, rawValue);

            // Update configuration
            const currentConfig = this.configService.getConfigKeyValues();
            currentConfig[key] = value;
            this.configService.setConfigKeyValues(currentConfig);

            // Publish the configuration update WITHOUT the note
            await this.mqttService.publishConfigUpdate(key, value);

            this.node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.CONFIG_UPDATED(key) });
            this.logger.log(`Successfully updated config parameter: ${key}=${value}`);
        } catch (error) {
            this.logger.error(`Failed to process config parameter ${key}: ${(error as Error).message}`);
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

        return true;
    }

    /**
     * Process RPC request with validation
     */
    async processRpcRequest(rpcBody: any): Promise<void> {
        if (!this.validateRpcMessage(rpcBody)) {
            throw new Error("Invalid RPC message structure");
        }

        await this.handleRpcRequest(rpcBody);
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

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModbusGetterService = void 0;
const types_1 = require("../interfaces/types");
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
/**
 * Service for handling Modbus getter operations
 */
class ModbusGetterService {
    constructor(serviceOptions, modbusClient) {
        this.serviceOptions = serviceOptions;
        this.modbusClient = modbusClient;
        this.logger = new logger_1.Logger(serviceOptions.node, serviceOptions.nodeId);
    }
    /**
     * Process modbus request and return response
     */
    async processRequest(payload) {
        try {
            // Validate payload
            const validationResult = this.validatePayload(payload);
            if (!validationResult.isValid) {
                return this.createErrorResponse(validationResult.error);
            }
            const request = payload;
            // Log the operation
            this.logger.logModbusOperation("READ", request.address, request.quantity, request.fc);
            // Check if modbus client is ready
            if (!this.isModbusReady()) {
                return this.createErrorResponse(constants_1.ERROR_MESSAGES.MODBUS_CLIENT_NOT_CONNECTED);
            }
            // Execute modbus read operation
            const response = await this.executeModbusRead(request);
            // Log success
            this.logger.logModbusResult("READ", request.address, response.data.length);
            return this.createSuccessResponse(request, response);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.logModbusError("READ", (payload === null || payload === void 0 ? void 0 : payload.address) || 0, errorMessage);
            return this.createErrorResponse(errorMessage);
        }
    }
    /**
     * Validate modbus request payload
     */
    validatePayload(payload) {
        // Check if payload exists and has correct structure
        if (!(0, types_1.isValidModbusRequestPayload)(payload)) {
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_PAYLOAD };
        }
        const { fc, address, quantity } = payload;
        // Validate function code
        const validFunctionCodes = Object.values(constants_1.MODBUS_FUNCTION_CODES);
        if (!validFunctionCodes.includes(fc)) {
            return { isValid: false, error: constants_1.ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE };
        }
        // Validate address
        if (address < constants_1.VALIDATION_LIMITS.MIN_ADDRESS || address > constants_1.VALIDATION_LIMITS.MAX_ADDRESS) {
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_ADDRESS };
        }
        // Validate quantity
        if (quantity < constants_1.VALIDATION_LIMITS.MIN_QUANTITY) {
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_QUANTITY };
        }
        // Check quantity limits based on function code
        const isCoilFunction = fc === constants_1.MODBUS_FUNCTION_CODES.READ_COILS || fc === constants_1.MODBUS_FUNCTION_CODES.READ_DISCRETE_INPUTS;
        const maxQuantity = isCoilFunction ? constants_1.VALIDATION_LIMITS.MAX_QUANTITY_COILS : constants_1.VALIDATION_LIMITS.MAX_QUANTITY_REGISTERS;
        if (quantity > maxQuantity) {
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_QUANTITY };
        }
        return { isValid: true };
    }
    /**
     * Execute modbus read operation based on function code
     */
    async executeModbusRead(request) {
        const { fc, address, quantity } = request;
        let result;
        switch (fc) {
            case constants_1.MODBUS_FUNCTION_CODES.READ_COILS:
                result = await this.modbusClient.readCoils(address, quantity);
                break;
            case constants_1.MODBUS_FUNCTION_CODES.READ_DISCRETE_INPUTS:
                // Note: ModbusClientCore doesn't have readDiscreteInputs method
                // Using readCoils as fallback for discrete inputs
                this.logger.warn("READ_DISCRETE_INPUTS not implemented, using readCoils as fallback");
                result = await this.modbusClient.readCoils(address, quantity);
                break;
            case constants_1.MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS:
                result = await this.modbusClient.readHoldingRegisters(address, quantity);
                break;
            case constants_1.MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
                result = await this.modbusClient.readInputRegisters(address, quantity);
                break;
            default:
                throw new Error(constants_1.ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE);
        }
        // Return ModbusResponse format (without timestamp)
        return {
            address: result.address,
            data: result.data
        };
    }
    /**
     * Check if modbus client is ready
     */
    isModbusReady() {
        return this.modbusClient && this.modbusClient.isConnectedCheck();
    }
    /**
     * Create success response
     */
    createSuccessResponse(request, response) {
        return response.data;
        // return {
        //     success: true,
        //     data: response.data,
        //     address: request.address,
        //     quantity: request.quantity,
        //     functionCode: request.fc,
        //     timestamp: Date.now()
        // };
    }
    /**
     * Create error response
     */
    createErrorResponse(error) {
        return {
            error,
            timestamp: Date.now()
        };
    }
}
exports.ModbusGetterService = ModbusGetterService;

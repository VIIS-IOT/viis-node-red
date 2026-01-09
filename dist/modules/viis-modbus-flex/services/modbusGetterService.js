"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModbusGetterService = void 0;
const types_1 = require("../interfaces/types");
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
/**
 * Service for handling Modbus flex operations (read and write)
 */
class ModbusGetterService {
    constructor(serviceOptions, modbusClient) {
        this.serviceOptions = serviceOptions;
        this.modbusClient = modbusClient;
        this.logger = new logger_1.Logger(serviceOptions.node, serviceOptions.nodeId, serviceOptions.enableLogging);
    }
    /**
     * Process modbus request and return response
     * Supports both READ and WRITE operations
     */
    async processRequest(payload) {
        try {
            // Log incoming request if logging is enabled
            this.logger.logRequest(payload);
            // Determine if this is a READ or WRITE operation based on function code
            const fc = payload === null || payload === void 0 ? void 0 : payload.fc;
            if (fc && [5, 6, 15, 16].includes(fc)) {
                // WRITE operation
                return await this.processWriteRequest(payload);
            }
            else {
                // READ operation (default)
                return await this.processReadRequest(payload);
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.logModbusError("PROCESS", (payload === null || payload === void 0 ? void 0 : payload.address) || 0, errorMessage);
            return this.createErrorResponse(errorMessage);
        }
    }
    /**
     * Process modbus READ request
     */
    async processReadRequest(payload) {
        try {
            // Validate payload
            const validationResult = this.validatePayload(payload);
            if (!validationResult.isValid) {
                this.logger.error(`Validation failed: ${validationResult.error}`);
                return this.createErrorResponse(validationResult.error);
            }
            const request = payload;
            // Log the operation
            // this.logger.logModbusOperation("READ", request.address, request.quantity, request.fc);
            // Check if modbus client is ready
            if (!this.isModbusReady()) {
                this.logger.error("Modbus client not connected");
                return this.createErrorResponse(constants_1.ERROR_MESSAGES.MODBUS_CLIENT_NOT_CONNECTED);
            }
            // Execute modbus read operation
            const response = await this.executeModbusRead(request);
            // Log success
            this.logger.logModbusResult("READ", request.address, response.data.length);
            // Create and log response
            const successResponse = this.createSuccessResponse(request, response);
            this.logger.logResponse(successResponse);
            return successResponse;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.logModbusError("READ", (payload === null || payload === void 0 ? void 0 : payload.address) || 0, errorMessage);
            return this.createErrorResponse(errorMessage);
        }
    }
    /**
     * Process modbus WRITE request
     */
    async processWriteRequest(payload) {
        try {
            // Validate write payload
            const validationResult = this.validateWritePayload(payload);
            if (!validationResult.isValid) {
                this.logger.error(`Write validation failed: ${validationResult.error}`);
                return this.createErrorResponse(validationResult.error);
            }
            const request = payload;
            // Check if modbus client is ready
            if (!this.isModbusReady()) {
                this.logger.error("Modbus client not connected");
                return this.createErrorResponse(constants_1.ERROR_MESSAGES.MODBUS_CLIENT_NOT_CONNECTED);
            }
            // Execute modbus write operation
            await this.executeModbusWrite(request);
            // Log success
            this.logger.logModbusResult("WRITE", request.address, 1);
            // Create success response for write operation
            const successResponse = {
                success: true,
                address: request.address,
                functionCode: request.fc,
                value: request.value,
                timestamp: Date.now()
            };
            this.logger.logResponse(successResponse);
            return successResponse;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.logModbusError("WRITE", (payload === null || payload === void 0 ? void 0 : payload.address) || 0, errorMessage);
            return this.createErrorResponse(errorMessage);
        }
    }
    /**
     * Validate modbus write request payload
     */
    validateWritePayload(payload) {
        // Check if payload exists and has correct structure
        if (!(0, types_1.isValidModbusWriteRequestPayload)(payload)) {
            this.logger.debug("Invalid write payload structure");
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_PAYLOAD };
        }
        const { fc, address, value } = payload;
        // Validate function code (write codes: 5, 6, 15, 16)
        const validWriteFunctionCodes = [
            constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
            constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER,
            constants_1.MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_COILS,
            constants_1.MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS
        ];
        if (!validWriteFunctionCodes.includes(fc)) {
            this.logger.debug(`Invalid write function code: ${fc}`);
            return { isValid: false, error: constants_1.ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE };
        }
        // Validate address
        if (address < constants_1.VALIDATION_LIMITS.MIN_ADDRESS || address > constants_1.VALIDATION_LIMITS.MAX_ADDRESS) {
            this.logger.debug(`Invalid address: ${address}`);
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_ADDRESS };
        }
        // Validate value based on function code
        if (fc === constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL) {
            // Single coil: value must be boolean
            if (typeof value !== 'boolean') {
                this.logger.debug(`Invalid value type for write coil: ${typeof value}`);
                return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_VALUE };
            }
        }
        else if (fc === constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER) {
            // Single register: value must be number within range
            if (typeof value !== 'number' || value < constants_1.VALIDATION_LIMITS.MIN_REGISTER_VALUE || value > constants_1.VALIDATION_LIMITS.MAX_REGISTER_VALUE) {
                this.logger.debug(`Invalid register value: ${value}`);
                return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_VALUE };
            }
        }
        else if (fc === constants_1.MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_COILS) {
            // Multiple coils: value must be boolean array
            if (!Array.isArray(value) || !value.every(v => typeof v === 'boolean')) {
                this.logger.debug(`Invalid value type for write multiple coils`);
                return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_VALUE };
            }
            if (value.length > constants_1.VALIDATION_LIMITS.MAX_WRITE_MULTIPLE_COILS) {
                this.logger.debug(`Too many coils to write: ${value.length}`);
                return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_QUANTITY };
            }
        }
        else if (fc === constants_1.MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS) {
            // Multiple registers: value must be number array
            if (!Array.isArray(value) || !value.every(v => typeof v === 'number' && v >= constants_1.VALIDATION_LIMITS.MIN_REGISTER_VALUE && v <= constants_1.VALIDATION_LIMITS.MAX_REGISTER_VALUE)) {
                this.logger.debug(`Invalid value type for write multiple registers`);
                return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_VALUE };
            }
            if (value.length > constants_1.VALIDATION_LIMITS.MAX_WRITE_MULTIPLE_REGISTERS) {
                this.logger.debug(`Too many registers to write: ${value.length}`);
                return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_QUANTITY };
            }
        }
        this.logger.debug("Write payload validation successful");
        return { isValid: true };
    }
    /**
     * Execute modbus write operation based on function code
     */
    async executeModbusWrite(request) {
        const { fc, address, value } = request;
        this.logger.debug(`Executing modbus write: FC=${fc}, Address=${address}, Value=${JSON.stringify(value)}`);
        switch (fc) {
            case constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL:
                this.logger.debug("Writing single coil...");
                await this.modbusClient.writeCoil(address, value);
                break;
            case constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER:
                this.logger.debug("Writing single register...");
                await this.modbusClient.writeRegister(address, value);
                break;
            case constants_1.MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_COILS:
                this.logger.debug("Writing multiple coils...");
                // Write coils one by one since writeMultipleCoils is not available
                const coilValues = value;
                for (let i = 0; i < coilValues.length; i++) {
                    await this.modbusClient.writeCoil(address + i, coilValues[i]);
                }
                break;
            case constants_1.MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS:
                this.logger.debug("Writing multiple registers...");
                // Write registers one by one since writeMultipleRegisters is not available
                const registerValues = value;
                for (let i = 0; i < registerValues.length; i++) {
                    await this.modbusClient.writeRegister(address + i, registerValues[i]);
                }
                break;
            default:
                this.logger.error(`Unsupported write function code: ${fc}`);
                throw new Error(constants_1.ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE);
        }
        this.logger.debug(`Modbus write completed successfully`);
    }
    /**
     * Validate modbus request payload
     */
    validatePayload(payload) {
        // Check if payload exists and has correct structure
        if (!(0, types_1.isValidModbusRequestPayload)(payload)) {
            this.logger.debug("Invalid payload structure");
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_PAYLOAD };
        }
        const { fc, address, quantity } = payload;
        // Validate function code
        const validFunctionCodes = Object.values(constants_1.MODBUS_FUNCTION_CODES);
        if (!validFunctionCodes.includes(fc)) {
            this.logger.debug(`Invalid function code: ${fc}`);
            return { isValid: false, error: constants_1.ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE };
        }
        // Validate address
        if (address < constants_1.VALIDATION_LIMITS.MIN_ADDRESS || address > constants_1.VALIDATION_LIMITS.MAX_ADDRESS) {
            this.logger.debug(`Invalid address: ${address}`);
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_ADDRESS };
        }
        // Validate quantity
        if (quantity < constants_1.VALIDATION_LIMITS.MIN_QUANTITY) {
            this.logger.debug(`Invalid quantity: ${quantity}`);
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_QUANTITY };
        }
        // Check quantity limits based on function code
        const isCoilFunction = fc === constants_1.MODBUS_FUNCTION_CODES.READ_COILS || fc === constants_1.MODBUS_FUNCTION_CODES.READ_DISCRETE_INPUTS;
        const maxQuantity = isCoilFunction ? constants_1.VALIDATION_LIMITS.MAX_QUANTITY_COILS : constants_1.VALIDATION_LIMITS.MAX_QUANTITY_REGISTERS;
        if (quantity > maxQuantity) {
            this.logger.debug(`Quantity exceeds limit: ${quantity} > ${maxQuantity}`);
            return { isValid: false, error: constants_1.ERROR_MESSAGES.INVALID_QUANTITY };
        }
        this.logger.debug("Payload validation successful");
        return { isValid: true };
    }
    /**
     * Execute modbus read operation based on function code
     */
    async executeModbusRead(request) {
        const { fc, address, quantity } = request;
        this.logger.debug(`Executing modbus read: FC=${fc}, Address=${address}, Quantity=${quantity}`);
        let result;
        switch (fc) {
            case constants_1.MODBUS_FUNCTION_CODES.READ_COILS:
                this.logger.debug("Reading coils...");
                result = await this.modbusClient.readCoils(address, quantity);
                break;
            case constants_1.MODBUS_FUNCTION_CODES.READ_DISCRETE_INPUTS:
                // Note: ModbusClientCore doesn't have readDiscreteInputs method
                // Using readCoils as fallback for discrete inputs
                this.logger.warn("READ_DISCRETE_INPUTS not implemented, using readCoils as fallback");
                this.logger.debug("Reading discrete inputs (fallback to coils)...");
                result = await this.modbusClient.readCoils(address, quantity);
                break;
            case constants_1.MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS:
                this.logger.debug("Reading holding registers...");
                result = await this.modbusClient.readHoldingRegisters(address, quantity);
                break;
            case constants_1.MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
                this.logger.debug("Reading input registers...");
                result = await this.modbusClient.readInputRegisters(address, quantity);
                break;
            default:
                this.logger.error(`Unsupported function code: ${fc}`);
                throw new Error(constants_1.ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE);
        }
        this.logger.debug(`Modbus read completed. Data length: ${result.data.length}`);
        // Return ModbusResponse format
        return {
            address: result.address,
            data: result.data
        };
    }
    /**
     * Check if modbus client is ready
     */
    isModbusReady() {
        const isReady = this.modbusClient && this.modbusClient.isConnectedCheck();
        this.logger.debug(`Modbus client ready status: ${isReady}`);
        return isReady;
    }
    /**
     * Create success response
     */
    createSuccessResponse(request, response) {
        // Return just the data array as per your current implementation
        return response.data;
        // Uncomment below if you want full response object
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
        const errorResponse = {
            error,
            timestamp: Date.now()
        };
        this.logger.debug(`Created error response: ${JSON.stringify(errorResponse)}`);
        return errorResponse;
    }
    /**
     * Update logging state
     */
    updateLoggingState(enableLogging) {
        this.serviceOptions.enableLogging = enableLogging;
        this.logger.setLoggingEnabled(enableLogging);
    }
}
exports.ModbusGetterService = ModbusGetterService;

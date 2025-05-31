import { ModbusClientCore } from "../../../core/modbus-client";
import {
    ModbusRequestPayload,
    ModbusResponse,
    ServiceOptions,
    SuccessResponse,
    ErrorResponse,
    isValidModbusRequestPayload
} from "../interfaces/types";
import {
    MODBUS_FUNCTION_CODES,
    ERROR_MESSAGES,
    VALIDATION_LIMITS
} from "../constants";
import { Logger } from "../utils/logger";

/**
 * Service for handling Modbus getter operations
 */
export class ModbusGetterService {
    private modbusClient: ModbusClientCore;
    private logger: Logger;
    private serviceOptions: ServiceOptions;

    constructor(serviceOptions: ServiceOptions, modbusClient: ModbusClientCore) {
        this.serviceOptions = serviceOptions;
        this.modbusClient = modbusClient;
        this.logger = new Logger(serviceOptions.node, serviceOptions.nodeId);
    }

    /**
     * Process modbus request and return response
     */
    async processRequest(payload: any): Promise<SuccessResponse | ErrorResponse> {
        try {
            // Validate payload
            const validationResult = this.validatePayload(payload);
            if (!validationResult.isValid) {
                return this.createErrorResponse(validationResult.error!);
            }

            const request = payload as ModbusRequestPayload;

            // Log the operation
            this.logger.logModbusOperation("READ", request.address, request.quantity, request.fc);

            // Check if modbus client is ready
            if (!this.isModbusReady()) {
                return this.createErrorResponse(ERROR_MESSAGES.MODBUS_CLIENT_NOT_CONNECTED);
            }

            // Execute modbus read operation
            const response = await this.executeModbusRead(request);

            // Log success
            this.logger.logModbusResult("READ", request.address, response.data.length);

            return this.createSuccessResponse(request, response);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.logModbusError("READ", payload?.address || 0, errorMessage);
            return this.createErrorResponse(errorMessage);
        }
    }

    /**
     * Validate modbus request payload
     */
    private validatePayload(payload: any): { isValid: boolean; error?: string } {
        // Check if payload exists and has correct structure
        if (!isValidModbusRequestPayload(payload)) {
            return { isValid: false, error: ERROR_MESSAGES.INVALID_PAYLOAD };
        }

        const { fc, address, quantity } = payload;

        // Validate function code
        const validFunctionCodes = Object.values(MODBUS_FUNCTION_CODES) as number[];
        if (!validFunctionCodes.includes(fc)) {
            return { isValid: false, error: ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE };
        }

        // Validate address
        if (address < VALIDATION_LIMITS.MIN_ADDRESS || address > VALIDATION_LIMITS.MAX_ADDRESS) {
            return { isValid: false, error: ERROR_MESSAGES.INVALID_ADDRESS };
        }

        // Validate quantity
        if (quantity < VALIDATION_LIMITS.MIN_QUANTITY) {
            return { isValid: false, error: ERROR_MESSAGES.INVALID_QUANTITY };
        }

        // Check quantity limits based on function code
        const isCoilFunction = fc === MODBUS_FUNCTION_CODES.READ_COILS || fc === MODBUS_FUNCTION_CODES.READ_DISCRETE_INPUTS;
        const maxQuantity = isCoilFunction ? VALIDATION_LIMITS.MAX_QUANTITY_COILS : VALIDATION_LIMITS.MAX_QUANTITY_REGISTERS;

        if (quantity > maxQuantity) {
            return { isValid: false, error: ERROR_MESSAGES.INVALID_QUANTITY };
        }

        return { isValid: true };
    }

    /**
     * Execute modbus read operation based on function code
     */
    private async executeModbusRead(request: ModbusRequestPayload): Promise<ModbusResponse> {
        const { fc, address, quantity } = request;

        let result;
        switch (fc) {
            case MODBUS_FUNCTION_CODES.READ_COILS:
                result = await this.modbusClient.readCoils(address, quantity);
                break;

            case MODBUS_FUNCTION_CODES.READ_DISCRETE_INPUTS:
                // Note: ModbusClientCore doesn't have readDiscreteInputs method
                // Using readCoils as fallback for discrete inputs
                this.logger.warn("READ_DISCRETE_INPUTS not implemented, using readCoils as fallback");
                result = await this.modbusClient.readCoils(address, quantity);
                break;

            case MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS:
                result = await this.modbusClient.readHoldingRegisters(address, quantity);
                break;

            case MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
                result = await this.modbusClient.readInputRegisters(address, quantity);
                break;

            default:
                throw new Error(ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE);
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
    private isModbusReady(): boolean {
        return this.modbusClient && this.modbusClient.isConnectedCheck();
    }

    /**
     * Create success response
     */
    private createSuccessResponse(request: ModbusRequestPayload, response: ModbusResponse): any {
        return response.data
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
    private createErrorResponse(error: string): ErrorResponse {
        return {
            error,
            timestamp: Date.now()
        };
    }
}

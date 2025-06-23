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
        this.logger = new Logger(
            serviceOptions.node,
            serviceOptions.nodeId,
            serviceOptions.enableLogging
        );
    }

    /**
     * Process modbus request and return response
     */
    async processRequest(payload: any): Promise<SuccessResponse | ErrorResponse> {
        try {
            // Log incoming request if logging is enabled
            this.logger.logRequest(payload);

            // Validate payload
            const validationResult = this.validatePayload(payload);
            if (!validationResult.isValid) {
                this.logger.error(`Validation failed: ${validationResult.error}`);
                return this.createErrorResponse(validationResult.error!);
            }

            const request = payload as ModbusRequestPayload;

            // Log the operation
            // this.logger.logModbusOperation("READ", request.address, request.quantity, request.fc);

            // Check if modbus client is ready
            if (!this.isModbusReady()) {
                this.logger.error("Modbus client not connected");
                return this.createErrorResponse(ERROR_MESSAGES.MODBUS_CLIENT_NOT_CONNECTED);
            }

            // Execute modbus read operation
            const response = await this.executeModbusRead(request);

            // Log success
            this.logger.logModbusResult("READ", request.address, response.data.length);

            // Create and log response
            const successResponse = this.createSuccessResponse(request, response);
            this.logger.logResponse(successResponse);

            return successResponse;

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
            this.logger.debug("Invalid payload structure");
            return { isValid: false, error: ERROR_MESSAGES.INVALID_PAYLOAD };
        }

        const { fc, address, quantity } = payload;

        // Validate function code
        const validFunctionCodes = Object.values(MODBUS_FUNCTION_CODES) as number[];
        if (!validFunctionCodes.includes(fc)) {
            this.logger.debug(`Invalid function code: ${fc}`);
            return { isValid: false, error: ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE };
        }

        // Validate address
        if (address < VALIDATION_LIMITS.MIN_ADDRESS || address > VALIDATION_LIMITS.MAX_ADDRESS) {
            this.logger.debug(`Invalid address: ${address}`);
            return { isValid: false, error: ERROR_MESSAGES.INVALID_ADDRESS };
        }

        // Validate quantity
        if (quantity < VALIDATION_LIMITS.MIN_QUANTITY) {
            this.logger.debug(`Invalid quantity: ${quantity}`);
            return { isValid: false, error: ERROR_MESSAGES.INVALID_QUANTITY };
        }

        // Check quantity limits based on function code
        const isCoilFunction = fc === MODBUS_FUNCTION_CODES.READ_COILS || fc === MODBUS_FUNCTION_CODES.READ_DISCRETE_INPUTS;
        const maxQuantity = isCoilFunction ? VALIDATION_LIMITS.MAX_QUANTITY_COILS : VALIDATION_LIMITS.MAX_QUANTITY_REGISTERS;

        if (quantity > maxQuantity) {
            this.logger.debug(`Quantity exceeds limit: ${quantity} > ${maxQuantity}`);
            return { isValid: false, error: ERROR_MESSAGES.INVALID_QUANTITY };
        }

        this.logger.debug("Payload validation successful");
        return { isValid: true };
    }

    /**
     * Execute modbus read operation based on function code
     */
    private async executeModbusRead(request: ModbusRequestPayload): Promise<ModbusResponse> {
        const { fc, address, quantity } = request;

        this.logger.debug(`Executing modbus read: FC=${fc}, Address=${address}, Quantity=${quantity}`);

        let result;
        switch (fc) {
            case MODBUS_FUNCTION_CODES.READ_COILS:
                this.logger.debug("Reading coils...");
                result = await this.modbusClient.readCoils(address, quantity);
                break;

            case MODBUS_FUNCTION_CODES.READ_DISCRETE_INPUTS:
                // Note: ModbusClientCore doesn't have readDiscreteInputs method
                // Using readCoils as fallback for discrete inputs
                this.logger.warn("READ_DISCRETE_INPUTS not implemented, using readCoils as fallback");
                this.logger.debug("Reading discrete inputs (fallback to coils)...");
                result = await this.modbusClient.readCoils(address, quantity);
                break;

            case MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS:
                this.logger.debug("Reading holding registers...");
                result = await this.modbusClient.readHoldingRegisters(address, quantity);
                break;

            case MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
                this.logger.debug("Reading input registers...");
                result = await this.modbusClient.readInputRegisters(address, quantity);
                break;

            default:
                this.logger.error(`Unsupported function code: ${fc}`);
                throw new Error(ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE);
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
    private isModbusReady(): boolean {
        const isReady = this.modbusClient && this.modbusClient.isConnectedCheck();
        this.logger.debug(`Modbus client ready status: ${isReady}`);
        return isReady;
    }

    /**
     * Create success response
     */
    private createSuccessResponse(request: ModbusRequestPayload, response: ModbusResponse): any {
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
    private createErrorResponse(error: string): ErrorResponse {
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
    updateLoggingState(enableLogging: boolean): void {
        this.serviceOptions.enableLogging = enableLogging;
        this.logger.setLoggingEnabled(enableLogging);
    }
}
import { ModbusClientCore } from "../../../core/modbus-client";
import {
    ModbusRequestPayload,
    ModbusWriteRequestPayload,
    ModbusResponse,
    ServiceOptions,
    SuccessResponse,
    ErrorResponse,
    isValidModbusRequestPayload,
    isValidModbusWriteRequestPayload
} from "../interfaces/types";
import {
    MODBUS_FUNCTION_CODES,
    ERROR_MESSAGES,
    VALIDATION_LIMITS
} from "../constants";
import { Logger } from "../utils/logger";
import { getArbiter } from "../../viis-actuator-arbiter/arbiter-registry";
import type { ActuatorArbiterApi } from "../../viis-actuator-arbiter/arbiter-api";

/**
 * Where a write came from. Only the OFFLINE intent chain ("Intent actions -> Modbus commands") is a claim
 * source of the actuator arbiter: `key` is the action key (`msg.offlineKey`), `intentId` the intent,
 * `boardId` the board the node writes to (payload.boardId, else the node's board; null when unknown).
 */
export interface OfflineWriteOrigin {
    key: string | null;
    intentId: string | null;
    boardId?: string | null;
}

/**
 * The origin of a write that comes from the OFFLINE intent chain (`msg.source === 'intent'`, or the node's
 * `writeSource` config is `intent`); null for every other write.
 */
export function offlineWriteOrigin(msg: any, writeSource: string | undefined, boardId?: string | null): OfflineWriteOrigin | null {
    if (!msg || (msg.source !== "intent" && writeSource !== "intent")) {
        return null;
    }
    const key = msg.offlineKey;
    const intentId = msg.offlineIntentId ?? msg.intentId;
    const origin: OfflineWriteOrigin = {
        key: typeof key === "string" && key !== "" ? key : null,
        intentId: intentId === undefined || intentId === null || intentId === "" ? null : String(intentId),
    };
    if (boardId !== undefined) {
        origin.boardId = typeof boardId === "string" && boardId !== "" ? boardId : null;
    }
    return origin;
}

/**
 * Service for handling Modbus flex operations (read and write)
 */
export class ModbusGetterService {
    private modbusClient: ModbusClientCore;
    private logger: Logger;
    private serviceOptions: ServiceOptions;
    
    // Retry configuration for serial port operations
    private readonly MAX_RETRY_ATTEMPTS = 3;
    private readonly RETRY_BASE_DELAY_MS = 500;
    private readonly RETRY_MAX_DELAY_MS = 3000;
    private readonly SERIAL_PORT_ERRORS = [
        "Resource temporarily unavailable",
        "Cannot lock port",
        "Port is busy",
        "EACCES",
        "EBUSY",
        "timeout"
    ];

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
     * Check if error is related to serial port locking
     */
    private isSerialPortError(error: string): boolean {
        return this.SERIAL_PORT_ERRORS.some(err => error.includes(err));
    }

    /**
     * Calculate retry delay with exponential backoff + jitter
     */
    private calculateRetryDelay(attempt: number): number {
        const exponentialDelay = this.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.random() * 200; // Add 0-200ms jitter to avoid thundering herd
        return Math.min(exponentialDelay + jitter, this.RETRY_MAX_DELAY_MS);
    }

    /**
     * Execute operation with retry logic for serial port errors
     * Enhanced to detect USB serial failures that need port recovery
     */
    private async executeWithRetry<T>(
        operation: () => Promise<T>,
        operationName: string,
        address: number
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < this.MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                return await operation();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                lastError = error as Error;

                // Check if this is a retryable serial port error
                if (this.isSerialPortError(errorMessage)) {
                    const isLastAttempt = attempt === this.MAX_RETRY_ATTEMPTS - 1;

                    if (!isLastAttempt) {
                        const retryDelay = this.calculateRetryDelay(attempt);
                        this.logger.warn(
                            `[RETRY] ${operationName} failed at addr ${address}: ${errorMessage}. ` +
                            `Retrying in ${retryDelay}ms (attempt ${attempt + 1}/${this.MAX_RETRY_ATTEMPTS})`
                        );

                        // Wait before retry
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        continue;
                    } else {
                        // Last attempt failed - check if this might be a USB error needing recovery
                        const isUsbError = errorMessage.includes("EPIPE") ||
                                          errorMessage.includes("Resource temporarily unavailable") ||
                                          errorMessage.includes("Cannot lock port");
                        
                        if (isUsbError) {
                            this.logger.warn(
                                `[USB-ERROR] ${operationName} at addr ${address}: All retries exhausted. ` +
                                `This appears to be a USB serial port failure. The ModbusClientCore will trigger automatic recovery.`
                            );
                        }
                    }
                }

                // Non-retryable error or last attempt failed
                break;
            }
        }

        // All retries exhausted
        throw lastError;
    }

    /**
     * Process modbus request and return response
     * Supports both READ and WRITE operations
     */
    async processRequest(payload: any, origin: OfflineWriteOrigin | null = null): Promise<SuccessResponse | ErrorResponse> {
        try {
            // Log incoming request if logging is enabled
            this.logger.logRequest(payload);

            // Determine if this is a READ or WRITE operation based on function code
            const fc = payload?.fc;

            if (fc && [5, 6, 15, 16].includes(fc)) {
                // WRITE operation
                return await this.processWriteRequest(payload, origin);
            } else {
                // READ operation (default)
                return await this.processReadRequest(payload);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.logModbusError("PROCESS", payload?.address || 0, errorMessage);
            return this.createErrorResponse(errorMessage);
        }
    }

    /**
     * Process modbus READ request
     */
    private async processReadRequest(payload: any): Promise<SuccessResponse | ErrorResponse> {
        try {
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
     * Process modbus WRITE request
     */
    private async processWriteRequest(payload: any, origin: OfflineWriteOrigin | null = null): Promise<SuccessResponse | ErrorResponse> {
        try {
            // Validate write payload
            const validationResult = this.validateWritePayload(payload);
            if (!validationResult.isValid) {
                this.logger.error(`Write validation failed: ${validationResult.error}`);
                return this.createErrorResponse(validationResult.error!);
            }

            const request = payload as ModbusWriteRequestPayload;

            // ARBITER_MODE=enforce: an OFFLINE scenario write to a managed coil is a claim, not a write.
            // observe: the same claim is recorded and the coil is still written directly.
            const arbiter = request.fc === MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL && origin?.key ? getArbiter() : null;
            // Only `managed` keys: a `hold` key keeps its direct write, as the schedule executor does.
            if (arbiter && arbiter.keyMode(origin!.key!) === "managed") {
                // Only when the write goes to the coil the arbiter reconciles for that key: an explicit
                // fc/address/boardId in the action may point elsewhere, and that address must still be written.
                const target = arbiter.target(origin!.key!);
                const sameCoil = target !== undefined
                    && Number(target.address) === Number(request.address)
                    && (!origin!.boardId || target.boardId === origin!.boardId);
                if (sameCoil && arbiter.mode() === "enforce") {
                    return await this.claimThroughArbiter(arbiter, request, origin!);
                }
                if (sameCoil) {
                    this.recordObserveClaim(arbiter, request, origin!);
                } else {
                    this.logger.warn(
                        `[ARBITER] ${origin!.key} is managed but this write targets ${origin!.boardId ?? "?"}:${request.address}`
                        + ` (arbiter coil ${target ? `${target.boardId}:${target.address}` : "none"}); written directly`
                    );
                }
            }

            // Check if modbus client is ready
            if (!this.isModbusReady()) {
                this.logger.error("Modbus client not connected");
                return this.createErrorResponse(ERROR_MESSAGES.MODBUS_CLIENT_NOT_CONNECTED);
            }

            // Execute modbus write operation
            await this.executeModbusWrite(request);

            // Log success
            this.logger.logModbusResult("WRITE", request.address, 1);

            // Create success response for write operation
            const successResponse: SuccessResponse = {
                success: true,
                address: request.address,
                functionCode: request.fc,
                value: request.value,
                timestamp: Date.now()
            };
            this.logger.logResponse(successResponse);

            return successResponse;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.logModbusError("WRITE", payload?.address || 0, errorMessage);
            return this.createErrorResponse(errorMessage);
        }
    }

    /** observe: the claim enforce would submit, without waiting for it; the direct write that follows is today's. */
    private recordObserveClaim(arbiter: ActuatorArbiterApi, request: ModbusWriteRequestPayload, origin: OfflineWriteOrigin): void {
        const key = origin.key!;
        void arbiter
            .claim({
                key,
                value: request.value as boolean,
                source: "scenario",
                ownerId: `offline:${origin.intentId || "local"}`,
                expiresAt: Date.now() + arbiter.leaseMs("scenario", key),
            })
            .catch((error) => {
                this.logger.warn(`[ARBITER] Observe claim for ${key} not recorded: ${(error as Error).message}`);
            });
    }

    /**
     * enforce: the claim `offline:<intentId>` (source `scenario`, lease ARBITER_SCENARIO_LEASE_S) replaces the
     * write; a repeat of the same intent refreshes it. Success only when this claim won and the coil reads the
     * value. A claim that lost is withdrawn (the trigger reports the action failed, so it must not take effect
     * later); a won claim not on the coil yet stays and the arbiter keeps reconciling it.
     */
    private async claimThroughArbiter(
        arbiter: ActuatorArbiterApi,
        request: ModbusWriteRequestPayload,
        origin: OfflineWriteOrigin
    ): Promise<SuccessResponse | ErrorResponse> {
        const key = origin.key!;
        const value = request.value as boolean;
        const ownerId = `offline:${origin.intentId || "local"}`;
        this.logger.log(`[ARBITER] Claim ${key}=${value} (${ownerId})`);
        const result = await arbiter.claim({
            key,
            value,
            source: "scenario",
            ownerId,
            expiresAt: Date.now() + arbiter.leaseMs("scenario", key),
        });

        if (!result.applied) {
            try {
                await arbiter.release(ownerId, key);
            } catch (error) {
                this.logger.warn(`[ARBITER] Could not withdraw blocked claim ${ownerId}: ${(error as Error).message}`);
            }
            return this.createErrorResponse(`blocked_by:${result.blockedBy ?? "expired"}`);
        }
        if (result.actual !== value) {
            return this.createErrorResponse(`not_confirmed:${key} reads ${String(result.actual)}; the arbiter keeps the claim and retries`);
        }

        const successResponse: SuccessResponse = {
            success: true,
            address: request.address,
            functionCode: request.fc,
            value: request.value,
            timestamp: Date.now()
        };
        this.logger.logResponse(successResponse);
        return successResponse;
    }

    /**
     * Validate modbus write request payload
     */
    private validateWritePayload(payload: any): { isValid: boolean; error?: string } {
        // Check if payload exists and has correct structure
        if (!isValidModbusWriteRequestPayload(payload)) {
            this.logger.debug("Invalid write payload structure");
            return { isValid: false, error: ERROR_MESSAGES.INVALID_PAYLOAD };
        }

        const { fc, address, value } = payload;

        // Validate function code (write codes: 5, 6, 15, 16)
        const validWriteFunctionCodes: number[] = [
            MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
            MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER,
            MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_COILS,
            MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS
        ];
        if (!validWriteFunctionCodes.includes(fc)) {
            this.logger.debug(`Invalid write function code: ${fc}`);
            return { isValid: false, error: ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE };
        }

        // Validate address
        if (address < VALIDATION_LIMITS.MIN_ADDRESS || address > VALIDATION_LIMITS.MAX_ADDRESS) {
            this.logger.debug(`Invalid address: ${address}`);
            return { isValid: false, error: ERROR_MESSAGES.INVALID_ADDRESS };
        }

        // Validate value based on function code
        if (fc === MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL) {
            // Single coil: value must be boolean
            if (typeof value !== 'boolean') {
                this.logger.debug(`Invalid value type for write coil: ${typeof value}`);
                return { isValid: false, error: ERROR_MESSAGES.INVALID_VALUE };
            }
        } else if (fc === MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER) {
            // Single register: value must be number within range
            if (typeof value !== 'number' || value < VALIDATION_LIMITS.MIN_REGISTER_VALUE || value > VALIDATION_LIMITS.MAX_REGISTER_VALUE) {
                this.logger.debug(`Invalid register value: ${value}`);
                return { isValid: false, error: ERROR_MESSAGES.INVALID_VALUE };
            }
        } else if (fc === MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_COILS) {
            // Multiple coils: value must be boolean array
            if (!Array.isArray(value) || !value.every(v => typeof v === 'boolean')) {
                this.logger.debug(`Invalid value type for write multiple coils`);
                return { isValid: false, error: ERROR_MESSAGES.INVALID_VALUE };
            }
            if (value.length > VALIDATION_LIMITS.MAX_WRITE_MULTIPLE_COILS) {
                this.logger.debug(`Too many coils to write: ${value.length}`);
                return { isValid: false, error: ERROR_MESSAGES.INVALID_QUANTITY };
            }
        } else if (fc === MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS) {
            // Multiple registers: value must be number array
            if (!Array.isArray(value) || !value.every(v => typeof v === 'number' && v >= VALIDATION_LIMITS.MIN_REGISTER_VALUE && v <= VALIDATION_LIMITS.MAX_REGISTER_VALUE)) {
                this.logger.debug(`Invalid value type for write multiple registers`);
                return { isValid: false, error: ERROR_MESSAGES.INVALID_VALUE };
            }
            if (value.length > VALIDATION_LIMITS.MAX_WRITE_MULTIPLE_REGISTERS) {
                this.logger.debug(`Too many registers to write: ${value.length}`);
                return { isValid: false, error: ERROR_MESSAGES.INVALID_QUANTITY };
            }
        }

        this.logger.debug("Write payload validation successful");
        return { isValid: true };
    }

    /**
     * Execute modbus write operation based on function code
     */
    private async executeModbusWrite(request: ModbusWriteRequestPayload): Promise<void> {
        const { fc, address, value } = request;

        this.logger.debug(`Executing modbus write: FC=${fc}, Address=${address}, Value=${JSON.stringify(value)}`);

        // Wrap write operations with retry logic
        const writeOperation = async () => {
            switch (fc) {
                case MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL:
                    this.logger.debug("Writing single coil...");
                    await this.modbusClient.writeCoil(address, value as boolean);
                    break;

                case MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER:
                    this.logger.debug("Writing single register...");
                    await this.modbusClient.writeRegister(address, value as number);
                    break;

                case MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_COILS:
                    this.logger.debug("Writing multiple coils...");
                    // Write coils one by one since writeMultipleCoils is not available
                    const coilValues = value as boolean[];
                    for (let i = 0; i < coilValues.length; i++) {
                        await this.modbusClient.writeCoil(address + i, coilValues[i]);
                    }
                    break;

                case MODBUS_FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS:
                    this.logger.debug("Writing multiple registers...");
                    // Write registers one by one since writeMultipleRegisters is not available
                    const registerValues = value as number[];
                    for (let i = 0; i < registerValues.length; i++) {
                        await this.modbusClient.writeRegister(address + i, registerValues[i]);
                    }
                    break;

                default:
                    this.logger.error(`Unsupported write function code: ${fc}`);
                    throw new Error(ERROR_MESSAGES.UNSUPPORTED_FUNCTION_CODE);
            }

            this.logger.debug(`Modbus write completed successfully`);
        };

        // Execute with retry for serial port errors
        await this.executeWithRetry(
            writeOperation,
            `WRITE_FC${fc}`,
            address
        );
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

        // Wrap read operations with retry logic
        const readOperation = async () => {
            let result;
            switch (fc) {
                case MODBUS_FUNCTION_CODES.READ_COILS:
                    this.logger.debug("Reading coils...");
                    result = await this.modbusClient.readCoils(address, quantity);
                    break;

                case MODBUS_FUNCTION_CODES.READ_DISCRETE_INPUTS:
                    this.logger.debug("Reading discrete inputs...");
                    result = await this.modbusClient.readDiscreteInputs(address, quantity);
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
            return result;
        };

        // Execute with retry for serial port errors
        const result = await this.executeWithRetry(
            readOperation,
            `READ_FC${fc}`,
            address
        );

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

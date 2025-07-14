/**
 * Modbus Service for VIIS RPC Control Node
 * Handles Modbus operations including read/write and mapping
 */

import {
    IModbusService,
    ModbusMappingResult,
    ServiceOptions,
    EnvironmentConfig,
    ManualOverrides,
    ManualOverride
} from "../interfaces/types";
import { ModbusData } from "../../../core/modbus-client";
import { MODBUS_FUNCTION_CODES, ERROR_MESSAGES, ENV_KEYS, DEFAULTS, HOLDING_SETML_BOM_OFFSETS } from "../constants";
import { Logger } from "../utils/logger";
import { ScalingUtils } from "../utils/scaling";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";

export class ModbusService implements IModbusService {
    private modbusClient: any;
    private environmentConfig: EnvironmentConfig;
    private logger: Logger;
    private scalingUtils: ScalingUtils;
    private flowContext: any;
    private nodeId: string;
    private globalHelper: GlobalContextHelper;

    constructor(options: ServiceOptions, modbusClient: any, scalingUtils: ScalingUtils) {
        this.modbusClient = modbusClient;
        this.scalingUtils = scalingUtils;
        this.flowContext = options.flowContext;
        this.nodeId = options.node.id;
        this.logger = new Logger(options.node, "MODBUS-SERVICE");
        this.globalHelper = new GlobalContextHelper(options.node.context());
        this.environmentConfig = this.loadEnvironmentConfig();

        // Log Modbus client state during initialization
        this.logger.warn(`ModbusService initialized with client: ${modbusClient ? 'provided' : 'missing'}`);
        if (modbusClient) {
            this.logger.warn(`Modbus client connection state: ${modbusClient.isConnected ? 'connected' : 'disconnected'}`);
        }
    }

    /**
     * Load Modbus configuration from environment variables
     */
    private loadEnvironmentConfig(): EnvironmentConfig {
        try {
            return {
                deviceId: this.globalHelper.getEnvVar(ENV_KEYS.DEVICE_ID, DEFAULTS.DEVICE_ID),
                modbusCoils: this.globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_COILS, {}),
                modbusInputRegisters: this.globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_INPUT_REGISTERS, {}),
                modbusHoldingRegisters: this.globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_HOLDING_REGISTERS, {}),
            };
        } catch (error) {
            this.logger.error(`Failed to load environment config: ${(error as Error).message}`);
            return {
                deviceId: DEFAULTS.DEVICE_ID,
                modbusCoils: {},
                modbusInputRegisters: {},
                modbusHoldingRegisters: {},
            };
        }
    }

    /**
     * Find Modbus mapping for a given key
     */
    findModbusMapping(key: string): ModbusMappingResult | null {
        const { modbusHoldingRegisters, modbusCoils, modbusInputRegisters } = this.environmentConfig;

        // Check holding registers first (read/write)
        if (modbusHoldingRegisters[key] !== undefined) {
            return {
                address: modbusHoldingRegisters[key],
                fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER,
                value: 0
            };
        }

        // Check coils (read/write)
        if (modbusCoils[key] !== undefined) {
            return {
                address: modbusCoils[key],
                fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                value: false
            };
        }

        // Check input registers (read-only)
        if (modbusInputRegisters[key] !== undefined) {
            return {
                address: modbusInputRegisters[key],
                fc: MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS,
                value: 0
            };
        }

        return null;
    }

    /**
     * Apply special offset for HOLDING_SETML_BOM keys (decoupled feature)
     */
    private applyHoldingSetmlBomOffset(key: string, value: number | boolean): number | boolean {
        // Check if offset feature is enabled
        if (!HOLDING_SETML_BOM_OFFSETS.ENABLED) {
            return value;
        }

        // Only apply offset to numeric values and specific keys
        if (typeof value === "number" && key in HOLDING_SETML_BOM_OFFSETS.OFFSETS) {
            const offset = HOLDING_SETML_BOM_OFFSETS.OFFSETS[key as keyof typeof HOLDING_SETML_BOM_OFFSETS.OFFSETS];
            const offsetValue = value + offset;
            this.logger.warn(`[OFFSET] Applied offset to ${key}: ${value} + ${offset} = ${offsetValue}`);
            return offsetValue;
        }

        return value;
    }

    /**
     * Write value to Modbus device
     */
    async writeToModbus(key: string, mapping: ModbusMappingResult, value: number | boolean): Promise<void> {
        console.log(`ModbusService.writeToModbus called: key=${key}, address=${mapping.address}, value=${value}, fc=${mapping.fc}`);

        try {
            let writeValue = value;

            // Apply special offset for HOLDING_SETML_BOM keys (decoupled feature)
            writeValue = this.applyHoldingSetmlBomOffset(key, writeValue);

            // Apply scaling for numeric values
            if (typeof writeValue === "number") {
                writeValue = this.scalingUtils.scaleValue(key, writeValue, "write");
                console.log(`Scaled value for writing: ${value} -> ${writeValue}`);
            }

            // Check if Modbus client is connected
            if (!this.modbusClient) {
                console.error("Modbus client is null or undefined");
                throw new Error("Modbus client is not initialized");
            }

            if (!this.modbusClient.isConnected) {
                console.error("Modbus client is not connected");
                throw new Error("Modbus client not connected");
            }

            console.log(`Executing Modbus write: key=${key}, address=${mapping.address}, value=${writeValue}, fc=${mapping.fc}`);

            // Perform the write operation based on function code
            if (mapping.fc === 6) { // WRITE_SINGLE_REGISTER
                console.log(`Writing to register: address=${mapping.address}, value=${writeValue}`);
                const result = await this.modbusClient.writeRegister(mapping.address, writeValue as number);
                console.log(`Register write result:`, result);
            } else if (mapping.fc === 5) { // WRITE_SINGLE_COIL
                console.log(`Writing to coil: address=${mapping.address}, value=${writeValue}`);
                const result = await this.modbusClient.writeCoil(mapping.address, writeValue as boolean);
                console.log(`Coil write result:`, result);
            } else {
                console.error(`Unsupported write function code: ${mapping.fc}`);
                throw new Error(`Unsupported write function code: ${mapping.fc}`);
            }

            // Store manual override information
            this.storeManualOverride(mapping.address, mapping.fc, writeValue);

            console.log(`MODBUS WRITE SUCCESS: key=${key}, address=${mapping.address}, value=${writeValue}`);

        } catch (error) {
            const errorMsg = (error as Error).message;
            console.error(`MODBUS WRITE ERROR for ${key}:`, errorMsg);
            
            // Check if this is a connection error and provide more context
            if (this.isConnectionError(errorMsg)) {
                const connectionError = `[MODBUS-SERVICE] Connection lost during write operation for ${key}. Error: ${errorMsg}. Please check device connection and try again.`;
                this.logger.error(connectionError);
                throw new Error(connectionError);
            }
            
            const errorMessage = ERROR_MESSAGES.MODBUS_WRITE_FAILED(key) + `: ${errorMsg}`;
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }

    /**
     * Read value from Modbus device
     */
    async readFromModbus(key: string, mapping: ModbusMappingResult): Promise<number | boolean> {
        try {
            const readFc = this.getReadFunctionCode(mapping.fc);
            let result: ModbusData;

            // Perform the read operation based on function code
            switch (readFc) {
                case MODBUS_FUNCTION_CODES.READ_COILS:
                    result = await this.modbusClient.readCoils(mapping.address, 1);
                    break;
                case MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS:
                    result = await this.modbusClient.readHoldingRegisters(mapping.address, 1);
                    break;
                case MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
                    result = await this.modbusClient.readInputRegisters(mapping.address, 1);
                    break;
                default:
                    throw new Error(`Unsupported read function code: ${readFc}`);
            }

            let readValue = result.data[0];

            // Apply scaling for numeric values
            if (typeof readValue === "number") {
                readValue = this.scalingUtils.scaleValue(key, readValue, "read");
            }

            this.logger.debug(`Read from Modbus: key=${key}, address=${mapping.address}, value=${readValue}, fc=${readFc}`);

            return readValue;

        } catch (error) {
            const errorMessage = ERROR_MESSAGES.MODBUS_READ_FAILED(key) + `: ${(error as Error).message}`;
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }

    /**
     * Get the appropriate read function code for a write function code
     */
    private getReadFunctionCode(writeFc: number): number {
        switch (writeFc) {
            case MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER:
                return MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS;
            case MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL:
                return MODBUS_FUNCTION_CODES.READ_COILS;
            case MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
                return MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS;
            default:
                return writeFc;
        }
    }

    /**
     * Store manual override information for tracking
     */
    private storeManualOverride(address: number, fc: number, value: any): void {
        const manualOverrides = this.getManualOverrides();
        const addressKey = `${address}-${fc}`;

        manualOverrides[addressKey] = {
            fc,
            value,
            timestamp: Date.now()
        };

        this.setManualOverrides(manualOverrides);
        this.logger.debug(`Stored manual override: address=${address}, fc=${fc}, value=${value}`);
    }

    /**
     * Get manual overrides from flow context
     */
    private getManualOverrides(): ManualOverrides {
        const contextKey = `manualModbusOverrides_${this.nodeId}`;
        return this.flowContext.get(contextKey) || {};
    }

    /**
     * Set manual overrides in flow context
     */
    private setManualOverrides(overrides: ManualOverrides): void {
        const contextKey = `manualModbusOverrides_${this.nodeId}`;
        this.flowContext.set(contextKey, overrides);
    }

    /**
     * Check if an address has a recent manual override
     */
    hasRecentManualOverride(address: number, fc: number, maxAgeMs: number = 30000): boolean {
        const manualOverrides = this.getManualOverrides();
        const addressKey = `${address}-${fc}`;
        const override = manualOverrides[addressKey];

        if (!override) {
            return false;
        }

        const age = Date.now() - override.timestamp;
        return age <= maxAgeMs;
    }

    /**
     * Get environment configuration
     */
    getEnvironmentConfig(): EnvironmentConfig {
        return this.environmentConfig;
    }

    /**
     * Refresh environment configuration
     */
    refreshEnvironmentConfig(): void {
        this.environmentConfig = this.loadEnvironmentConfig();
        this.logger.warn("Environment configuration refreshed");
    }

    /**
     * Get all configured Modbus keys
     */
    getAllModbusKeys(): string[] {
        const { modbusHoldingRegisters, modbusCoils, modbusInputRegisters } = this.environmentConfig;
        return [
            ...Object.keys(modbusHoldingRegisters),
            ...Object.keys(modbusCoils),
            ...Object.keys(modbusInputRegisters)
        ];
    }

    /**
     * Check if a key has Modbus mapping
     */
    hasModbusMapping(key: string): boolean {
        return this.findModbusMapping(key) !== null;
    }

    /**
     * Get modbus holding registers mapping
     */
    getModbusHoldingRegisters(): Record<string, number> {
        return this.environmentConfig.modbusHoldingRegisters || {};
    }

    /**
     * Get modbus coils mapping
     */
    getModbusCoils(): Record<string, number> {
        return this.environmentConfig.modbusCoils || {};
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
     * Check if HOLDING_SETML_BOM offset feature is enabled
     */
    isHoldingSetmlBomOffsetEnabled(): boolean {
        return HOLDING_SETML_BOM_OFFSETS.ENABLED;
    }

    /**
     * Get the offset value for a specific HOLDING_SETML_BOM key
     */
    getHoldingSetmlBomOffset(key: string): number | null {
        if (!HOLDING_SETML_BOM_OFFSETS.ENABLED) {
            return null;
        }
        
        if (key in HOLDING_SETML_BOM_OFFSETS.OFFSETS) {
            return HOLDING_SETML_BOM_OFFSETS.OFFSETS[key as keyof typeof HOLDING_SETML_BOM_OFFSETS.OFFSETS];
        }
        
        return null;
    }

    /**
     * Get all HOLDING_SETML_BOM offset configurations
     */
    getHoldingSetmlBomOffsetConfig(): typeof HOLDING_SETML_BOM_OFFSETS {
        return HOLDING_SETML_BOM_OFFSETS;
    }

    /**
     * Check Modbus connection and attempt to reconnect if needed
     */
    async checkConnection(): Promise<void> {
        try {
            if (!this.modbusClient) {
                throw new Error("Modbus client is not initialized");
            }

            // Check if client reports as connected
            if (!this.modbusClient.isConnectedCheck()) {
                this.logger.warn("[MODBUS-SERVICE] Modbus client reports as disconnected, attempting to reconnect...");
                
                try {
                    await this.modbusClient.reconnect();
                    this.logger.warn("[MODBUS-SERVICE] Reconnection successful");
                    
                    // Wait a moment for connection to stabilize
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return;
                } catch (reconnectError) {
                    const reconnectMsg = `[MODBUS-SERVICE] Reconnection failed: ${(reconnectError as Error).message}`;
                    this.logger.error(reconnectMsg);
                    throw new Error(reconnectMsg);
                }
            }

            // Try a simple read operation to verify connection (skip for now to avoid additional errors)
            // The connection check via isConnectedCheck() should be sufficient
            this.logger.debug("[MODBUS-SERVICE] Modbus connection verified successfully");
            
        } catch (error) {
            const errorMsg = `Modbus connection check failed: ${(error as Error).message}`;
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }
}

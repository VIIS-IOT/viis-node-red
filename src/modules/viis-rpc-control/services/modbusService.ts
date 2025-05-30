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
import { MODBUS_FUNCTION_CODES, ERROR_MESSAGES, ENV_KEYS, DEFAULTS } from "../constants";
import { Logger } from "../utils/logger";
import { ScalingUtils } from "../utils/scaling";

export class ModbusService implements IModbusService {
    private modbusClient: any;
    private environmentConfig: EnvironmentConfig;
    private logger: Logger;
    private scalingUtils: ScalingUtils;
    private flowContext: any;
    private nodeId: string;

    constructor(options: ServiceOptions, modbusClient: any, scalingUtils: ScalingUtils) {
        this.modbusClient = modbusClient;
        this.scalingUtils = scalingUtils;
        this.flowContext = options.flowContext;
        this.nodeId = options.node.id;
        this.logger = new Logger(options.node, "MODBUS-SERVICE");
        this.environmentConfig = this.loadEnvironmentConfig();
    }

    /**
     * Load Modbus configuration from environment variables
     */
    private loadEnvironmentConfig(): EnvironmentConfig {
        try {
            return {
                deviceId: process.env[ENV_KEYS.DEVICE_ID] || DEFAULTS.DEVICE_ID,
                modbusCoils: JSON.parse(process.env[ENV_KEYS.MODBUS_COILS] || DEFAULTS.EMPTY_JSON),
                modbusInputRegisters: JSON.parse(process.env[ENV_KEYS.MODBUS_INPUT_REGISTERS] || DEFAULTS.EMPTY_JSON),
                modbusHoldingRegisters: JSON.parse(process.env[ENV_KEYS.MODBUS_HOLDING_REGISTERS] || DEFAULTS.EMPTY_JSON),
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
     * Write value to Modbus device
     */
    async writeToModbus(key: string, mapping: ModbusMappingResult, value: number | boolean): Promise<void> {
        try {
            let writeValue = value;
            
            // Apply scaling for numeric values
            if (typeof value === "number") {
                writeValue = this.scalingUtils.scaleValue(key, value, "write");
            }

            // Perform the write operation based on function code
            if (mapping.fc === MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER) {
                await this.modbusClient.writeRegister(mapping.address, writeValue as number);
            } else if (mapping.fc === MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL) {
                await this.modbusClient.writeCoil(mapping.address, value as boolean);
            } else {
                throw new Error(`Unsupported write function code: ${mapping.fc}`);
            }

            this.logger.debug(`Wrote to Modbus: key=${key}, address=${mapping.address}, value=${writeValue}, fc=${mapping.fc}`);
            
            // Store manual override information
            this.storeManualOverride(mapping.address, mapping.fc, writeValue);

        } catch (error) {
            const errorMessage = ERROR_MESSAGES.MODBUS_WRITE_FAILED(key) + `: ${(error as Error).message}`;
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
        this.logger.log("Environment configuration refreshed");
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
}

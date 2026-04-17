/**
 * Modbus Service for VIIS Auto Microclimate Control Node
 * Handles Modbus operations and device control
 */

import {
    IModbusService,
    ControlAction,
    ControlExecutionResult,
    ServiceOptions,
    ILogger,
    EnvironmentConfig
} from "../interfaces/types";
import { 
    CONTEXT_KEYS, 
    ERROR_MESSAGES, 
    MODBUS_FUNCTION_CODES,
    FAN_CONFIG,
    FAN_DAO_CONFIG,
    WATER_PUMP_CONFIG,
    CURTAIN_CONFIG,
    CONTROL_CONFIG
} from "../constants";
import { Logger } from "../utils/logger";
import { delay } from "../utils/timeUtils";

export class ModbusService implements IModbusService {
    private modbusClient: any;
    private globalContext: any;
    private logger: ILogger;
    private environmentConfig: EnvironmentConfig;

    constructor(options: ServiceOptions, modbusClient: any) {
        this.modbusClient = modbusClient;
        this.globalContext = options.globalContext;
        this.logger = new Logger(options.node, options.nodeId);
        this.environmentConfig = options.environmentConfig;
    }

    /**
     * Write to a single coil
     */
    async writeCoil(address: number, value: boolean): Promise<void> {
        try {
            if (!this.modbusClient) {
                throw new Error("Modbus client is not initialized");
            }

            if (!this.modbusClient.isConnected) {
                throw new Error("Modbus client not connected");
            }

            this.logger.debug(`Writing coil: address=${address}, value=${value}`);
            await this.modbusClient.writeCoil(address, value);
            
        } catch (error) {
            this.logger.error(`${ERROR_MESSAGES.MODBUS_WRITE_ERROR}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Write to a single register
     */
    async writeRegister(address: number, value: number): Promise<void> {
        try {
            if (!this.modbusClient) {
                throw new Error("Modbus client is not initialized");
            }

            if (!this.modbusClient.isConnected) {
                throw new Error("Modbus client not connected");
            }

            this.logger.debug(`Writing register: address=${address}, value=${value}`);
            await this.modbusClient.writeRegister(address, value);
            
        } catch (error) {
            this.logger.error(`${ERROR_MESSAGES.MODBUS_WRITE_ERROR}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Read from a single coil
     */
    async readCoil(address: number): Promise<boolean> {
        try {
            if (!this.modbusClient) {
                throw new Error("Modbus client is not initialized");
            }

            if (!this.modbusClient.isConnected) {
                throw new Error("Modbus client not connected");
            }

            this.logger.debug(`Reading coil: address=${address}`);
            const result = await this.modbusClient.readCoils(address, 1);
            return result.data[0];
            
        } catch (error) {
            this.logger.error(`${ERROR_MESSAGES.MODBUS_READ_ERROR}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Read from a single register
     */
    async readRegister(address: number): Promise<number> {
        try {
            if (!this.modbusClient) {
                throw new Error("Modbus client is not initialized");
            }

            if (!this.modbusClient.isConnected) {
                throw new Error("Modbus client not connected");
            }

            this.logger.debug(`Reading register: address=${address}`);
            const result = await this.modbusClient.readHoldingRegisters(address, 1);
            return result.data[0];
            
        } catch (error) {
            this.logger.error(`${ERROR_MESSAGES.MODBUS_READ_ERROR}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Find coil address for a device key
     */
    findCoilAddress(deviceKey: string): number | null {
        // Check environment config first
        const modbusCoils = this.globalContext.get(CONTEXT_KEYS.GLOBAL_MODBUS_COILS) || {};
        if (modbusCoils[deviceKey] !== undefined) {
            return modbusCoils[deviceKey];
        }

        // Fallback to hardcoded mappings
        if (FAN_CONFIG.COIL_MAPPING[deviceKey as keyof typeof FAN_CONFIG.COIL_MAPPING] !== undefined) {
            return FAN_CONFIG.COIL_MAPPING[deviceKey as keyof typeof FAN_CONFIG.COIL_MAPPING];
        }

        if (FAN_DAO_CONFIG.COIL_MAPPING[deviceKey as keyof typeof FAN_DAO_CONFIG.COIL_MAPPING] !== undefined) {
            return FAN_DAO_CONFIG.COIL_MAPPING[deviceKey as keyof typeof FAN_DAO_CONFIG.COIL_MAPPING];
        }

        if (WATER_PUMP_CONFIG.COIL_MAPPING[deviceKey as keyof typeof WATER_PUMP_CONFIG.COIL_MAPPING] !== undefined) {
            return WATER_PUMP_CONFIG.COIL_MAPPING[deviceKey as keyof typeof WATER_PUMP_CONFIG.COIL_MAPPING];
        }

        if (CURTAIN_CONFIG.COIL_MAPPING[deviceKey as keyof typeof CURTAIN_CONFIG.COIL_MAPPING] !== undefined) {
            return CURTAIN_CONFIG.COIL_MAPPING[deviceKey as keyof typeof CURTAIN_CONFIG.COIL_MAPPING];
        }

        this.logger.warn(`No coil address found for device key: ${deviceKey}`);
        return null;
    }

    /**
     * Execute multiple control actions with error handling and retry logic
     */
    async executeControlActions(actions: ControlAction[]): Promise<ControlExecutionResult> {
        const result: ControlExecutionResult = {
            success: true,
            actionsExecuted: [],
            errors: [],
            timestamp: Date.now()
        };

        if (actions.length === 0) {
            this.logger.debug("No control actions to execute");
            return result;
        }

        this.logger.log(`Executing ${actions.length} control actions`);

        for (const action of actions) {
            let success = false;
            let lastError: string = "";

            // Optional per-action delay (used by fan transition/rotation sequencing)
            if (typeof action.delay === "number" && action.delay > 0) {
                this.logger.debug(`Applying action delay: ${action.delay}ms for ${action.deviceKey}`);
                await delay(action.delay);
            }

            // Retry logic for each action
            for (let attempt = 1; attempt <= CONTROL_CONFIG.RETRY_ATTEMPTS; attempt++) {
                try {
                    await this.executeControlAction(action);
                    result.actionsExecuted.push(action);
                    success = true;
                    this.logger.debug(`Action executed successfully: ${action.deviceKey}=${action.value} (${action.reason})`);
                    break;

                } catch (error) {
                    lastError = (error as Error).message;
                    this.logger.warn(`Action failed (attempt ${attempt}/${CONTROL_CONFIG.RETRY_ATTEMPTS}): ${action.deviceKey}=${action.value}, error: ${lastError}`);
                    
                    if (attempt < CONTROL_CONFIG.RETRY_ATTEMPTS) {
                        await delay(CONTROL_CONFIG.RETRY_DELAY_MS);
                    }
                }
            }

            if (!success) {
                result.success = false;
                result.errors.push(`Failed to execute action ${action.deviceKey}=${action.value}: ${lastError}`);
                this.logger.error(`Action failed after all retries: ${action.deviceKey}=${action.value}`);
            }

            // Small delay between actions to avoid overwhelming the Modbus device
            await delay(100);
        }

        if (result.success) {
            this.logger.log(`All ${actions.length} control actions executed successfully`);
        } else {
            this.logger.error(`Control execution completed with ${result.errors.length} errors`);
        }

        return result;
    }

    /**
     * Execute a single control action
     */
    private async executeControlAction(action: ControlAction): Promise<void> {
        if (action.fc === MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL) {
            await this.writeCoil(action.address, action.value as boolean);
        } else if (action.fc === MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER) {
            await this.writeRegister(action.address, action.value as number);
        } else {
            throw new Error(`Unsupported function code: ${action.fc}`);
        }
    }

    /**
     * Check if Modbus client is ready
     */
    isReady(): boolean {
        return this.modbusClient && this.modbusClient.isConnected;
    }

    /**
     * Get Modbus client status
     */
    getStatus(): string {
        if (!this.modbusClient) {
            return "Not initialized";
        }
        
        if (!this.modbusClient.isConnected) {
            return "Disconnected";
        }
        
        return "Connected";
    }
}

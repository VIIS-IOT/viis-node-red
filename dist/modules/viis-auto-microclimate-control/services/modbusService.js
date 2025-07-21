"use strict";
/**
 * Modbus Service for VIIS Auto Microclimate Control Node
 * Handles Modbus operations and device control
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModbusService = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
const timeUtils_1 = require("../utils/timeUtils");
class ModbusService {
    constructor(options, modbusClient) {
        this.modbusClient = modbusClient;
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(options.node, options.nodeId);
        this.environmentConfig = options.environmentConfig;
    }
    /**
     * Write to a single coil
     */
    async writeCoil(address, value) {
        try {
            if (!this.modbusClient) {
                throw new Error("Modbus client is not initialized");
            }
            if (!this.modbusClient.isConnected) {
                throw new Error("Modbus client not connected");
            }
            this.logger.debug(`Writing coil: address=${address}, value=${value}`);
            await this.modbusClient.writeCoil(address, value);
        }
        catch (error) {
            this.logger.error(`${constants_1.ERROR_MESSAGES.MODBUS_WRITE_ERROR}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Write to a single register
     */
    async writeRegister(address, value) {
        try {
            if (!this.modbusClient) {
                throw new Error("Modbus client is not initialized");
            }
            if (!this.modbusClient.isConnected) {
                throw new Error("Modbus client not connected");
            }
            this.logger.debug(`Writing register: address=${address}, value=${value}`);
            await this.modbusClient.writeRegister(address, value);
        }
        catch (error) {
            this.logger.error(`${constants_1.ERROR_MESSAGES.MODBUS_WRITE_ERROR}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Read from a single coil
     */
    async readCoil(address) {
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
        }
        catch (error) {
            this.logger.error(`${constants_1.ERROR_MESSAGES.MODBUS_READ_ERROR}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Read from a single register
     */
    async readRegister(address) {
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
        }
        catch (error) {
            this.logger.error(`${constants_1.ERROR_MESSAGES.MODBUS_READ_ERROR}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Find coil address for a device key
     */
    findCoilAddress(deviceKey) {
        // Check environment config first
        const modbusCoils = this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_MODBUS_COILS) || {};
        if (modbusCoils[deviceKey] !== undefined) {
            return modbusCoils[deviceKey];
        }
        // Fallback to hardcoded mappings
        if (constants_1.FAN_CONFIG.COIL_MAPPING[deviceKey] !== undefined) {
            return constants_1.FAN_CONFIG.COIL_MAPPING[deviceKey];
        }
        if (constants_1.FAN_DAO_CONFIG.COIL_MAPPING[deviceKey] !== undefined) {
            return constants_1.FAN_DAO_CONFIG.COIL_MAPPING[deviceKey];
        }
        if (constants_1.FAN_TREN_CONFIG.COIL_MAPPING[deviceKey] !== undefined) {
            return constants_1.FAN_TREN_CONFIG.COIL_MAPPING[deviceKey];
        }
        if (constants_1.WATER_PUMP_CONFIG.COIL_MAPPING[deviceKey] !== undefined) {
            return constants_1.WATER_PUMP_CONFIG.COIL_MAPPING[deviceKey];
        }
        if (constants_1.CURTAIN_CONFIG.COIL_MAPPING[deviceKey] !== undefined) {
            return constants_1.CURTAIN_CONFIG.COIL_MAPPING[deviceKey];
        }
        this.logger.warn(`No coil address found for device key: ${deviceKey}`);
        return null;
    }
    /**
     * Execute multiple control actions with error handling and retry logic
     */
    async executeControlActions(actions) {
        const result = {
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
            let lastError = "";
            // Retry logic for each action
            for (let attempt = 1; attempt <= constants_1.CONTROL_CONFIG.RETRY_ATTEMPTS; attempt++) {
                try {
                    await this.executeControlAction(action);
                    result.actionsExecuted.push(action);
                    success = true;
                    this.logger.debug(`Action executed successfully: ${action.deviceKey}=${action.value} (${action.reason})`);
                    break;
                }
                catch (error) {
                    lastError = error.message;
                    this.logger.warn(`Action failed (attempt ${attempt}/${constants_1.CONTROL_CONFIG.RETRY_ATTEMPTS}): ${action.deviceKey}=${action.value}, error: ${lastError}`);
                    if (attempt < constants_1.CONTROL_CONFIG.RETRY_ATTEMPTS) {
                        await (0, timeUtils_1.delay)(constants_1.CONTROL_CONFIG.RETRY_DELAY_MS);
                    }
                }
            }
            if (!success) {
                result.success = false;
                result.errors.push(`Failed to execute action ${action.deviceKey}=${action.value}: ${lastError}`);
                this.logger.error(`Action failed after all retries: ${action.deviceKey}=${action.value}`);
            }
            // Small delay between actions to avoid overwhelming the Modbus device
            await (0, timeUtils_1.delay)(100);
        }
        if (result.success) {
            this.logger.log(`All ${actions.length} control actions executed successfully`);
        }
        else {
            this.logger.error(`Control execution completed with ${result.errors.length} errors`);
        }
        return result;
    }
    /**
     * Execute a single control action
     */
    async executeControlAction(action) {
        if (action.fc === constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL) {
            await this.writeCoil(action.address, action.value);
        }
        else if (action.fc === constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER) {
            await this.writeRegister(action.address, action.value);
        }
        else {
            throw new Error(`Unsupported function code: ${action.fc}`);
        }
    }
    /**
     * Check if Modbus client is ready
     */
    isReady() {
        return this.modbusClient && this.modbusClient.isConnected;
    }
    /**
     * Get Modbus client status
     */
    getStatus() {
        if (!this.modbusClient) {
            return "Not initialized";
        }
        if (!this.modbusClient.isConnected) {
            return "Disconnected";
        }
        return "Connected";
    }
}
exports.ModbusService = ModbusService;

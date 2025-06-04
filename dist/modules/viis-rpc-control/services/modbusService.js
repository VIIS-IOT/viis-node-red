"use strict";
/**
 * Modbus Service for VIIS RPC Control Node
 * Handles Modbus operations including read/write and mapping
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModbusService = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
const global_context_helper_1 = require("../../../ultils/global-context-helper");
class ModbusService {
    constructor(options, modbusClient, scalingUtils) {
        this.modbusClient = modbusClient;
        this.scalingUtils = scalingUtils;
        this.flowContext = options.flowContext;
        this.nodeId = options.node.id;
        this.logger = new logger_1.Logger(options.node, "MODBUS-SERVICE");
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(options.node.context());
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
    loadEnvironmentConfig() {
        try {
            return {
                deviceId: this.globalHelper.getEnvVar(constants_1.ENV_KEYS.DEVICE_ID, constants_1.DEFAULTS.DEVICE_ID),
                modbusCoils: this.globalHelper.getJsonEnvVar(constants_1.ENV_KEYS.MODBUS_COILS, {}),
                modbusInputRegisters: this.globalHelper.getJsonEnvVar(constants_1.ENV_KEYS.MODBUS_INPUT_REGISTERS, {}),
                modbusHoldingRegisters: this.globalHelper.getJsonEnvVar(constants_1.ENV_KEYS.MODBUS_HOLDING_REGISTERS, {}),
            };
        }
        catch (error) {
            this.logger.error(`Failed to load environment config: ${error.message}`);
            return {
                deviceId: constants_1.DEFAULTS.DEVICE_ID,
                modbusCoils: {},
                modbusInputRegisters: {},
                modbusHoldingRegisters: {},
            };
        }
    }
    /**
     * Find Modbus mapping for a given key
     */
    findModbusMapping(key) {
        const { modbusHoldingRegisters, modbusCoils, modbusInputRegisters } = this.environmentConfig;
        // Check holding registers first (read/write)
        if (modbusHoldingRegisters[key] !== undefined) {
            return {
                address: modbusHoldingRegisters[key],
                fc: constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER,
                value: 0
            };
        }
        // Check coils (read/write)
        if (modbusCoils[key] !== undefined) {
            return {
                address: modbusCoils[key],
                fc: constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                value: false
            };
        }
        // Check input registers (read-only)
        if (modbusInputRegisters[key] !== undefined) {
            return {
                address: modbusInputRegisters[key],
                fc: constants_1.MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS,
                value: 0
            };
        }
        return null;
    }
    /**
     * Write value to Modbus device
     */
    async writeToModbus(key, mapping, value) {
        console.log(`ModbusService.writeToModbus called: key=${key}, address=${mapping.address}, value=${value}, fc=${mapping.fc}`);
        try {
            let writeValue = value;
            // Apply scaling for numeric values
            if (typeof value === "number") {
                writeValue = this.scalingUtils.scaleValue(key, value, "write");
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
                const result = await this.modbusClient.writeRegister(mapping.address, writeValue);
                console.log(`Register write result:`, result);
            }
            else if (mapping.fc === 5) { // WRITE_SINGLE_COIL
                console.log(`Writing to coil: address=${mapping.address}, value=${writeValue}`);
                const result = await this.modbusClient.writeCoil(mapping.address, writeValue);
                console.log(`Coil write result:`, result);
            }
            else {
                console.error(`Unsupported write function code: ${mapping.fc}`);
                throw new Error(`Unsupported write function code: ${mapping.fc}`);
            }
            // Store manual override information
            this.storeManualOverride(mapping.address, mapping.fc, writeValue);
            console.log(`MODBUS WRITE SUCCESS: key=${key}, address=${mapping.address}, value=${writeValue}`);
        }
        catch (error) {
            console.error(`MODBUS WRITE ERROR for ${key}:`, error.message);
            const errorMessage = constants_1.ERROR_MESSAGES.MODBUS_WRITE_FAILED(key) + `: ${error.message}`;
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }
    /**
     * Read value from Modbus device
     */
    async readFromModbus(key, mapping) {
        try {
            const readFc = this.getReadFunctionCode(mapping.fc);
            let result;
            // Perform the read operation based on function code
            switch (readFc) {
                case constants_1.MODBUS_FUNCTION_CODES.READ_COILS:
                    result = await this.modbusClient.readCoils(mapping.address, 1);
                    break;
                case constants_1.MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS:
                    result = await this.modbusClient.readHoldingRegisters(mapping.address, 1);
                    break;
                case constants_1.MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
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
        }
        catch (error) {
            const errorMessage = constants_1.ERROR_MESSAGES.MODBUS_READ_FAILED(key) + `: ${error.message}`;
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }
    /**
     * Get the appropriate read function code for a write function code
     */
    getReadFunctionCode(writeFc) {
        switch (writeFc) {
            case constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER:
                return constants_1.MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS;
            case constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL:
                return constants_1.MODBUS_FUNCTION_CODES.READ_COILS;
            case constants_1.MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
                return constants_1.MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS;
            default:
                return writeFc;
        }
    }
    /**
     * Store manual override information for tracking
     */
    storeManualOverride(address, fc, value) {
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
    getManualOverrides() {
        const contextKey = `manualModbusOverrides_${this.nodeId}`;
        return this.flowContext.get(contextKey) || {};
    }
    /**
     * Set manual overrides in flow context
     */
    setManualOverrides(overrides) {
        const contextKey = `manualModbusOverrides_${this.nodeId}`;
        this.flowContext.set(contextKey, overrides);
    }
    /**
     * Check if an address has a recent manual override
     */
    hasRecentManualOverride(address, fc, maxAgeMs = 30000) {
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
    getEnvironmentConfig() {
        return this.environmentConfig;
    }
    /**
     * Refresh environment configuration
     */
    refreshEnvironmentConfig() {
        this.environmentConfig = this.loadEnvironmentConfig();
        this.logger.warn("Environment configuration refreshed");
    }
    /**
     * Get all configured Modbus keys
     */
    getAllModbusKeys() {
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
    hasModbusMapping(key) {
        return this.findModbusMapping(key) !== null;
    }
    /**
     * Check Modbus connection and attempt to reconnect if needed
     */
    async checkConnection() {
        try {
            if (!this.modbusClient) {
                throw new Error("Modbus client is not initialized");
            }
            // Check if client reports as connected
            if (!this.modbusClient.isConnectedCheck()) {
                this.logger.warn("Modbus client reports as disconnected, attempting to reconnect...");
                await this.modbusClient.reconnect();
                return;
            }
            // Try a simple read operation to verify connection
            try {
                await this.modbusClient.readCoils(0, 1);
                this.logger.debug("Modbus connection verified successfully");
            }
            catch (testError) {
                this.logger.warn(`Modbus connection test failed: ${testError.message}, attempting to reconnect...`);
                await this.modbusClient.reconnect();
            }
        }
        catch (error) {
            const errorMsg = `Modbus connection check failed: ${error.message}`;
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }
}
exports.ModbusService = ModbusService;

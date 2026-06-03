"use strict";
/**
 * Sensor Service for VIIS Auto Microclimate Control Node
 * Handles reading sensor data and device status from global variables
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensorService = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
class SensorService {
    constructor(options) {
        this.cachedSensorData = null;
        this.cachedDeviceStatus = null;
        this.lastSensorUpdate = 0;
        this.lastDeviceUpdate = 0;
        this.CACHE_TTL = 15000; // 15 seconds - longer than polling interval to prevent false cache misses
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(options.node, options.nodeId);
    }
    /**
     * Get current sensor data from global variables
     */
    getSensorData() {
        try {
            // Check if cached data is still valid
            if (this.cachedSensorData && this.isSensorCacheValid()) {
                return this.cachedSensorData;
            }
            // Read fresh data from global context
            const holdingRegisterData = this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_HOLDING_REGISTER_DATA);
            if (!holdingRegisterData || typeof holdingRegisterData !== 'object') {
                this.logger.warn("No sensor data found in global context");
                return null;
            }
            // Validate required fields
            if (typeof holdingRegisterData.ts !== 'number') {
                this.logger.warn("Invalid sensor data: missing or invalid timestamp");
                return null;
            }
            // Extract sensor data with validation
            const sensorData = {
                ts: holdingRegisterData.ts,
                temp_outdoor: this.validateNumericValue(holdingRegisterData.temp_outdoor, "temp_outdoor"),
                temp_indoor: this.validateNumericValue(holdingRegisterData.temp_indoor, "temp_indoor"),
                humi_indoor: this.validateNumericValue(holdingRegisterData.humi_indoor, "humi_indoor"),
                humi_outdoor: this.validateNumericValue(holdingRegisterData.humi_outdoor, "humi_outdoor"),
                light_indoor: this.validateNumericValue(holdingRegisterData.light_indoor, "light_indoor"),
                light_outdoor: this.validateNumericValue(holdingRegisterData.light_outdoor, "light_outdoor")
            };
            // Cache the data
            this.cachedSensorData = sensorData;
            this.lastSensorUpdate = Date.now();
            this.logger.debug(`Sensor data loaded: temp_indoor=${sensorData.temp_indoor}, humi_indoor=${sensorData.humi_indoor}, light_indoor=${sensorData.light_indoor}`);
            return sensorData;
        }
        catch (error) {
            this.logger.error(`${constants_1.ERROR_MESSAGES.SENSOR_DATA_ERROR}: ${error.message}`);
            return null;
        }
    }
    /**
     * Get current device status from global variables
     */
    getDeviceStatus() {
        try {
            // Check if cached data is still valid
            if (this.cachedDeviceStatus && this.isDeviceCacheValid()) {
                return this.cachedDeviceStatus;
            }
            // Read fresh data from global context
            const coilRegisterData = this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_COIL_REGISTER_DATA);
            if (!coilRegisterData || typeof coilRegisterData !== 'object') {
                this.logger.warn("No device status data found in global context");
                return null;
            }
            // Validate required fields
            if (typeof coilRegisterData.ts !== 'number') {
                this.logger.warn("Invalid device status data: missing or invalid timestamp");
                return null;
            }
            // Extract device status with validation
            const deviceStatus = {
                ts: coilRegisterData.ts,
                quat_1: this.validateBooleanValue(coilRegisterData.quat_1, "quat_1"),
                quat_2: this.validateBooleanValue(coilRegisterData.quat_2, "quat_2"),
                quat_3: this.validateBooleanValue(coilRegisterData.quat_3, "quat_3"),
                quat_4: this.validateBooleanValue(coilRegisterData.quat_4, "quat_4"),
                quat_5: this.validateBooleanValue(coilRegisterData.quat_5, "quat_5"),
                quat_6: this.validateBooleanValue(coilRegisterData.quat_6, "quat_6"),
                quat_dao_1: this.validateBooleanValue(coilRegisterData.quat_dao_1, "quat_dao_1"),
                quat_dao_2: this.validateBooleanValue(coilRegisterData.quat_dao_2, "quat_dao_2"),
                quat_dao_3: this.validateBooleanValue(coilRegisterData.quat_dao_3, "quat_dao_3"),
                bom_nuoc_1: this.validateBooleanValue(coilRegisterData.bom_nuoc_1, "bom_nuoc_1"),
                lamp_1: this.validateBooleanValue(coilRegisterData.lamp_1, "lamp_1"),
                lamp_2: this.validateBooleanValue(coilRegisterData.lamp_2, "lamp_2"),
                luoi_2_thu: this.validateBooleanValue(coilRegisterData.luoi_2_thu, "luoi_2_thu"),
                luoi_2_dai: this.validateBooleanValue(coilRegisterData.luoi_2_dai, "luoi_2_dai"),
                luoi_1_thu: this.validateBooleanValue(coilRegisterData.luoi_1_thu, "luoi_1_thu"),
                luoi_1_dai: this.validateBooleanValue(coilRegisterData.luoi_1_dai, "luoi_1_dai"),
                luoi_3_thu: this.validateBooleanValue(coilRegisterData.luoi_3_thu, "luoi_3_thu"),
                luoi_3_dai: this.validateBooleanValue(coilRegisterData.luoi_3_dai, "luoi_3_dai"),
                luoi_4_thu: this.validateBooleanValue(coilRegisterData.luoi_4_thu, "luoi_4_thu"),
                luoi_4_dai: this.validateBooleanValue(coilRegisterData.luoi_4_dai, "luoi_4_dai")
            };
            // Cache the data
            this.cachedDeviceStatus = deviceStatus;
            this.lastDeviceUpdate = Date.now();
            this.logger.debug(`Device status loaded: fans active=${this.getActiveFanCount(deviceStatus)}, water pump=${deviceStatus.bom_nuoc_1}`);
            return deviceStatus;
        }
        catch (error) {
            this.logger.error(`Failed to read device status: ${error.message}`);
            return null;
        }
    }
    /**
     * Check if sensor and device data are valid and recent
     */
    isDataValid() {
        const sensorData = this.getSensorData();
        const deviceStatus = this.getDeviceStatus();
        if (!sensorData || !deviceStatus) {
            return false;
        }
        // Check if data is not too old (within last 60 seconds)
        const now = Date.now();
        const maxAge = 900000; // 900 seconds
        const sensorAge = now - sensorData.ts;
        const deviceAge = now - deviceStatus.ts;
        if (sensorAge > maxAge || deviceAge > maxAge) {
            this.logger.warn(`Data is too old: sensor age=${Math.round(sensorAge / 1000)}s, device age=${Math.round(deviceAge / 1000)}s`);
            return false;
        }
        // Check if critical sensor values are available
        const hasCriticalData = (typeof sensorData.temp_indoor === 'number' &&
            typeof sensorData.humi_indoor === 'number' &&
            typeof sensorData.light_indoor === 'number');
        if (!hasCriticalData) {
            this.logger.warn("Missing critical sensor data");
            return false;
        }
        return true;
    }
    /**
     * Validate numeric sensor value
     */
    validateNumericValue(value, fieldName) {
        if (value === null || value === undefined) {
            return undefined;
        }
        const numValue = Number(value);
        if (isNaN(numValue)) {
            this.logger.warn(`Invalid numeric value for ${fieldName}: ${value}`);
            return undefined;
        }
        return numValue;
    }
    /**
     * Validate boolean device status value
     */
    validateBooleanValue(value, fieldName) {
        if (value === null || value === undefined) {
            return undefined;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        // Convert common representations to boolean
        if (value === 1 || value === "1" || value === "true") {
            return true;
        }
        if (value === 0 || value === "0" || value === "false") {
            return false;
        }
        this.logger.warn(`Invalid boolean value for ${fieldName}: ${value}`);
        return undefined;
    }
    /**
     * Check if sensor cache is still valid
     */
    isSensorCacheValid() {
        const now = Date.now();
        return (now - this.lastSensorUpdate) < this.CACHE_TTL;
    }
    /**
     * Check if device cache is still valid
     */
    isDeviceCacheValid() {
        const now = Date.now();
        return (now - this.lastDeviceUpdate) < this.CACHE_TTL;
    }
    /**
     * Get count of active fans
     */
    getActiveFanCount(deviceStatus) {
        let count = 0;
        ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'].forEach(fanKey => {
            if (deviceStatus[fanKey] === true) {
                count++;
            }
        });
        return count;
    }
    /**
     * Invalidate cache to force data reload
     */
    invalidateCache() {
        this.cachedSensorData = null;
        this.cachedDeviceStatus = null;
        this.lastSensorUpdate = 0;
        this.lastDeviceUpdate = 0;
    }
}
exports.SensorService = SensorService;

"use strict";
/**
 * Configuration Service for VIIS Device Protection Node
 * Handles reading/writing protection configuration from global context
 *
 * Field naming convention matches device profile:
 * - lamp_protect_bypass
 * - fan_protect_intake_bypass
 * - cool_protect_1_bypass
 * - humid_protect_bypass
 * - co2_protect_bypass
 * - etc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigService = void 0;
const constants_1 = require("../constants");
class ConfigService {
    constructor(node) {
        this.node = node;
        this.globalContext = node.context().global;
    }
    /**
     * Get all config values from global context
     */
    getConfigKeyValues() {
        return this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_VALUES) || {};
    }
    /**
     * Get protection config for a specific device
     * Matches field naming from device profile
     */
    getProtectionConfig(deviceKey) {
        const configKeyValues = this.getConfigKeyValues();
        const deviceLabel = constants_1.DEVICE_LABEL_MAP[deviceKey] || deviceKey;
        // Helper to get field value
        const getFieldValue = (field) => {
            const key = `${deviceLabel}_${field}`;
            return Number(configKeyValues[key] || 0);
        };
        const getBoolField = (field) => {
            const key = `${deviceLabel}_${field}`;
            return Boolean(configKeyValues[key]);
        };
        return {
            bypass: getBoolField('bypass'),
            forceOn: getBoolField('force_on'),
            forceOff: getBoolField('force_off'),
            maxTimeOn: getFieldValue('max_time_on'),
            minTimeOn: getFieldValue('min_time_on'),
            minOffTime: getFieldValue('min_off_time') || getFieldValue('min_stop_time'), // CO2 uses min_stop_time
            upperLimit: getFieldValue('upper_temp') || getFieldValue('upper_limit'),
            lowerLimit: getFieldValue('lower_temp') || getFieldValue('lower_limit'),
            deviceType: deviceKey,
        };
    }
    /**
     * Get protection config by device label (dynamic coil names)
     * Example: deviceLabel = "lamp_control_1" → looks for "lamp_control_1_protect_*"
     */
    getProtectionConfigByLabel(deviceLabel) {
        const configKeyValues = this.getConfigKeyValues();
        // Helper to get field value
        const getFieldValue = (field) => {
            const key = `${deviceLabel}_protect_${field}`;
            return Number(configKeyValues[key] || 0);
        };
        const getBoolField = (field) => {
            const key = `${deviceLabel}_protect_${field}`;
            return Boolean(configKeyValues[key]);
        };
        return {
            bypass: getBoolField('bypass'),
            forceOn: getBoolField('force_on'),
            forceOff: getBoolField('force_off'),
            maxTimeOn: getFieldValue('max_time_on'),
            minTimeOn: getFieldValue('min_time_on'),
            minOffTime: getFieldValue('min_off_time') || getFieldValue('min_stop_time'),
            upperLimit: getFieldValue('upper_temp') || getFieldValue('upper_limit'),
            lowerLimit: getFieldValue('lower_temp') || getFieldValue('lower_limit'),
            deviceType: deviceLabel,
        };
    }
    /**
     * Get coil data from global context
     */
    getCoilData() {
        return this.globalContext.get(constants_1.CONTEXT_KEYS.COIL_REGISTER_DATA) || {};
    }
    /**
     * Get sensor data from global context
     */
    getSensorData() {
        return this.globalContext.get(constants_1.CONTEXT_KEYS.SENSOR_REGISTER_DATA) || {};
    }
    /**
     * Get specific coil state
     */
    getCoilState(coilKey) {
        const coilData = this.getCoilData();
        return Boolean(coilData[coilKey]);
    }
    /**
     * Get specific sensor value
     */
    getSensorValue(sensorKey) {
        const sensorData = this.getSensorData();
        return sensorData[sensorKey];
    }
}
exports.ConfigService = ConfigService;

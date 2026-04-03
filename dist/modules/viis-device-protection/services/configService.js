"use strict";
/**
 * Configuration Service for VIIS Device Protection Node
 * Handles reading/writing protection configuration from global context
 *
 * Field naming convention matches device profile:
 * - lamp_protect_bypass, lamp_protect_force_on, lamp_protect_max_time_on, etc.
 * - fan_protect_intake_bypass, fan_protect_intake_force_on, etc.
 * - fan_protect_circ_bypass, fan_protect_circ_force_on, etc.
 * - cool_protect_1_bypass, cool_protect_1_force_on, etc.
 * - cool_protect_2_bypass, cool_protect_2_force_on, etc.
 * - humid_protect_bypass, humid_protect_force_on, etc.
 * - dehumid_protect_bypass, dehumid_protect_force_on, etc.
 * - co2_protect_bypass, co2_protect_force_on, etc.
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
     * Resolution order for new function identifiers:
     * 1) Exact key: lamp_control_1_protect_*
     * 2) Generalized prefixes: lamp_control_protect_*, lamp_protect_*
     * 3) Device type prefixes: fan_protect_intake_*, fan_protect_circ_*, cool_protect_1_*, etc.
     *
     * Example: deviceLabel = "lamp_control_1"
     * - exact: lamp_control_1_protect_max_time_on
     * - fallback: lamp_control_protect_max_time_on
     * - fallback: lamp_protect_max_time_on
     *
     * Example: deviceLabel = "fan_control_intake"
     * - exact: fan_control_intake_protect_max_time_on
     * - fallback: fan_control_protect_max_time_on
     * - fallback: fan_protect_intake_max_time_on
     * - fallback: fan_protect_max_time_on
     */
    getProtectionConfigByLabel(deviceLabel) {
        const configKeyValues = this.getConfigKeyValues();
        const buildLookupLabels = (label) => {
            const labels = [label];
            const parts = label.split('_');
            // Add generalized prefixes by removing trailing segments.
            // Example: lamp_control_1 -> lamp_control -> lamp
            // Example: fan_control_intake -> fan_control -> fan
            // Example: cool_control_ac1 -> cool_control -> cool
            for (let i = parts.length - 1; i >= 1; i--) {
                labels.push(parts.slice(0, i).join('_'));
            }
            // Add device-type specific prefixes for new function identifiers
            // Map control keys to protect keys
            if (label.includes('lamp_control')) {
                labels.push('lamp_protect');
            }
            else if (label.includes('fan_control_intake')) {
                labels.push('fan_protect_intake');
                labels.push('fan_protect');
            }
            else if (label.includes('fan_control_circ')) {
                labels.push('fan_protect_circ');
                labels.push('fan_protect');
            }
            else if (label.includes('fan_control_dc')) {
                labels.push('fan_protect_dc');
                labels.push('fan_protect');
            }
            else if (label.includes('cool_control_ac1') || label.includes('cool_ac1')) {
                labels.push('cool_protect_1');
                labels.push('cool_protect');
            }
            else if (label.includes('cool_control_ac2') || label.includes('cool_ac2')) {
                labels.push('cool_protect_2');
                labels.push('cool_protect');
            }
            else if (label.includes('cool_control_freezer')) {
                labels.push('cool_protect_freezer');
                labels.push('cool_protect');
            }
            else if (label.includes('humid_control') || label.includes('humid')) {
                labels.push('humid_protect');
            }
            else if (label.includes('dehumid_control') || label.includes('dehumid')) {
                labels.push('dehumid_protect');
            }
            else if (label.includes('co2_control') || label.includes('co2')) {
                labels.push('co2_protect');
            }
            return labels;
        };
        const lookupLabels = buildLookupLabels(deviceLabel);
        const resolveValue = (field, transformer, defaultValue) => {
            for (const label of lookupLabels) {
                const key = `${label}_protect_${field}`;
                if (Object.prototype.hasOwnProperty.call(configKeyValues, key)) {
                    return transformer(configKeyValues[key]);
                }
            }
            return defaultValue;
        };
        // Helper to get field value
        const getFieldValue = (field) => {
            return resolveValue(field, (value) => Number(value || 0), 0);
        };
        const getBoolField = (field) => {
            return resolveValue(field, (value) => Boolean(value), false);
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

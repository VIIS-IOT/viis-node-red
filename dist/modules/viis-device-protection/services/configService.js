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
     *
     * Lookup: {deviceLabel}_protect_{field}
     * Example: deviceKey="lamp" → deviceLabel="lamp" → lamp_protect_all_max_time_on
     */
    getProtectionConfig(deviceKey) {
        const configKeyValues = this.getConfigKeyValues();
        const deviceLabel = constants_1.DEVICE_LABEL_MAP[deviceKey] || deviceKey;
        // Helper to get field value — try _protect_all_ first, then _protect_
        const getFieldValue = (field) => {
            const allKey = `${deviceLabel}_all_${field}`;
            if (Object.prototype.hasOwnProperty.call(configKeyValues, allKey)) {
                return Number(configKeyValues[allKey] || 0);
            }
            const key = `${deviceLabel}_${field}`;
            return Number(configKeyValues[key] || 0);
        };
        const getBoolField = (field) => {
            const allKey = `${deviceLabel}_all_${field}`;
            if (Object.prototype.hasOwnProperty.call(configKeyValues, allKey)) {
                return Boolean(configKeyValues[allKey]);
            }
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
            sensorId: (configKeyValues[`${deviceLabel}_all_sensor_id`] || configKeyValues[`${deviceLabel}_sensor_id`])
                ? String(configKeyValues[`${deviceLabel}_all_sensor_id`] || configKeyValues[`${deviceLabel}_sensor_id`])
                : null,
            deviceType: deviceKey,
        };
    }
    /**
     * Get protection config by device label (dynamic coil names)
     *
     * 2-level lookup chain:
     * 1) Specific coil: lamp_control_1_protect_*
     * 2) All rule:      lamp_protect_all_*
     *
     * Example: deviceLabel = "lamp_control_1"
     * - lamp_control_1_protect_max_time_on  (specific)
     * - lamp_protect_all_max_time_on        (all lamps)
     *
     * Sub-type lookup (fan, cool):
     * - fan_control_intake → fan_protect_all → fan_protect_intake
     * - cool_control_ac1   → cool_protect_all → cool_protect_1
     */
    getProtectionConfigByLabel(deviceLabel) {
        const configKeyValues = this.getConfigKeyValues();
        const buildLookupLabels = (label) => {
            const labels = [label];
            const parts = label.split('_');
            const deviceType = parts[0]; // "lamp", "fan", "cool", etc.
            // Priority 2: all rule (e.g., lamp_protect_all)
            labels.push(`${deviceType}_protect_all`);
            // Sub-type specific prefixes (for devices with sub-types like fan, cool)
            if (label.includes('fan_control_intake')) {
                labels.push('fan_protect_intake');
            }
            else if (label.includes('fan_control_circ')) {
                labels.push('fan_protect_circ');
            }
            else if (label.includes('fan_control_dc')) {
                labels.push('fan_protect_dc');
            }
            else if (label.includes('cool_control_ac1') || label.includes('cool_ac1')) {
                labels.push('cool_protect_1');
            }
            else if (label.includes('cool_control_ac2') || label.includes('cool_ac2')) {
                labels.push('cool_protect_2');
            }
            else if (label.includes('cool_control_freezer')) {
                labels.push('cool_protect_freezer');
            }
            return labels;
        };
        const lookupLabels = buildLookupLabels(deviceLabel);
        const resolveValue = (field, transformer, defaultValue) => {
            for (const label of lookupLabels) {
                // Labels with _protect_ already include the prefix (e.g., lamp_protect_all)
                // Coil labels need _protect_ appended (e.g., lamp_control_1 → lamp_control_1_protect_)
                const key = label.includes('_protect')
                    ? `${label}_${field}`
                    : `${label}_protect_${field}`;
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
        const getStringField = (field) => {
            return resolveValue(field, (value) => value ? String(value) : null, null);
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
            sensorId: getStringField('sensor_id'),
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

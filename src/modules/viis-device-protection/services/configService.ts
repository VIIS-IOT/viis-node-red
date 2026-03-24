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

import { Node } from "node-red";
import { CONTEXT_KEYS, DEVICE_LABEL_MAP } from "../constants";

export interface ProtectionConfig {
    bypass: boolean;
    forceOn: boolean;
    forceOff: boolean;
    maxTimeOn: number;
    minTimeOn: number;
    minOffTime: number;
    upperLimit: number;
    lowerLimit: number;
    deviceType: string;
}

export class ConfigService {
    private node: Node;
    private globalContext: any;

    constructor(node: Node) {
        this.node = node;
        this.globalContext = node.context().global;
    }

    /**
     * Get all config values from global context
     */
    getConfigKeyValues(): Record<string, any> {
        return this.globalContext.get(CONTEXT_KEYS.GLOBAL_CONFIG_VALUES) || {};
    }

    /**
     * Get protection config for a specific device
     * Matches field naming from device profile
     */
    getProtectionConfig(deviceKey: string): ProtectionConfig {
        const configKeyValues = this.getConfigKeyValues();
        const deviceLabel = DEVICE_LABEL_MAP[deviceKey as keyof typeof DEVICE_LABEL_MAP] || deviceKey;

        // Helper to get field value
        const getFieldValue = (field: string): number => {
            const key = `${deviceLabel}_${field}`;
            return Number(configKeyValues[key] || 0);
        };

        const getBoolField = (field: string): boolean => {
            const key = `${deviceLabel}_${field}`;
            return Boolean(configKeyValues[key]);
        };

        return {
            bypass: getBoolField('bypass'),
            forceOn: getBoolField('force_on'),
            forceOff: getBoolField('force_off'),
            maxTimeOn: getFieldValue('max_time_on'),
            minTimeOn: getFieldValue('min_time_on'),
            minOffTime: getFieldValue('min_off_time') || getFieldValue('min_stop_time'),  // CO2 uses min_stop_time
            upperLimit: getFieldValue('upper_temp') || getFieldValue('upper_limit'),
            lowerLimit: getFieldValue('lower_temp') || getFieldValue('lower_limit'),
            deviceType: deviceKey,
        };
    }

    /**
     * Get protection config by device label (dynamic coil names)
     * Example: deviceLabel = "lamp_control_1" → looks for "lamp_control_1_protect_*"
     */
    getProtectionConfigByLabel(deviceLabel: string): ProtectionConfig {
        const configKeyValues = this.getConfigKeyValues();

        // Helper to get field value
        const getFieldValue = (field: string): number => {
            const key = `${deviceLabel}_protect_${field}`;
            return Number(configKeyValues[key] || 0);
        };

        const getBoolField = (field: string): boolean => {
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
    getCoilData(): Record<string, boolean> {
        return this.globalContext.get(CONTEXT_KEYS.COIL_REGISTER_DATA) || {};
    }

    /**
     * Get sensor data from global context
     */
    getSensorData(): Record<string, number> {
        return this.globalContext.get(CONTEXT_KEYS.SENSOR_REGISTER_DATA) || {};
    }

    /**
     * Get specific coil state
     */
    getCoilState(coilKey: string): boolean {
        const coilData = this.getCoilData();
        return Boolean(coilData[coilKey]);
    }

    /**
     * Get specific sensor value
     */
    getSensorValue(sensorKey: string): number | undefined {
        const sensorData = this.getSensorData();
        return sensorData[sensorKey];
    }
}

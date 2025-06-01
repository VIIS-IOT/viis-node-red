import { ThresholdConfig, TelemetryData } from "../interfaces/types";
import { DEFAULT_CONFIG } from "../constants";

/**
 * Utility class for checking threshold changes in telemetry data
 */
export class ThresholdChecker {
    private thresholdConfig: ThresholdConfig;
    private defaultThreshold: number;

    constructor(thresholdConfig: ThresholdConfig = {}, defaultThreshold: number = DEFAULT_CONFIG.DEFAULT_THRESHOLD) {
        this.thresholdConfig = thresholdConfig;
        this.defaultThreshold = defaultThreshold;
    }

    /**
     * Update threshold configuration
     */
    updateThresholdConfig(thresholdConfig: ThresholdConfig): void {
        this.thresholdConfig = thresholdConfig;
    }

    /**
     * Check if values have changed beyond their thresholds
     * @param currentData - Current telemetry data
     * @param previousData - Previous telemetry data
     * @returns Object containing only the keys that have changed beyond threshold
     */
    getChangedKeys(currentData: TelemetryData, previousData: TelemetryData): TelemetryData {
        const changedKeys: TelemetryData = {};

        for (const key in currentData) {
            if (!currentData.hasOwnProperty(key)) continue;

            const currentValue = currentData[key];
            const previousValue = previousData[key];

            // If key doesn't exist in previous data, it's a new key - include it
            if (previousValue === undefined) {
                changedKeys[key] = currentValue;
                continue;
            }

            // Check if value has changed beyond threshold
            if (this.hasValueChangedBeyondThreshold(key, currentValue, previousValue)) {
                changedKeys[key] = currentValue;
            }
        }

        return changedKeys;
    }

    /**
     * Check if a specific value has changed beyond its threshold
     * @param key - The data key
     * @param currentValue - Current value
     * @param previousValue - Previous value
     * @returns True if value has changed beyond threshold
     */
    private hasValueChangedBeyondThreshold(key: string, currentValue: any, previousValue: any): boolean {
        // For boolean values, any change is significant
        if (typeof currentValue === 'boolean' || typeof previousValue === 'boolean') {
            return currentValue !== previousValue;
        }

        // For string values, any change is significant
        if (typeof currentValue === 'string' || typeof previousValue === 'string') {
            return currentValue !== previousValue;
        }

        // For numeric values, check threshold
        if (typeof currentValue === 'number' && typeof previousValue === 'number') {
            const threshold = this.getThresholdForKey(key);
            const difference = Math.abs(currentValue - previousValue);
            return difference >= threshold;
        }

        // For other types, consider any change as significant
        return currentValue !== previousValue;
    }

    /**
     * Get threshold value for a specific key
     * @param key - The data key
     * @returns Threshold value for the key
     */
    private getThresholdForKey(key: string): number {
        return this.thresholdConfig[key] !== undefined 
            ? this.thresholdConfig[key] 
            : this.defaultThreshold;
    }

    /**
     * Check if any values have changed beyond thresholds
     * @param currentData - Current telemetry data
     * @param previousData - Previous telemetry data
     * @returns True if any values have changed beyond their thresholds
     */
    hasAnyValueChanged(currentData: TelemetryData, previousData: TelemetryData): boolean {
        const changedKeys = this.getChangedKeys(currentData, previousData);
        return Object.keys(changedKeys).length > 0;
    }

    /**
     * Get all threshold configurations
     * @returns Current threshold configuration
     */
    getThresholdConfig(): ThresholdConfig {
        return { ...this.thresholdConfig };
    }

    /**
     * Get default threshold value
     * @returns Default threshold value
     */
    getDefaultThreshold(): number {
        return this.defaultThreshold;
    }

    /**
     * Validate threshold configuration
     * @param config - Threshold configuration to validate
     * @returns True if configuration is valid
     */
    static validateThresholdConfig(config: any): config is ThresholdConfig {
        if (typeof config !== 'object' || config === null) {
            return false;
        }

        for (const key in config) {
            if (typeof config[key] !== 'number' || config[key] < 0) {
                return false;
            }
        }

        return true;
    }
}

"use strict";
/**
 * Scaling utility for VIIS RPC Control Node
 * Handles value scaling operations based on configuration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScalingUtils = void 0;
class ScalingUtils {
    constructor(configService, logger) {
        this.configService = configService;
        this.logger = logger.createChild("SCALING");
    }
    /**
     * Scale a value based on the configuration for the given key and direction
     */
    scaleValue(key, value, direction) {
        const scaleConfigs = this.configService.getScaleConfigs();
        const config = scaleConfigs.find((c) => c.key === key && c.direction === direction);
        if (!config) {
            return value;
        }
        const shouldMultiply = config.operation === "multiply";
        const scaledValue = shouldMultiply ? value * config.factor : value / config.factor;
        this.logger.debug(`[SCALE] ${key} (${direction}): ${value} → ${scaledValue}`);
        return scaledValue;
    }
    /**
     * Apply multiple scaling operations to a set of values
     */
    scaleValues(values, direction) {
        const scaledValues = {};
        for (const [key, value] of Object.entries(values)) {
            if (typeof value === "number") {
                scaledValues[key] = this.scaleValue(key, value, direction);
            }
            else {
                scaledValues[key] = value;
            }
        }
        return scaledValues;
    }
    /**
     * Validate a scale configuration
     */
    static validateScaleConfig(config) {
        return (typeof config.key === "string" &&
            config.key.length > 0 &&
            ["multiply", "divide"].includes(config.operation) &&
            typeof config.factor === "number" &&
            config.factor > 0 &&
            ["read", "write"].includes(config.direction));
    }
    /**
     * Validate an array of scale configurations
     */
    static validateScaleConfigs(configs) {
        const errors = [];
        if (!Array.isArray(configs)) {
            return { valid: false, errors: ["Scale configs must be an array"] };
        }
        configs.forEach((config, index) => {
            if (!ScalingUtils.validateScaleConfig(config)) {
                errors.push(`Invalid scale config at index ${index}: ${JSON.stringify(config)}`);
            }
        });
        return { valid: errors.length === 0, errors };
    }
    /**
     * Get all keys that have scaling configured for a specific direction
     */
    getScaledKeys(direction) {
        const scaleConfigs = this.configService.getScaleConfigs();
        return scaleConfigs
            .filter(config => config.direction === direction)
            .map(config => config.key);
    }
    /**
     * Check if a key has scaling configured for a specific direction
     */
    hasScaling(key, direction) {
        const scaleConfigs = this.configService.getScaleConfigs();
        return scaleConfigs.some(config => config.key === key && config.direction === direction);
    }
    /**
     * Get scaling factor for a specific key and direction
     */
    getScalingFactor(key, direction) {
        const scaleConfigs = this.configService.getScaleConfigs();
        const config = scaleConfigs.find(config => config.key === key && config.direction === direction);
        return config ? config.factor : null;
    }
    /**
     * Get scaling operation for a specific key and direction
     */
    getScalingOperation(key, direction) {
        const scaleConfigs = this.configService.getScaleConfigs();
        const config = scaleConfigs.find(config => config.key === key && config.direction === direction);
        return config ? config.operation : null;
    }
}
exports.ScalingUtils = ScalingUtils;

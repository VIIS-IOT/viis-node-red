/**
 * Scaling utility for VIIS RPC Control Node
 * Handles value scaling operations based on configuration
 */

import { ScaleConfig, IScalingUtils, IConfigService } from "../interfaces/types";
import { Logger } from "./logger";

export class ScalingUtils implements IScalingUtils {
    private configService: IConfigService;
    private logger: Logger;

    constructor(configService: IConfigService, logger: Logger) {
        this.configService = configService;
        this.logger = logger.createChild("SCALING");
    }

    /**
     * Scale a value based on the configuration for the given key and direction
     */
    scaleValue(key: string, value: number, direction: "read" | "write"): number {
        const scaleConfigs = this.configService.getScaleConfigs();
        this.logger.warn(`scaleConfigs is ${scaleConfigs}`)
        const config = scaleConfigs.find((c) => c.key === key && c.direction === direction);
        
        if (!config) {
            // Debug: Log when no config found for write operations
            if (direction === "write") {
                const writeConfigs = scaleConfigs.filter((c) => c.direction === "write");
                const keyConfigs = scaleConfigs.filter((c) => c.key === key);
                this.logger.warn(`[SCALE-DEBUG] No config for key="${key}" direction="${direction}" | Total configs: ${scaleConfigs.length} | Write configs: ${JSON.stringify(writeConfigs)} | Configs for this key: ${JSON.stringify(keyConfigs)}`);
            }
            return value;
        }

        const shouldMultiply = config.operation === "multiply";
        const scaledValue = shouldMultiply ? value * config.factor : value / config.factor;
        
        // Always log scaling operations at warn level for debugging
        this.logger.warn(`[SCALE-APPLIED] ${key} (${direction}): ${value} → ${scaledValue} | op=${config.operation} factor=${config.factor} shouldMultiply=${shouldMultiply}`);
        
        return scaledValue;
    }

    /**
     * Apply multiple scaling operations to a set of values
     */
    scaleValues(values: Record<string, number>, direction: "read" | "write"): Record<string, number> {
        const scaledValues: Record<string, number> = {};
        
        for (const [key, value] of Object.entries(values)) {
            if (typeof value === "number") {
                scaledValues[key] = this.scaleValue(key, value, direction);
            } else {
                scaledValues[key] = value;
            }
        }
        
        return scaledValues;
    }

    /**
     * Validate a scale configuration
     */
    static validateScaleConfig(config: ScaleConfig): boolean {
        return (
            typeof config.key === "string" &&
            config.key.length > 0 &&
            ["multiply", "divide"].includes(config.operation) &&
            typeof config.factor === "number" &&
            config.factor > 0 &&
            ["read", "write"].includes(config.direction)
        );
    }

    /**
     * Validate an array of scale configurations
     */
    static validateScaleConfigs(configs: ScaleConfig[]): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
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
    getScaledKeys(direction: "read" | "write"): string[] {
        const scaleConfigs = this.configService.getScaleConfigs();
        return scaleConfigs
            .filter(config => config.direction === direction)
            .map(config => config.key);
    }

    /**
     * Check if a key has scaling configured for a specific direction
     */
    hasScaling(key: string, direction: "read" | "write"): boolean {
        const scaleConfigs = this.configService.getScaleConfigs();
        return scaleConfigs.some(config => config.key === key && config.direction === direction);
    }

    /**
     * Get scaling factor for a specific key and direction
     */
    getScalingFactor(key: string, direction: "read" | "write"): number | null {
        const scaleConfigs = this.configService.getScaleConfigs();
        const config = scaleConfigs.find(config => config.key === key && config.direction === direction);
        return config ? config.factor : null;
    }

    /**
     * Get scaling operation for a specific key and direction
     */
    getScalingOperation(key: string, direction: "read" | "write"): "multiply" | "divide" | null {
        const scaleConfigs = this.configService.getScaleConfigs();
        const config = scaleConfigs.find(config => config.key === key && config.direction === direction);
        return config ? config.operation : null;
    }
}

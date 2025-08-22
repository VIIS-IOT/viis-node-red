/**
 * Configuration Service for VIIS RPC Control Node
 * Manages configuration keys, scale configs, and their validation
 */

import {
    IConfigService,
    ConfigKey,
    ScaleConfig,
    ConfigKeyValues,
    ServiceOptions
} from "../interfaces/types";
import { CONTEXT_KEYS, VALIDATION, ERROR_MESSAGES } from "../constants";
import { Logger } from "../utils/logger";

export class ConfigService implements IConfigService {
    private globalContext: any;
    private logger: Logger;

    constructor(options: ServiceOptions) {
        this.globalContext = options.globalContext;
        this.logger = new Logger(options.node, "CONFIG-SERVICE");
    }

    /**
     * Get configuration keys from global context
     */
    getConfigKeys(): ConfigKey {
        return this.globalContext.get(CONTEXT_KEYS.GLOBAL_CONFIG_KEYS) as ConfigKey || {};
    }

    /**
     * Get scale configurations from flow context
     */
    getScaleConfigs(): ScaleConfig[] {
        return this.globalContext.get(CONTEXT_KEYS.GLOBAL_SCALE_CONFIGS) as ScaleConfig[] || [];
    }

    /**
     * Get configuration key values from global context
     */
    getConfigKeyValues(): ConfigKeyValues {
        return this.globalContext.get(CONTEXT_KEYS.GLOBAL_CONFIG_VALUES) as ConfigKeyValues || {};
    }

    /**
     * Set configuration key values in global context
     */
    setConfigKeyValues(values: ConfigKeyValues): void {
        this.globalContext.set(CONTEXT_KEYS.GLOBAL_CONFIG_VALUES, values);
        this.logger.debug(`Updated config key values: ${JSON.stringify(values)}`);
    }

    /**
     * Update scale configurations in flow context
     */
    updateScaleConfigs(configs: ScaleConfig[]): void {
        this.validateScaleConfigs(configs);
        this.globalContext.set(CONTEXT_KEYS.GLOBAL_SCALE_CONFIGS, configs);
        this.logger.log(`Updated scale configs: ${JSON.stringify(configs)}`);
    }

    /**
     * Update configuration keys in global context
     */
    updateConfigKeys(keys: ConfigKey): void {
        this.validateConfigKeys(keys);

        // Merge with existing global configKeys
        const existingConfigKeys = this.getConfigKeys();
        const mergedConfigKeys = { ...existingConfigKeys, ...keys };

        this.globalContext.set(CONTEXT_KEYS.GLOBAL_CONFIG_KEYS, mergedConfigKeys);
        this.logger.log(`Updated config keys: ${JSON.stringify(mergedConfigKeys)}`);
    }

    /**
     * Initialize configuration from node definition
     */
    initializeConfig(configKeys: string, scaleConfigs: string): void {
        // Parse and validate configKeys
        let parsedConfigKeys: ConfigKey = {};
        try {
            parsedConfigKeys = configKeys ? JSON.parse(configKeys) : {};
            if (typeof parsedConfigKeys !== 'object' || Array.isArray(parsedConfigKeys) || parsedConfigKeys === null) {
                parsedConfigKeys = {};
            }
        } catch (error) {
            this.logger.warn(`Failed to parse configKeys, using empty object: ${(error as Error).message}`);
            parsedConfigKeys = {};
        }

        // Parse and validate scaleConfigs
        let parsedScaleConfigs: ScaleConfig[] = [];
        try {
            parsedScaleConfigs = scaleConfigs ? JSON.parse(scaleConfigs) : [];
            if (!Array.isArray(parsedScaleConfigs)) {
                parsedScaleConfigs = [];
            }
        } catch (error) {
            this.logger.warn(`Failed to parse scaleConfigs, using empty array: ${(error as Error).message}`);
            parsedScaleConfigs = [];
        }

        // Validate configurations
        this.validateConfigKeys(parsedConfigKeys);
        this.validateScaleConfigs(parsedScaleConfigs);

        // Store configurations
        this.globalContext.set(CONTEXT_KEYS.GLOBAL_SCALE_CONFIGS, parsedScaleConfigs);

        // Initialize global configs if not exist
        if (!this.globalContext.get(CONTEXT_KEYS.GLOBAL_CONFIG_KEYS)) {
            this.globalContext.set(CONTEXT_KEYS.GLOBAL_CONFIG_KEYS, parsedConfigKeys);
        } else {
            this.updateConfigKeys(parsedConfigKeys);
        }

        if (!this.globalContext.get(CONTEXT_KEYS.GLOBAL_CONFIG_VALUES)) {
            this.globalContext.set(CONTEXT_KEYS.GLOBAL_CONFIG_VALUES, {});
        }

        this.logger.log("Configuration initialized successfully");
    }

    /**
     * Validate scale configurations
     */
    validateScaleConfigs(configs: ScaleConfig[]): void {
        if (!Array.isArray(configs)) {
            throw new Error("Scale configs must be an array");
        }

        configs.forEach((conf, index) => {
            if (!conf.key ||
                !conf.operation ||
                typeof conf.factor !== "number" ||
                !VALIDATION.SUPPORTED_SCALE_DIRECTIONS.includes(conf.direction as any) ||
                !VALIDATION.SUPPORTED_SCALE_OPERATIONS.includes(conf.operation as any)) {
                throw new Error(ERROR_MESSAGES.INVALID_SCALE_CONFIG(`${JSON.stringify(conf)} at index ${index}`));
            }
        });
    }

    /**
     * Validate configuration keys
     */
    validateConfigKeys(keys: ConfigKey): void {
        if (typeof keys !== 'object' || Array.isArray(keys) || keys === null) {
            throw new Error("Config keys must be a valid object");
        }

        Object.entries(keys).forEach(([key, type]) => {
            if (!VALIDATION.SUPPORTED_TYPES.includes(type as any)) {
                throw new Error(ERROR_MESSAGES.INVALID_TYPE(type, key));
            }
        });
    }

    /**
     * Add a new configuration key with auto-detected type
     */
    addConfigKey(key: string, value: any): void {
        const configKeys = this.getConfigKeys();

        // Auto-detect type with proper boolean detection
        let detectedType: "number" | "boolean" | "string" = "string";

        // Check boolean first to avoid Number() conversion confusion
        if (typeof value === "boolean") {
            detectedType = "boolean";
        } else if (typeof value === "string" && (value.toLowerCase() === "true" || value.toLowerCase() === "false")) {
            detectedType = "boolean";
        } else if (typeof value === "number" && !isNaN(value) && isFinite(value)) {
            detectedType = "number";
        } else if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value.trim())) && isFinite(Number(value.trim()))) {
            detectedType = "number";
        } else {
            detectedType = "string";
        }

        // Add new key to configKeys
        const updatedConfigKeys = { ...configKeys, [key]: detectedType };
        this.globalContext.set(CONTEXT_KEYS.GLOBAL_CONFIG_KEYS, updatedConfigKeys);

        this.logger.log(`Auto-added new config key: ${key} with type: ${detectedType}`);
    }

    /**
     * Remove a specific configuration key
     */
    removeConfigKey(key: string): void {
        const configKeys = this.getConfigKeys();
        if (key in configKeys) {
            const updatedConfigKeys = { ...configKeys };
            delete updatedConfigKeys[key];
            this.globalContext.set(CONTEXT_KEYS.GLOBAL_CONFIG_KEYS, updatedConfigKeys);
            this.logger.log(`Removed config key: ${key}`);
        }
    }

    /**
     * Clear all configurations for this node
     */
    clearNodeConfigs(): void {
        this.globalContext.set(CONTEXT_KEYS.GLOBAL_SCALE_CONFIGS, []);
        this.logger.log("Cleared node-specific configurations");
    }

    /**
     * Get manual overrides from flow context
     */
    getManualOverrides(): Record<string, any> {
        return this.globalContext.get(CONTEXT_KEYS.GLOBAL_MANUAL_OVERRIDES) || {};
    }

    /**
     * Set manual overrides in flow context
     */
    setManualOverrides(overrides: Record<string, any>): void {
        this.globalContext.set(CONTEXT_KEYS.GLOBAL_MANUAL_OVERRIDES, overrides);
    }

    /**
     * Initialize manual overrides if not exists
     */
    initializeManualOverrides(): void {
        if (!this.globalContext.get(CONTEXT_KEYS.GLOBAL_MANUAL_OVERRIDES)) {
            this.globalContext.set(CONTEXT_KEYS.GLOBAL_MANUAL_OVERRIDES, {});
        }
    }
}

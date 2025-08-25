"use strict";
/**
 * Configuration Service for VIIS RPC Control Node
 * Manages configuration keys, scale configs, and their validation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigService = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
class ConfigService {
    constructor(options) {
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(options.node, "CONFIG-SERVICE");
    }
    /**
     * Get configuration keys from global context
     */
    getConfigKeys() {
        return this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_KEYS) || {};
    }
    /**
     * Get scale configurations from flow context
     */
    getScaleConfigs() {
        return this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_SCALE_CONFIGS) || [];
    }
    /**
     * Get configuration key values from global context
     */
    getConfigKeyValues() {
        return this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_VALUES) || {};
    }
    /**
     * Set configuration key values in global context
     */
    setConfigKeyValues(values) {
        this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_VALUES, values);
        this.logger.debug(`Updated config key values: ${JSON.stringify(values)}`);
    }
    /**
     * Update scale configurations in flow context
     */
    updateScaleConfigs(configs) {
        this.validateScaleConfigs(configs);
        this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_SCALE_CONFIGS, configs);
        this.logger.log(`Updated scale configs: ${JSON.stringify(configs)}`);
    }
    /**
     * Update configuration keys in global context
     */
    updateConfigKeys(keys) {
        this.validateConfigKeys(keys);
        // Merge with existing global configKeys
        const existingConfigKeys = this.getConfigKeys();
        const mergedConfigKeys = Object.assign(Object.assign({}, existingConfigKeys), keys);
        this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_KEYS, mergedConfigKeys);
        this.logger.log(`Updated config keys: ${JSON.stringify(mergedConfigKeys)}`);
    }
    /**
     * Initialize configuration from node definition
     */
    initializeConfig(configKeys, scaleConfigs) {
        // Parse and validate configKeys
        let parsedConfigKeys = {};
        try {
            parsedConfigKeys = configKeys ? JSON.parse(configKeys) : {};
            if (typeof parsedConfigKeys !== 'object' || Array.isArray(parsedConfigKeys) || parsedConfigKeys === null) {
                parsedConfigKeys = {};
            }
        }
        catch (error) {
            this.logger.warn(`Failed to parse configKeys, using empty object: ${error.message}`);
            parsedConfigKeys = {};
        }
        // Parse and validate scaleConfigs
        let parsedScaleConfigs = [];
        try {
            parsedScaleConfigs = scaleConfigs ? JSON.parse(scaleConfigs) : [];
            if (!Array.isArray(parsedScaleConfigs)) {
                parsedScaleConfigs = [];
            }
        }
        catch (error) {
            this.logger.warn(`Failed to parse scaleConfigs, using empty array: ${error.message}`);
            parsedScaleConfigs = [];
        }
        // Validate configurations
        this.validateConfigKeys(parsedConfigKeys);
        this.validateScaleConfigs(parsedScaleConfigs);
        // Store configurations
        this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_SCALE_CONFIGS, parsedScaleConfigs);
        // Initialize global configs if not exist
        if (!this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_KEYS)) {
            this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_KEYS, parsedConfigKeys);
        }
        else {
            this.updateConfigKeys(parsedConfigKeys);
        }
        if (!this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_VALUES)) {
            this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_VALUES, {});
        }
        this.logger.log("Configuration initialized successfully");
    }
    /**
     * Validate scale configurations
     */
    validateScaleConfigs(configs) {
        if (!Array.isArray(configs)) {
            throw new Error("Scale configs must be an array");
        }
        configs.forEach((conf, index) => {
            if (!conf.key ||
                !conf.operation ||
                typeof conf.factor !== "number" ||
                !constants_1.VALIDATION.SUPPORTED_SCALE_DIRECTIONS.includes(conf.direction) ||
                !constants_1.VALIDATION.SUPPORTED_SCALE_OPERATIONS.includes(conf.operation)) {
                throw new Error(constants_1.ERROR_MESSAGES.INVALID_SCALE_CONFIG(`${JSON.stringify(conf)} at index ${index}`));
            }
        });
    }
    /**
     * Validate configuration keys
     */
    validateConfigKeys(keys) {
        if (typeof keys !== 'object' || Array.isArray(keys) || keys === null) {
            throw new Error("Config keys must be a valid object");
        }
        Object.entries(keys).forEach(([key, type]) => {
            if (!constants_1.VALIDATION.SUPPORTED_TYPES.includes(type)) {
                throw new Error(constants_1.ERROR_MESSAGES.INVALID_TYPE(type, key));
            }
        });
    }
    /**
     * Add a new configuration key with auto-detected type
     */
    addConfigKey(key, value) {
        const configKeys = this.getConfigKeys();
        // Auto-detect type with proper boolean detection
        let detectedType = "string";
        // Check boolean first to avoid Number() conversion confusion
        if (typeof value === "boolean") {
            detectedType = "boolean";
        }
        else if (typeof value === "string" && (value.toLowerCase() === "true" || value.toLowerCase() === "false")) {
            detectedType = "boolean";
        }
        else if (typeof value === "number" && !isNaN(value) && isFinite(value)) {
            detectedType = "number";
        }
        else if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value.trim())) && isFinite(Number(value.trim()))) {
            detectedType = "number";
        }
        else {
            detectedType = "string";
        }
        // Add new key to configKeys
        const updatedConfigKeys = Object.assign(Object.assign({}, configKeys), { [key]: detectedType });
        this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_KEYS, updatedConfigKeys);
        this.logger.log(`Auto-added new config key: ${key} with type: ${detectedType}`);
    }
    /**
     * Remove a specific configuration key
     */
    removeConfigKey(key) {
        const configKeys = this.getConfigKeys();
        if (key in configKeys) {
            const updatedConfigKeys = Object.assign({}, configKeys);
            delete updatedConfigKeys[key];
            this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_KEYS, updatedConfigKeys);
            this.logger.log(`Removed config key: ${key}`);
        }
    }
    /**
     * Clear all configurations for this node
     */
    clearNodeConfigs() {
        this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_SCALE_CONFIGS, []);
        this.logger.log("Cleared node-specific configurations");
    }
    /**
     * Get manual overrides from flow context
     */
    getManualOverrides() {
        return this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_MANUAL_OVERRIDES) || {};
    }
    /**
     * Set manual overrides in flow context
     */
    setManualOverrides(overrides) {
        this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_MANUAL_OVERRIDES, overrides);
    }
    /**
     * Initialize manual overrides if not exists
     */
    initializeManualOverrides() {
        if (!this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_MANUAL_OVERRIDES)) {
            this.globalContext.set(constants_1.CONTEXT_KEYS.GLOBAL_MANUAL_OVERRIDES, {});
        }
    }
}
exports.ConfigService = ConfigService;

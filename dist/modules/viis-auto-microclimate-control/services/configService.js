"use strict";
/**
 * Configuration Service for VIIS Auto Microclimate Control Node
 * Handles reading and validating configuration from global variables
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigService = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
class ConfigService {
    constructor(options) {
        this.cachedConfig = null;
        this.lastConfigUpdate = 0;
        this.CONFIG_CACHE_TTL = 30000; // 30 seconds
        this.CONFIG_UPDATED_AT_KEY = "configKeyValuesUpdatedAt";
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(options.node, options.nodeId);
    }
    /**
     * Get current configuration from global variables
     */
    getConfig() {
        try {
            // Check if cached config is still valid
            if (this.cachedConfig && this.isCacheValid()) {
                return this.cachedConfig;
            }
            // Read fresh config from global context
            const configKeyValues = this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_VALUES) || {};
            if (!configKeyValues || typeof configKeyValues !== 'object') {
                this.logger.warn("No configuration found in global context, using defaults");
                return this.getDefaultConfig();
            }
            // Extract only the keys we care about
            const config = {};
            constants_1.CONFIG_KEYS.forEach(key => {
                if (configKeyValues.hasOwnProperty(key)) {
                    config[key] = configKeyValues[key];
                }
            });
            // Validate and apply defaults for missing values
            this.applyDefaults(config);
            // Cache the config
            this.cachedConfig = config;
            this.lastConfigUpdate = Date.now();
            this.logger.debug(`Configuration loaded: ${JSON.stringify(config)}`);
            return config;
        }
        catch (error) {
            this.logger.error(`${constants_1.ERROR_MESSAGES.CONFIG_READ_ERROR}: ${error.message}`);
            return this.getDefaultConfig();
        }
    }
    /**
     * Check if configuration is valid
     */
    isConfigValid() {
        try {
            const config = this.getConfig();
            // Check critical configuration values
            const criticalChecks = [
                // Fan control modes should be 0 or 1
                config.set_mode_fan === undefined || [0, 1].includes(config.set_mode_fan),
                config.set_auto_mode_fan === undefined || [0, 1].includes(config.set_auto_mode_fan),
                // Water pump mode should be 0 or 1
                config.set_mode_tuong_nuoc === undefined || [0, 1].includes(config.set_mode_tuong_nuoc),
                // Curtain mode should be 0 or 1
                config.set_mode_luoi === undefined || [0, 1].includes(config.set_mode_luoi),
                // Temperature thresholds should be reasonable
                config.set_k1_fan === undefined || (config.set_k1_fan >= 0 && config.set_k1_fan <= 100),
                config.set_k2_fan === undefined || (config.set_k2_fan >= 0 && config.set_k2_fan <= 100),
                config.set_k3_fan === undefined || (config.set_k3_fan >= 0 && config.set_k3_fan <= 100),
                config.set_k4_fan === undefined || (config.set_k4_fan >= 0 && config.set_k4_fan <= 100),
                // Group size should be valid
                config.set_gr_alternate_fan === undefined || [1, 2, 4, 6].includes(config.set_gr_alternate_fan),
                // Time intervals should be positive
                config.set_time_alternate_fan === undefined || config.set_time_alternate_fan > 0,
                config.set_time_alternate_fan_dao === undefined || config.set_time_alternate_fan_dao > 0,
                // Humidity thresholds should be reasonable (0-100%)
                config.set_threshold_low_water_bump === undefined || (config.set_threshold_low_water_bump >= 0 && config.set_threshold_low_water_bump <= 100),
                config.set_threshold_high_water_bump === undefined || (config.set_threshold_high_water_bump >= 0 && config.set_threshold_high_water_bump <= 100),
                // Light thresholds should be positive
                config.set_light_dai_luoi_1 === undefined || config.set_light_dai_luoi_1 >= 0,
                config.set_light_thu_luoi_1 === undefined || config.set_light_thu_luoi_1 >= 0,
                config.set_light_dai_luoi_2 === undefined || config.set_light_dai_luoi_2 >= 0,
                config.set_light_thu_luoi_2 === undefined || config.set_light_thu_luoi_2 >= 0,
                // Tolerance times should be positive
                config.set_tolerance_light_luoi_1 === undefined || config.set_tolerance_light_luoi_1 > 0,
                config.set_tolerance_light_luoi_2 === undefined || config.set_tolerance_light_luoi_2 > 0
            ];
            const isValid = criticalChecks.every(check => check);
            if (!isValid) {
                this.logger.warn("Configuration validation failed");
            }
            return isValid;
        }
        catch (error) {
            this.logger.error(`Configuration validation error: ${error.message}`);
            return false;
        }
    }
    /**
     * Get a specific configuration value
     */
    getConfigValue(key) {
        const config = this.getConfig();
        return config[key];
    }
    /**
     * Check if cached config is still valid
     */
    isCacheValid() {
        const latestConfigUpdateMarker = Number(this.globalContext.get(this.CONFIG_UPDATED_AT_KEY) || 0);
        if (latestConfigUpdateMarker > this.lastConfigUpdate) {
            return false;
        }
        const now = Date.now();
        return (now - this.lastConfigUpdate) < this.CONFIG_CACHE_TTL;
    }
    /**
     * Apply default values for missing configuration
     */
    applyDefaults(config) {
        // Fan control defaults
        if (config.set_mode_fan === undefined)
            config.set_mode_fan = 0;
        if (config.set_auto_mode_fan === undefined)
            config.set_auto_mode_fan = 0;
        if (config.set_k1_fan === undefined)
            config.set_k1_fan = 25;
        if (config.set_k2_fan === undefined)
            config.set_k2_fan = 30;
        if (config.set_k3_fan === undefined)
            config.set_k3_fan = 35;
        if (config.set_k4_fan === undefined)
            config.set_k4_fan = 40;
        if (config.set_gr_alternate_fan === undefined)
            config.set_gr_alternate_fan = 2;
        if (config.set_time_alternate_fan === undefined)
            config.set_time_alternate_fan = 15;
        // Fan dao defaults
        if (config.set_mode_fan_dao === undefined)
            config.set_mode_fan_dao = 0;
        if (config.set_time_alternate_fan_dao === undefined)
            config.set_time_alternate_fan_dao = 5;
        // Water pump defaults
        if (config.set_mode_tuong_nuoc === undefined)
            config.set_mode_tuong_nuoc = 0;
        if (config.set_threshold_low_water_bump === undefined)
            config.set_threshold_low_water_bump = 60;
        if (config.set_threshold_high_water_bump === undefined)
            config.set_threshold_high_water_bump = 80;
        // Curtain defaults
        if (config.set_mode_luoi === undefined)
            config.set_mode_luoi = 0;
        if (config.set_light_dai_luoi_1 === undefined)
            config.set_light_dai_luoi_1 = 50000;
        if (config.set_light_thu_luoi_1 === undefined)
            config.set_light_thu_luoi_1 = 30000;
        if (config.set_tolerance_light_luoi_1 === undefined)
            config.set_tolerance_light_luoi_1 = 5;
        if (config.set_light_dai_luoi_2 === undefined)
            config.set_light_dai_luoi_2 = 50000;
        if (config.set_light_thu_luoi_2 === undefined)
            config.set_light_thu_luoi_2 = 30000;
        if (config.set_tolerance_light_luoi_2 === undefined)
            config.set_tolerance_light_luoi_2 = 5;
    }
    /**
     * Get default configuration
     */
    getDefaultConfig() {
        const defaultConfig = {};
        this.applyDefaults(defaultConfig);
        return defaultConfig;
    }
    /**
     * Invalidate cache to force config reload
     */
    invalidateCache() {
        this.cachedConfig = null;
        this.lastConfigUpdate = 0;
    }
}
exports.ConfigService = ConfigService;

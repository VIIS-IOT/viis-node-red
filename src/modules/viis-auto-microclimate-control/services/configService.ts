/**
 * Configuration Service for VIIS Auto Microclimate Control Node
 * Handles reading and validating configuration from global variables
 */

import {
    IConfigService,
    AutoControlConfig,
    ServiceOptions,
    ILogger
} from "../interfaces/types";
import { CONTEXT_KEYS, CONFIG_KEYS, ERROR_MESSAGES } from "../constants";
import { Logger } from "../utils/logger";

export class ConfigService implements IConfigService {
    private globalContext: any;
    private logger: ILogger;
    private cachedConfig: AutoControlConfig | null = null;
    private lastConfigUpdate: number = 0;
    private readonly CONFIG_CACHE_TTL = 30000; // 30 seconds
    private readonly CONFIG_UPDATED_AT_KEY = "configKeyValuesUpdatedAt";

    constructor(options: ServiceOptions) {
        this.globalContext = options.globalContext;
        this.logger = new Logger(options.node, options.nodeId);
    }

    /**
     * Get current configuration from global variables
     */
    getConfig(): AutoControlConfig {
        try {
            // Check if cached config is still valid
            if (this.cachedConfig && this.isCacheValid()) {
                return this.cachedConfig;
            }

            // Read fresh config from global context
            const configKeyValues = this.globalContext.get(CONTEXT_KEYS.GLOBAL_CONFIG_VALUES) || {};

            if (!configKeyValues || typeof configKeyValues !== 'object') {
                this.logger.warn("No configuration found in global context, using defaults");
                return this.getDefaultConfig();
            }

            // Extract only the keys we care about
            const config: AutoControlConfig = {};

            CONFIG_KEYS.forEach(key => {
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

        } catch (error) {
            this.logger.error(`${ERROR_MESSAGES.CONFIG_READ_ERROR}: ${(error as Error).message}`);
            return this.getDefaultConfig();
        }
    }

    /**
     * Check if configuration is valid
     */
    isConfigValid(): boolean {
        try {
            const config = this.getConfig();

            // Check critical configuration values
            const criticalChecks = [
                // Fan control mode should be 1 (threshold) or 2 (rotation)
                config.set_mode_fan === undefined || [0, 1].includes(config.set_mode_fan),
                config.set_auto_mode_fan === undefined || [1, 2].includes(config.set_auto_mode_fan),

                // Water pump mode should be 0 or 1
                config.set_mode_tuong_nuoc === undefined || [0, 1].includes(config.set_mode_tuong_nuoc),

                // Curtain mode should be 0 or 1
                config.set_mode_luoi === undefined || [0, 1].includes(config.set_mode_luoi),

                // Temperature thresholds should be reasonable
                config.set_k1_fan === undefined || (config.set_k1_fan >= 0 && config.set_k1_fan <= 100),
                config.set_k2_fan === undefined || (config.set_k2_fan >= 0 && config.set_k2_fan <= 100),
                config.set_k3_fan === undefined || (config.set_k3_fan >= 0 && config.set_k3_fan <= 100),
                config.set_k4_fan === undefined || (config.set_k4_fan >= 0 && config.set_k4_fan <= 100),

                // Fan dao mode should be 0, 1, or 2
                config.set_auto_mode_fan_dao === undefined || [0, 1, 2].includes(config.set_auto_mode_fan_dao),

                // Group size should be valid
                config.set_gr_alternate_fan === undefined || [1, 2, 3, 4, 6].includes(config.set_gr_alternate_fan),

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
                config.set_light_dai_luoi_3 === undefined || config.set_light_dai_luoi_3 >= 0,
                config.set_light_thu_luoi_3 === undefined || config.set_light_thu_luoi_3 >= 0,
                config.set_light_dai_luoi_4 === undefined || config.set_light_dai_luoi_4 >= 0,
                config.set_light_thu_luoi_4 === undefined || config.set_light_thu_luoi_4 >= 0,

                // Tolerance times should be positive
                config.set_tolerance_light_luoi_1 === undefined || config.set_tolerance_light_luoi_1 > 0,
                config.set_tolerance_light_luoi_2 === undefined || config.set_tolerance_light_luoi_2 > 0,
                config.set_tolerance_light_luoi_3 === undefined || config.set_tolerance_light_luoi_3 > 0,
                config.set_tolerance_light_luoi_4 === undefined || config.set_tolerance_light_luoi_4 > 0
            ];

            const isValid = criticalChecks.every(check => check);

            if (!isValid) {
                this.logger.warn("Configuration validation failed");
            }

            return isValid;

        } catch (error) {
            this.logger.error(`Configuration validation error: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Get a specific configuration value
     */
    getConfigValue<T>(key: keyof AutoControlConfig): T | undefined {
        const config = this.getConfig();
        return config[key] as T;
    }

    /**
     * Check if cached config is still valid
     */
    private isCacheValid(): boolean {
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
    private applyDefaults(config: AutoControlConfig): void {
        // Fan control defaults
        if (config.set_mode_fan === undefined) config.set_mode_fan = 0;
        if (config.set_auto_mode_fan === undefined) config.set_auto_mode_fan = 1;
        if (config.set_k1_fan === undefined) config.set_k1_fan = 25;
        if (config.set_k2_fan === undefined) config.set_k2_fan = 30;
        if (config.set_k3_fan === undefined) config.set_k3_fan = 35;
        if (config.set_k4_fan === undefined) config.set_k4_fan = 40;
        if (config.set_gr_alternate_fan === undefined) config.set_gr_alternate_fan = 2;
        if (config.set_time_alternate_fan === undefined) config.set_time_alternate_fan = 15;

        // Fan dao defaults
        if (config.set_mode_fan_dao === undefined) config.set_mode_fan_dao = 0;
        if (config.set_auto_mode_fan_dao === undefined) config.set_auto_mode_fan_dao = 1;
        if (config.set_time_alternate_fan_dao === undefined) config.set_time_alternate_fan_dao = 5;
        if (config.set_time_fan_dao_on === undefined) config.set_time_fan_dao_on = 5;
        if (config.set_time_fan_dao_off === undefined) config.set_time_fan_dao_off = 30;

        // Water pump defaults
        if (config.set_mode_tuong_nuoc === undefined) config.set_mode_tuong_nuoc = 0;
        if (config.set_threshold_low_water_bump === undefined) config.set_threshold_low_water_bump = 60;
        if (config.set_threshold_high_water_bump === undefined) config.set_threshold_high_water_bump = 80;

        // Curtain defaults
        if (config.set_mode_luoi === undefined) config.set_mode_luoi = 0;
        if (config.set_light_dai_luoi_1 === undefined) config.set_light_dai_luoi_1 = 50000;
        if (config.set_light_thu_luoi_1 === undefined) config.set_light_thu_luoi_1 = 30000;
        if (config.set_tolerance_light_luoi_1 === undefined) config.set_tolerance_light_luoi_1 = 5;
        if (config.set_light_dai_luoi_2 === undefined) config.set_light_dai_luoi_2 = 50000;
        if (config.set_light_thu_luoi_2 === undefined) config.set_light_thu_luoi_2 = 30000;
        if (config.set_tolerance_light_luoi_2 === undefined) config.set_tolerance_light_luoi_2 = 5;
        if (config.set_light_dai_luoi_3 === undefined) config.set_light_dai_luoi_3 = 50000;
        if (config.set_light_thu_luoi_3 === undefined) config.set_light_thu_luoi_3 = 30000;
        if (config.set_light_indoor_thu_luoi_3 === undefined) config.set_light_indoor_thu_luoi_3 = 15000;
        if (config.set_tolerance_light_luoi_3 === undefined) config.set_tolerance_light_luoi_3 = 5;
        if (config.set_light_dai_luoi_4 === undefined) config.set_light_dai_luoi_4 = 50000;
        if (config.set_light_thu_luoi_4 === undefined) config.set_light_thu_luoi_4 = 30000;
        if (config.set_light_indoor_thu_luoi_4 === undefined) config.set_light_indoor_thu_luoi_4 = 15000;
        if (config.set_tolerance_light_luoi_4 === undefined) config.set_tolerance_light_luoi_4 = 5;
    }

    /**
     * Get default configuration
     */
    private getDefaultConfig(): AutoControlConfig {
        const defaultConfig: AutoControlConfig = {};
        this.applyDefaults(defaultConfig);
        return defaultConfig;
    }

    /**
     * Invalidate cache to force config reload
     */
    invalidateCache(): void {
        this.cachedConfig = null;
        this.lastConfigUpdate = 0;
    }
}

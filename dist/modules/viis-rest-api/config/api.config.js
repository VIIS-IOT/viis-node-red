"use strict";
/**
 * @fileoverview Centralized configuration management for VIIS REST API
 * Provides type-safe configuration with validation and environment variable support
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiConfigManager = void 0;
const logger_1 = require("../utils/logger");
const global_context_helper_1 = require("../../../ultils/global-context-helper");
const constants_1 = require("../constants");
/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
    // Core settings
    enabled: true,
    apiPrefix: '/api/v2',
    // Security settings
    jwtSecret: 'viis-dev-secret-2024', // Development default
    jwtExpiresIn: '24h', // Shorter for development
    // Feature toggles
    enableLogging: true,
    enableCors: true,
    enableRateLimit: false, // Disabled for development
    enableValidation: true,
    enableDebugMode: false,
    // Performance settings
    maxRequestsPerMinute: 1000, // Higher for development
    bodyParserLimit: '10mb',
    requestTimeout: 30000, // 30 seconds
    // Development settings
    enableHotReload: true,
    enableDetailedErrors: true,
    enableRequestTracing: true,
    // Database settings
    enableDatabaseLogging: false,
    connectionTimeout: 10000
};
/**
 * Environment variable mappings
 */
const ENV_MAPPINGS = {
    [constants_1.ENV_KEYS.JWT_SECRET]: 'jwtSecret',
    [constants_1.ENV_KEYS.JWT_EXPIRES_IN]: 'jwtExpiresIn',
    [constants_1.ENV_KEYS.API_PREFIX]: 'apiPrefix',
    [constants_1.ENV_KEYS.ENABLE_DEBUG]: 'enableDebugMode',
    [constants_1.ENV_KEYS.ENABLE_DB_LOGGING]: 'enableDatabaseLogging',
    [constants_1.ENV_KEYS.REQUEST_TIMEOUT]: 'requestTimeout',
    [constants_1.ENV_KEYS.RATE_LIMIT_MAX]: 'maxRequestsPerMinute'
};
/**
 * Configuration manager class
 */
class ApiConfigManager {
    constructor(nodeConfig, node) {
        this.node = node;
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        this.config = this.buildConfiguration(nodeConfig);
        this.validateConfiguration();
        this.logConfiguration();
    }
    /**
     * Build configuration from multiple sources
     */
    buildConfiguration(nodeConfig) {
        const config = Object.assign({}, DEFAULT_CONFIG);
        // Apply Node-RED node configuration
        this.applyNodeConfig(config, nodeConfig);
        // Apply environment variables
        this.applyEnvironmentConfig(config);
        // Apply development overrides
        this.applyDevelopmentOverrides(config);
        return config;
    }
    /**
     * Apply Node-RED node configuration
     */
    applyNodeConfig(config, nodeConfig) {
        if (nodeConfig.enabled !== undefined)
            config.enabled = nodeConfig.enabled;
        if (nodeConfig.apiPrefix)
            config.apiPrefix = nodeConfig.apiPrefix;
        if (nodeConfig.jwtSecret)
            config.jwtSecret = nodeConfig.jwtSecret;
        if (nodeConfig.enableLogging !== undefined)
            config.enableLogging = nodeConfig.enableLogging;
        if (nodeConfig.enableCors !== undefined)
            config.enableCors = nodeConfig.enableCors;
        if (nodeConfig.enableRateLimit !== undefined)
            config.enableRateLimit = nodeConfig.enableRateLimit;
        if (nodeConfig.maxRequestsPerMinute)
            config.maxRequestsPerMinute = nodeConfig.maxRequestsPerMinute;
    }
    /**
     * Apply environment variable configuration
     */
    applyEnvironmentConfig(config) {
        Object.entries(ENV_MAPPINGS).forEach(([envKey, configKey]) => {
            const envValue = this.globalHelper.getEnvVar(envKey);
            if (envValue !== undefined) {
                config[configKey] = this.parseEnvironmentValue(envValue, configKey);
            }
        });
    }
    /**
     * Apply development-specific overrides
     */
    applyDevelopmentOverrides(config) {
        const isDevelopment = this.globalHelper.getEnvVar('NODE_ENV', 'development') !== 'production';
        if (isDevelopment) {
            // Enable development features
            config.enableDebugMode = true;
            config.enableDetailedErrors = true;
            config.enableRequestTracing = true;
            config.enableHotReload = true;
            // Disable rate limiting for easier development
            config.enableRateLimit = false;
            // Shorter JWT expiration for development
            if (config.jwtExpiresIn === '1y') {
                config.jwtExpiresIn = '24h';
            }
        }
    }
    /**
     * Parse environment variable value to appropriate type
     */
    parseEnvironmentValue(value, configKey) {
        // Boolean values
        if (configKey.startsWith('enable')) {
            return value.toLowerCase() === 'true';
        }
        // Number values
        if (configKey.includes('Timeout') || configKey.includes('Max') || configKey.includes('Minute')) {
            return parseInt(value, 10);
        }
        // String values
        return value;
    }
    /**
     * Validate configuration
     */
    validateConfiguration() {
        const errors = [];
        // Validate required fields
        if (!this.config.jwtSecret) {
            errors.push('JWT secret is required');
        }
        if (!this.config.apiPrefix.startsWith('/')) {
            errors.push('API prefix must start with /');
        }
        if (this.config.maxRequestsPerMinute <= 0) {
            errors.push('Max requests per minute must be positive');
        }
        if (this.config.requestTimeout <= 0) {
            errors.push('Request timeout must be positive');
        }
        if (errors.length > 0) {
            throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
        }
    }
    /**
     * Log configuration for debugging
     */
    logConfiguration() {
        logger_1.logger.info(this.node, 'API Configuration loaded:', {
            enabled: this.config.enabled,
            apiPrefix: this.config.apiPrefix,
            enableLogging: this.config.enableLogging,
            enableCors: this.config.enableCors,
            enableRateLimit: this.config.enableRateLimit,
            enableDebugMode: this.config.enableDebugMode,
            maxRequestsPerMinute: this.config.maxRequestsPerMinute,
            jwtExpiresIn: this.config.jwtExpiresIn,
            // Don't log sensitive values
            jwtSecretLength: this.config.jwtSecret.length
        });
    }
    /**
     * Get configuration value
     */
    get(key) {
        return this.config[key];
    }
    /**
     * Get all configuration
     */
    getAll() {
        return Object.assign({}, this.config);
    }
    /**
     * Check if feature is enabled
     */
    isEnabled(feature) {
        return this.config[feature];
    }
    /**
     * Update configuration at runtime (for hot reload)
     */
    updateConfig(updates) {
        Object.assign(this.config, updates);
        this.validateConfiguration();
        logger_1.logger.info(this.node, 'Configuration updated:', updates);
    }
    /**
     * Get GlobalContextHelper instance for services
     */
    getGlobalHelper() {
        return this.globalHelper;
    }
}
exports.ApiConfigManager = ApiConfigManager;

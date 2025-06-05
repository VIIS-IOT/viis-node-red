/**
 * @fileoverview Centralized configuration management for VIIS REST API
 * Provides type-safe configuration with validation and environment variable support
 */

import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { GlobalContextHelper } from '../../../ultils/global-context-helper';
import { ENV_KEYS, DEFAULTS } from '../constants';

/**
 * API Configuration interface with all possible settings
 */
export interface ApiConfiguration {
    // Core settings
    enabled: boolean;
    apiPrefix: string;

    // Security settings
    jwtSecret: string;
    jwtExpiresIn: string;

    // Feature toggles
    enableLogging: boolean;
    enableCors: boolean;
    enableRateLimit: boolean;
    enableValidation: boolean;
    enableDebugMode: boolean;

    // Performance settings
    maxRequestsPerMinute: number;
    bodyParserLimit: string;
    requestTimeout: number;

    // Development settings
    enableHotReload: boolean;
    enableDetailedErrors: boolean;
    enableRequestTracing: boolean;

    // Database settings
    enableDatabaseLogging: boolean;
    connectionTimeout: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: ApiConfiguration = {
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
    [ENV_KEYS.JWT_SECRET]: 'jwtSecret',
    [ENV_KEYS.JWT_EXPIRES_IN]: 'jwtExpiresIn',
    [ENV_KEYS.API_PREFIX]: 'apiPrefix',
    [ENV_KEYS.ENABLE_DEBUG]: 'enableDebugMode',
    [ENV_KEYS.ENABLE_DB_LOGGING]: 'enableDatabaseLogging',
    [ENV_KEYS.REQUEST_TIMEOUT]: 'requestTimeout',
    [ENV_KEYS.RATE_LIMIT_MAX]: 'maxRequestsPerMinute'
} as const;

/**
 * Configuration manager class
 */
export class ApiConfigManager {
    private config: ApiConfiguration;
    private node: Node;
    private globalHelper: GlobalContextHelper;

    constructor(nodeConfig: any, node: Node) {
        this.node = node;
        this.globalHelper = new GlobalContextHelper(node.context());
        this.config = this.buildConfiguration(nodeConfig);
        this.validateConfiguration();
        this.logConfiguration();
    }

    /**
     * Build configuration from multiple sources
     */
    private buildConfiguration(nodeConfig: any): ApiConfiguration {
        const config = { ...DEFAULT_CONFIG };

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
    private applyNodeConfig(config: ApiConfiguration, nodeConfig: any): void {
        if (nodeConfig.enabled !== undefined) config.enabled = nodeConfig.enabled;
        if (nodeConfig.apiPrefix) config.apiPrefix = nodeConfig.apiPrefix;
        if (nodeConfig.jwtSecret) config.jwtSecret = nodeConfig.jwtSecret;
        if (nodeConfig.enableLogging !== undefined) config.enableLogging = nodeConfig.enableLogging;
        if (nodeConfig.enableCors !== undefined) config.enableCors = nodeConfig.enableCors;
        if (nodeConfig.enableRateLimit !== undefined) config.enableRateLimit = nodeConfig.enableRateLimit;
        if (nodeConfig.maxRequestsPerMinute) config.maxRequestsPerMinute = nodeConfig.maxRequestsPerMinute;
    }

    /**
     * Apply environment variable configuration
     */
    private applyEnvironmentConfig(config: ApiConfiguration): void {
        Object.entries(ENV_MAPPINGS).forEach(([envKey, configKey]) => {
            const envValue = this.globalHelper.getEnvVar(envKey);
            if (envValue !== undefined) {
                (config as any)[configKey] = this.parseEnvironmentValue(envValue, configKey);
            }
        });
    }

    /**
     * Apply development-specific overrides
     */
    private applyDevelopmentOverrides(config: ApiConfiguration): void {
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
    private parseEnvironmentValue(value: string, configKey: string): any {
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
    private validateConfiguration(): void {
        const errors: string[] = [];

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
    private logConfiguration(): void {
        logger.info(this.node, 'API Configuration loaded:', {
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
    get<K extends keyof ApiConfiguration>(key: K): ApiConfiguration[K] {
        return this.config[key];
    }

    /**
     * Get all configuration
     */
    getAll(): Readonly<ApiConfiguration> {
        return { ...this.config };
    }

    /**
     * Check if feature is enabled
     */
    isEnabled(feature: keyof Pick<ApiConfiguration,
        'enableLogging' | 'enableCors' | 'enableRateLimit' | 'enableValidation' |
        'enableDebugMode' | 'enableHotReload' | 'enableDetailedErrors' |
        'enableRequestTracing' | 'enableDatabaseLogging'>): boolean {
        return this.config[feature];
    }

    /**
     * Update configuration at runtime (for hot reload)
     */
    updateConfig(updates: Partial<ApiConfiguration>): void {
        Object.assign(this.config, updates);
        this.validateConfiguration();
        logger.info(this.node, 'Configuration updated:', updates);
    }

    /**
     * Get GlobalContextHelper instance for services
     */
    getGlobalHelper(): GlobalContextHelper {
        return this.globalHelper;
    }
}

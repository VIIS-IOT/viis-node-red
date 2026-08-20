"use strict";
/**
 * Constants for VIIS REST API Module
 * Centralized configuration and environment variable mappings
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_MESSAGES = exports.ERROR_MESSAGES = exports.DEFAULTS = exports.MQTT_CONFIG = exports.ENV_KEYS = void 0;
// Environment variable keys
exports.ENV_KEYS = {
    // Device configuration
    DEVICE_ID: "DEVICE_ID",
    DEVICE_ACCESS_TOKEN: "DEVICE_ACCESS_TOKEN",
    DEVICE_LABEL: "DEVICE_LABEL",
    // EMQX configuration (local broker)
    EMQX_HOST: "EMQX_HOST",
    EMQX_PORT: "EMQX_PORT",
    EMQX_USERNAME: "EMQX_USERNAME",
    EMQX_PASSWORD: "EMQX_PASSWORD",
    // ThingsBoard configuration (fallback)
    THINGSBOARD_HOST: "THINGSBOARD_HOST",
    THINGSBOARD_PORT: "THINGSBOARD_PORT",
    THINGSBOARD_PASSWORD: "THINGSBOARD_PASSWORD",
    // API configuration
    JWT_SECRET: "JWT_SECRET",
    JWT_EXPIRES_IN: "JWT_EXPIRES_IN",
    API_PREFIX: "API_PREFIX",
    ENABLE_DEBUG: "ENABLE_DEBUG",
    ENABLE_DB_LOGGING: "ENABLE_DB_LOGGING",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    RATE_LIMIT_MAX: "RATE_LIMIT_MAX",
    // MQTT configuration
    MQTT_HOST: "MQTT_HOST",
    MQTT_PORT: "MQTT_PORT",
    MQTT_USERNAME: "MQTT_USERNAME",
    MQTT_PASSWORD: "MQTT_PASSWORD"
};
// MQTT configuration defaults
exports.MQTT_CONFIG = {
    LOCAL: {
        DEFAULT_HOST: "emqx",
        DEFAULT_PORT: "1883",
        QOS: 1,
        KEEPALIVE: 60,
        CONNECT_TIMEOUT: 30000,
        RECONNECT_PERIOD: 5000
    },
    THINGSBOARD: {
        DEFAULT_HOST: "host.docker.internal",
        DEFAULT_PORT: "11883",
        QOS: 1,
        KEEPALIVE: 60,
        CONNECT_TIMEOUT: 30000,
        RECONNECT_PERIOD: 5000
    }
};
// Default values
exports.DEFAULTS = {
    DEVICE_ID: "unknown",
    MQTT_BROKER_TYPE: "local", // Default to local EMQX instead of ThingsBoard
    API_PREFIX: "/api/v2",
    JWT_SECRET: "viis-dev-secret-2024",
    JWT_EXPIRES_IN: "24h"
};
// Error messages
exports.ERROR_MESSAGES = {
    MQTT_INIT_FAILED: "Failed to initialize MQTT client",
    MQTT_CONNECTION_FAILED: "MQTT connection failed",
    INVALID_CONFIG: "Invalid configuration provided",
    SERVICE_INIT_FAILED: "Service initialization failed"
};
// Status messages  
exports.STATUS_MESSAGES = {
    MQTT_CONNECTED: "MQTT connected",
    MQTT_DISCONNECTED: "MQTT disconnected",
    SERVICE_READY: "Service ready",
    INITIALIZING: "Initializing..."
};

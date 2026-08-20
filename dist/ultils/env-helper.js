"use strict";
/**
 * @fileoverview Environment variable helper utilities for VIIS nodes
 * Provides auto-loading capabilities for credentials from global context → process.env → fallback
 * Similar to custom-mqtt and custom-mysql patterns
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEnvVar = getEnvVar;
exports.getEnvVarInt = getEnvVarInt;
exports.loadDeviceCredentials = loadDeviceCredentials;
exports.loadMqttServerConfig = loadMqttServerConfig;
exports.loadHttpServerConfig = loadHttpServerConfig;
/**
 * Get environment variable with fallback priority
 * Priority: 1. Global context (from env-loader) → 2. process.env → 3. defaultValue
 *
 * @param context - Node-RED context object (node.context())
 * @param envVarName - Environment variable name to lookup
 * @param defaultValue - Default value if not found
 * @returns The resolved value
 */
function getEnvVar(context, envVarName, defaultValue = "") {
    try {
        // Map environment variable names to global context names
        const envToGlobalMap = {
            'DEVICE_ID': ['device_id'],
            'DEVICE_ACCESS_TOKEN': ['device_access_token', 'access_token'],
            'THINGSBOARD_HOST': ['thingsboard_host'],
            'THINGSBOARD_PORT': ['thingsboard_port'],
            'MQTT_SERVER_URL': ['mqtt_server_url', 'mqtt_host'],
            'HTTP_SERVER_URL': ['http_server_url', 'api_url']
        };
        // Try global context first - check all possible names
        const globalNames = envToGlobalMap[envVarName];
        if (globalNames && context && context.global) {
            for (const globalName of globalNames) {
                const globalValue = context.global.get(globalName);
                if (globalValue !== undefined && globalValue !== null && globalValue !== '') {
                    return globalValue.toString();
                }
            }
        }
        // Fallback to process.env
        const processValue = process.env[envVarName];
        if (processValue !== undefined && processValue !== null && processValue !== '') {
            return processValue;
        }
        return defaultValue;
    }
    catch (error) {
        // Silent fallback to default on any error
        return defaultValue;
    }
}
/**
 * Get environment variable as integer with fallback
 *
 * @param context - Node-RED context object
 * @param envVarName - Environment variable name
 * @param defaultValue - Default value if not found or not a valid number
 * @returns The resolved integer value
 */
function getEnvVarInt(context, envVarName, defaultValue) {
    const value = getEnvVar(context, envVarName, defaultValue.toString());
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}
/**
 * Load device credentials with auto-fallback
 * Tries to load from global context first, then falls back to provided values
 *
 * @param context - Node-RED context object
 * @param providedDeviceId - Device ID from UI config (optional)
 * @param providedAccessToken - Access token from UI config (optional)
 * @returns Object with deviceId and accessToken
 */
function loadDeviceCredentials(context, providedDeviceId, providedAccessToken) {
    // Priority: UI config → global context → process.env → empty string
    const deviceId = providedDeviceId && providedDeviceId.trim() !== ''
        ? providedDeviceId
        : getEnvVar(context, 'DEVICE_ID', '');
    const accessToken = providedAccessToken && providedAccessToken.trim() !== ''
        ? providedAccessToken
        : getEnvVar(context, 'DEVICE_ACCESS_TOKEN', '');
    return { deviceId, accessToken };
}
/**
 * Load MQTT server configuration with auto-fallback
 *
 * @param context - Node-RED context object
 * @param providedUrl - MQTT server URL from config (optional)
 * @param providedPort - MQTT server port from config (optional)
 * @returns Object with host and port
 */
function loadMqttServerConfig(context, providedUrl, providedPort) {
    const host = providedUrl && providedUrl.trim() !== ''
        ? providedUrl
        : getEnvVar(context, 'MQTT_SERVER_URL', 'host.docker.internal');
    const port = providedPort && providedPort > 0
        ? providedPort
        : getEnvVarInt(context, 'THINGSBOARD_PORT', 11883);
    return { host, port };
}
/**
 * Load HTTP server configuration with auto-fallback
 *
 * @param context - Node-RED context object
 * @param providedUrl - HTTP server URL from config (optional)
 * @returns The resolved HTTP server URL
 */
function loadHttpServerConfig(context, providedUrl) {
    return providedUrl && providedUrl.trim() !== ''
        ? providedUrl
        : getEnvVar(context, 'HTTP_SERVER_URL', 'https://iot.viis.tech');
}

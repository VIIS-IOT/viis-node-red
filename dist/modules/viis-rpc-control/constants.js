"use strict";
/**
 * Constants for VIIS RPC Control Node
 * Centralized configuration and magic numbers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULTS = exports.STATUS_MESSAGES = exports.ERROR_MESSAGES = exports.VALIDATION = exports.ENV_KEYS = exports.MODBUS_FUNCTION_CODES = exports.MODBUS_CONFIG = exports.MQTT_CONFIG = exports.DEBOUNCE_CONFIG = exports.CONTEXT_KEYS = void 0;
// Context keys for storing data
exports.CONTEXT_KEYS = {
    // Flow context keys (node-specific)
    GLOBAL_SCALE_CONFIGS: "scaleConfigs",
    GLOBAL_MANUAL_OVERRIDES: "manualModbusOverrides",
    // Global context keys (shared across nodes)
    GLOBAL_CONFIG_KEYS: "configKeys",
    GLOBAL_CONFIG_VALUES: "configKeyValues",
};
// Debounce configuration
exports.DEBOUNCE_CONFIG = {
    TIME_MS: 200, // 200ms debounce
    MESSAGE_CACHE_TTL: 100, // 10 seconds
};
// MQTT configuration defaults
exports.MQTT_CONFIG = {
    THINGSBOARD: {
        DEFAULT_HOST: "mqtt.viis.tech",
        DEFAULT_PORT: "1883",
        SUBSCRIBE_TOPIC: "v1/devices/me/rpc/request/+",
        PUBLISH_TOPIC: "v1/devices/me/telemetry",
        QOS: 1,
    },
    LOCAL: {
        DEFAULT_HOST: "emqx",
        DEFAULT_PORT: "1883",
        QOS: 1,
    },
};
// Modbus configuration defaults
exports.MODBUS_CONFIG = {
    DEFAULT_TYPE: "TCP",
    DEFAULT_HOST: "localhost",
    DEFAULT_TCP_PORT: 502,
    DEFAULT_SERIAL_PORT: "/dev/ttyUSB0",
    DEFAULT_BAUD_RATE: 9600,
    DEFAULT_PARITY: "none",
    DEFAULT_UNIT_ID: 1,
    DEFAULT_TIMEOUT: 5000,
    DEFAULT_RECONNECT_INTERVAL: 5000,
};
// Function codes for Modbus operations
exports.MODBUS_FUNCTION_CODES = {
    READ_COILS: 1,
    READ_HOLDING_REGISTERS: 3,
    READ_INPUT_REGISTERS: 4,
    WRITE_SINGLE_COIL: 5,
    WRITE_SINGLE_REGISTER: 6,
};
// Environment variable keys
exports.ENV_KEYS = {
    DEVICE_ID: "DEVICE_ID",
    MODBUS_COILS: "MODBUS_COILS",
    MODBUS_INPUT_REGISTERS: "MODBUS_INPUT_REGISTERS",
    MODBUS_HOLDING_REGISTERS: "MODBUS_HOLDING_REGISTERS",
    MODBUS_TYPE: "MODBUS_TYPE",
    MODBUS_HOST: "MODBUS_HOST",
    MODBUS_TCP_PORT: "MODBUS_TCP_PORT",
    MODBUS_SERIAL_PORT: "MODBUS_SERIAL_PORT",
    MODBUS_BAUD_RATE: "MODBUS_BAUD_RATE",
    MODBUS_PARITY: "MODBUS_PARITY",
    MODBUS_UNIT_ID: "MODBUS_UNIT_ID",
    MODBUS_TIMEOUT: "MODBUS_TIMEOUT",
    MODBUS_RECONNECT_INTERVAL: "MODBUS_RECONNECT_INTERVAL",
    THINGSBOARD_HOST: "THINGSBOARD_HOST",
    THINGSBOARD_PORT: "THINGSBOARD_PORT",
    DEVICE_ACCESS_TOKEN: "DEVICE_ACCESS_TOKEN",
    THINGSBOARD_PASSWORD: "THINGSBOARD_PASSWORD",
    EMQX_HOST: "EMQX_HOST",
    EMQX_PORT: "EMQX_PORT",
    EMQX_USERNAME: "EMQX_USERNAME",
    EMQX_PASSWORD: "EMQX_PASSWORD",
};
// Validation constants
exports.VALIDATION = {
    SUPPORTED_TYPES: ["number", "boolean", "string"],
    SUPPORTED_SCALE_OPERATIONS: ["multiply", "divide"],
    SUPPORTED_SCALE_DIRECTIONS: ["read", "write"],
};
// Error messages
exports.ERROR_MESSAGES = {
    CLIENT_INIT_FAILED: "Failed to initialize clients",
    SUBSCRIPTION_FAILED: "Subscription failed",
    RPC_ERROR: "RPC error",
    PARSE_ERROR: "Parse error",
    MODBUS_WRITE_FAILED: (key) => `Modbus write failed for ${key}`,
    MODBUS_READ_FAILED: (key) => `Modbus read failed for ${key}`,
    INVALID_TYPE: (type, key) => `Invalid type "${type}" for key "${key}"`,
    INVALID_SCALE_CONFIG: (config) => `Invalid scale config: ${config}`,
    VALUE_CONVERSION_FAILED: (key) => `Value conversion failed for ${key}`,
    INVALID_NUMBER: (key) => `Invalid number value for ${key}`,
    RPC_HANDLING_ERROR: "RPC handling error",
    MQTT_PROCESSING_ERROR: "MQTT message processing error",
    CONFIG_UPDATE_FAILED: (type) => `Failed to update ${type}`,
    RPC_INPUT_FAILED: "Failed to process RPC command from input",
    CLEANUP_ERROR: "Cleanup error",
    INVALID_RPC_FORMAT: "Invalid RPC command format",
};
// Status messages
exports.STATUS_MESSAGES = {
    PUBLISHED: (key) => `Published: ${key}`,
    CONFIG_UPDATED: (key) => `Config updated: ${key}`,
    LUOI_COMMANDS_SENT: "Luoi commands sent",
    MODBUS_COMMAND_SENT: "Modbus command sent",
    MESSAGE_RECEIVED: "Message received",
    PROCESSING_RPC_INPUT: "Processing RPC input",
    RPC_INPUT_ERROR: "RPC input error",
};
// Default values
exports.DEFAULTS = {
    DEVICE_ID: "unknown",
    EMPTY_JSON: "{}",
    EMPTY_ARRAY: "[]",
};

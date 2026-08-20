"use strict";
/**
 * Constants for VIIS RPC Control Node
 * Centralized configuration and magic numbers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOLDING_SETML_BOM_OFFSETS = exports.DEFAULTS = exports.FERTIGATION_KEY_DELAY_MS = exports.WATER_HAMMER_DELAY_MS = exports.STATUS_MESSAGES = exports.ERROR_MESSAGES = exports.VALIDATION = exports.ENV_KEYS = exports.MODBUS_FUNCTION_CODES = exports.BOARD_CONFIGS = exports.MODBUS_CONFIG = exports.MQTT_CONFIG = exports.DEBOUNCE_CONFIG = exports.CONTEXT_KEYS = void 0;
const viis_telemetry_constants_1 = require("../viis-telemetry/viis-telemetry-constants");
// Context keys for storing data
exports.CONTEXT_KEYS = {
    // Flow context keys (node-specific)
    GLOBAL_SCALE_CONFIGS: viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS,
    GLOBAL_MANUAL_OVERRIDES: "manualModbusOverrides",
    // Global context keys (shared across nodes)
    GLOBAL_CONFIG_KEYS: "configKeys",
    GLOBAL_CONFIG_VALUES: "configKeyValues",
};
// Debounce configuration
exports.DEBOUNCE_CONFIG = {
    TIME_MS: 200, // 200ms debounce
    MESSAGE_CACHE_TTL: 10000, // 10 seconds - for reliable message deduplication
};
// MQTT configuration defaults
exports.MQTT_CONFIG = {
    THINGSBOARD: {
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
    // Board-specific defaults
    DEFAULT_BOARD_TYPE: "STM32",
    DEFAULT_WRITE_TIMEOUT: 5000,
    DEFAULT_READ_TIMEOUT: 5000,
    DEFAULT_CONNECTION_TIMEOUT: 3000,
    DEFAULT_MAX_RETRIES: 3,
};
// Board-specific timeout configurations
exports.BOARD_CONFIGS = {
    STM32: {
        WRITE_TIMEOUT: 3000,
        READ_TIMEOUT: 3000,
        CONNECTION_TIMEOUT: 2000,
        MAX_RETRIES: 2,
        SOCKET_OPTIONS: {
            keepAlive: false,
            noDelay: true,
            family: 4,
        }
    },
    ATMEGA: {
        WRITE_TIMEOUT: 8000, // ATmega may need more time
        READ_TIMEOUT: 8000,
        CONNECTION_TIMEOUT: 5000,
        MAX_RETRIES: 3,
        SOCKET_OPTIONS: {
            keepAlive: true,
            noDelay: false,
            family: 4,
        }
    },
    GENERIC: {
        WRITE_TIMEOUT: 5000,
        READ_TIMEOUT: 5000,
        CONNECTION_TIMEOUT: 3000,
        MAX_RETRIES: 3,
        SOCKET_OPTIONS: {
            keepAlive: false,
            noDelay: true,
            family: 4,
        }
    }
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
    // Board-specific configuration
    MODBUS_BOARD_TYPE: "MODBUS_BOARD_TYPE",
    MODBUS_WRITE_TIMEOUT: "MODBUS_WRITE_TIMEOUT",
    MODBUS_READ_TIMEOUT: "MODBUS_READ_TIMEOUT",
    MODBUS_CONNECTION_TIMEOUT: "MODBUS_CONNECTION_TIMEOUT",
    MODBUS_MAX_RETRIES: "MODBUS_MAX_RETRIES",
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
exports.WATER_HAMMER_DELAY_MS = 7000;
exports.FERTIGATION_KEY_DELAY_MS = 100;
// Default values
exports.DEFAULTS = {
    DEVICE_ID: "unknown",
    EMPTY_JSON: "{}",
    EMPTY_ARRAY: "[]",
};
// Special case offset configuration for HOLDING_SETML_BOM keys
// This is a decoupled feature that can be easily enabled/disabled
exports.HOLDING_SETML_BOM_OFFSETS = {
    // Enable/disable the offset feature
    ENABLED: false,
    // Offset values for specific keys
    OFFSETS: {
        "HOLDING_SETML_BOM_1": 34,
        "HOLDING_SETML_BOM_2": 55,
        "HOLDING_SETML_BOM_3": 35,
        "HOLDING_SETML_BOM_4": 48,
        "HOLDING_SETML_BOM_5": 31,
        "HOLDING_SETML_BOM_6": 39,
        "HOLDING_SETML_BOM_7": 38,
        "HOLDING_SETML_BOM_8": 39,
        "HOLDING_SETML_BOM_9": 33,
        "HOLDING_SETML_BOM_10": 37,
        "HOLDING_SETML_BOM_11": 33,
        "HOLDING_SETML_BOM_12": 37,
        "HOLDING_SETML_BOM_13": 34,
        "HOLDING_SETML_BOM_14": 56,
    }
};

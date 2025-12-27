/**
 * Constants for VIIS RPC Control Node
 * Centralized configuration and magic numbers
 */

// Context keys for storing data
export const CONTEXT_KEYS = {
    // Flow context keys (node-specific)
    GLOBAL_SCALE_CONFIGS: "scaleConfigs",
    GLOBAL_MANUAL_OVERRIDES: "manualModbusOverrides",

    // Global context keys (shared across nodes)
    GLOBAL_CONFIG_KEYS: "configKeys",
    GLOBAL_CONFIG_VALUES: "configKeyValues",
} as const;

// Debounce configuration
export const DEBOUNCE_CONFIG = {
    TIME_MS: 200, // 200ms debounce
    MESSAGE_CACHE_TTL: 10000, // 10 seconds - for reliable message deduplication
} as const;

// MQTT configuration defaults
export const MQTT_CONFIG = {
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
} as const;

// Modbus configuration defaults
export const MODBUS_CONFIG = {
    DEFAULT_TYPE: "TCP" as const,
    DEFAULT_HOST: "localhost",
    DEFAULT_TCP_PORT: 502,
    DEFAULT_SERIAL_PORT: "/dev/ttyUSB0",
    DEFAULT_BAUD_RATE: 9600,
    DEFAULT_PARITY: "none" as const,
    DEFAULT_UNIT_ID: 1,
    DEFAULT_TIMEOUT: 5000,
    DEFAULT_RECONNECT_INTERVAL: 5000,
    // Board-specific defaults
    DEFAULT_BOARD_TYPE: "STM32" as const,
    DEFAULT_WRITE_TIMEOUT: 5000,
    DEFAULT_READ_TIMEOUT: 5000,
    DEFAULT_CONNECTION_TIMEOUT: 3000,
    DEFAULT_MAX_RETRIES: 3,
} as const;

// Board-specific timeout configurations
export const BOARD_CONFIGS = {
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
        WRITE_TIMEOUT: 8000,  // ATmega may need more time
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
} as const;

// Function codes for Modbus operations
export const MODBUS_FUNCTION_CODES = {
    READ_COILS: 1,
    READ_HOLDING_REGISTERS: 3,
    READ_INPUT_REGISTERS: 4,
    WRITE_SINGLE_COIL: 5,
    WRITE_SINGLE_REGISTER: 6,
} as const;

// Environment variable keys
export const ENV_KEYS = {
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
} as const;

// Validation constants
export const VALIDATION = {
    SUPPORTED_TYPES: ["number", "boolean", "string"] as const,
    SUPPORTED_SCALE_OPERATIONS: ["multiply", "divide"] as const,
    SUPPORTED_SCALE_DIRECTIONS: ["read", "write"] as const,
} as const;

// Error messages
export const ERROR_MESSAGES = {
    CLIENT_INIT_FAILED: "Failed to initialize clients",
    SUBSCRIPTION_FAILED: "Subscription failed",
    RPC_ERROR: "RPC error",
    PARSE_ERROR: "Parse error",
    MODBUS_WRITE_FAILED: (key: string) => `Modbus write failed for ${key}`,
    MODBUS_READ_FAILED: (key: string) => `Modbus read failed for ${key}`,
    INVALID_TYPE: (type: string, key: string) => `Invalid type "${type}" for key "${key}"`,
    INVALID_SCALE_CONFIG: (config: string) => `Invalid scale config: ${config}`,
    VALUE_CONVERSION_FAILED: (key: string) => `Value conversion failed for ${key}`,
    INVALID_NUMBER: (key: string) => `Invalid number value for ${key}`,
    RPC_HANDLING_ERROR: "RPC handling error",
    MQTT_PROCESSING_ERROR: "MQTT message processing error",
    CONFIG_UPDATE_FAILED: (type: string) => `Failed to update ${type}`,
    RPC_INPUT_FAILED: "Failed to process RPC command from input",
    CLEANUP_ERROR: "Cleanup error",
    INVALID_RPC_FORMAT: "Invalid RPC command format",
} as const;

// Status messages
export const STATUS_MESSAGES = {
    PUBLISHED: (key: string) => `Published: ${key}`,
    CONFIG_UPDATED: (key: string) => `Config updated: ${key}`,
    LUOI_COMMANDS_SENT: "Luoi commands sent",
    MODBUS_COMMAND_SENT: "Modbus command sent",
    MESSAGE_RECEIVED: "Message received",
    PROCESSING_RPC_INPUT: "Processing RPC input",
    RPC_INPUT_ERROR: "RPC input error",
} as const;

// Default values
export const DEFAULTS = {
    DEVICE_ID: "unknown",
    EMPTY_JSON: "{}",
    EMPTY_ARRAY: "[]",
} as const;

// Special case offset configuration for HOLDING_SETML_BOM keys
// This is a decoupled feature that can be easily enabled/disabled
export const HOLDING_SETML_BOM_OFFSETS = {
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
    } as const
} as const;

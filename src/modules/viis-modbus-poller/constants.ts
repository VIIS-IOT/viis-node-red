/**
 * Constants for VIIS Modbus Poller Node
 */

// Default configuration values
export const DEFAULT_CONFIG = {
    COIL_POLLING_INTERVAL: 1000,
    INPUT_POLLING_INTERVAL: 1000,
    HOLDING_POLLING_INTERVAL: 5000,
    COIL_QUANTITY: 32,
    INPUT_QUANTITY: 26,
    HOLDING_QUANTITY: 29,
    PERIODIC_SNAPSHOT_INTERVAL: 60000, // 1 minute
    DEFAULT_THRESHOLD: 0.1,
    START_ADDRESS: 0,
    MAX_CONSECUTIVE_FAILURES: 5,
    RETRY_DELAY: 1000,
    MAX_RETRIES: 3,
} as const;

// Environment variable keys
export const ENV_KEYS = {
    DEVICE_ID: "DEVICE_ID",
    MODBUS_TYPE: "MODBUS_TYPE",
    MODBUS_HOST: "MODBUS_HOST",
    MODBUS_TCP_PORT: "MODBUS_TCP_PORT",
    MODBUS_SERIAL_PORT: "MODBUS_SERIAL_PORT",
    MODBUS_BAUD_RATE: "MODBUS_BAUD_RATE",
    MODBUS_PARITY: "MODBUS_PARITY",
    MODBUS_UNIT_ID: "MODBUS_UNIT_ID",
    MODBUS_TIMEOUT: "MODBUS_TIMEOUT",
    MODBUS_RECONNECT_INTERVAL: "MODBUS_RECONNECT_INTERVAL",
    MODBUS_COILS: "MODBUS_COILS",
    MODBUS_INPUT_REGISTERS: "MODBUS_INPUT_REGISTERS",
    MODBUS_HOLDING_REGISTERS: "MODBUS_HOLDING_REGISTERS",
    THINGSBOARD_HOST: "THINGSBOARD_HOST",
    THINGSBOARD_PORT: "THINGSBOARD_PORT",
    DEVICE_ACCESS_TOKEN: "DEVICE_ACCESS_TOKEN",
    THINGSBOARD_PASSWORD: "THINGSBOARD_PASSWORD",
    EMQX_HOST: "EMQX_HOST",
    EMQX_PORT: "EMQX_PORT",
    EMQX_USERNAME: "EMQX_USERNAME",
    EMQX_PASSWORD: "EMQX_PASSWORD",
} as const;

// Status messages
export const STATUS_MESSAGES = {
    INITIALIZING: "Initializing...",
    READY: "Ready",
    POLLING_COILS: "Polling coils...",
    POLLING_INPUTS: "Polling inputs...",
    POLLING_HOLDINGS: "Polling holdings...",
    PUBLISHING: "Publishing telemetry...",
    ERROR: "Error",
    DISCONNECTED: "Disconnected",
    MAX_FAILURES: "Max failures reached",
} as const;

// Error messages
export const ERROR_MESSAGES = {
    MODBUS_CLIENT_INIT_FAILED: "Failed to initialize Modbus client",
    MQTT_CLIENT_INIT_FAILED: "Failed to initialize MQTT client",
    MYSQL_CLIENT_INIT_FAILED: "Failed to initialize MySQL client",
    INVALID_THRESHOLD_CONFIG: "Invalid threshold configuration",
    POLLING_FAILED: "Polling failed",
    PUBLISH_FAILED: "Failed to publish telemetry",
    SAVE_TELEMETRY_FAILED: "Failed to save telemetry to database",
    ENVIRONMENT_CONFIG_MISSING: "Environment configuration missing",
} as const;

// MQTT topics
export const MQTT_TOPICS = {
    THINGSBOARD: "v1/devices/me/telemetry",
    EMQX_PATTERN: "viis/things/v2/{deviceId}/telemetry",
} as const;

// Register types
export const REGISTER_TYPES = {
    COILS: "coils",
    INPUTS: "inputs",
    HOLDINGS: "holdings",
} as const;

// Modbus function codes
export const MODBUS_FUNCTION_CODES = {
    READ_COILS: 1,
    READ_DISCRETE_INPUTS: 2,
    READ_HOLDING_REGISTERS: 3,
    READ_INPUT_REGISTERS: 4,
} as const;

// Global context keys
export const GLOBAL_CONTEXT_KEYS = {
    COIL_REGISTER_DATA: "coil_register_data",
    INPUT_REGISTER_DATA: "input_register_data",
    HOLDING_REGISTER_DATA: "holding_register_data",
} as const;

// Value types for telemetry
export const VALUE_TYPES = {
    INT: "int",
    FLOAT: "float",
    STRING: "string",
    BOOLEAN: "boolean",
    JSON: "json",
} as const;

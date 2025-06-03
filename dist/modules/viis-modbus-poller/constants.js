"use strict";
/**
 * Constants for VIIS Modbus Poller Node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALUE_TYPES = exports.GLOBAL_CONTEXT_KEYS = exports.MODBUS_FUNCTION_CODES = exports.REGISTER_TYPES = exports.MQTT_TOPICS = exports.ERROR_MESSAGES = exports.STATUS_MESSAGES = exports.ENV_KEYS = exports.DEFAULT_CONFIG = void 0;
// Default configuration values
exports.DEFAULT_CONFIG = {
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
};
// Environment variable keys
exports.ENV_KEYS = {
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
};
// Status messages
exports.STATUS_MESSAGES = {
    INITIALIZING: "Initializing...",
    READY: "Ready",
    POLLING_COILS: "Polling coils...",
    POLLING_INPUTS: "Polling inputs...",
    POLLING_HOLDINGS: "Polling holdings...",
    PUBLISHING: "Publishing telemetry...",
    ERROR: "Error",
    DISCONNECTED: "Disconnected",
    MAX_FAILURES: "Max failures reached",
};
// Error messages
exports.ERROR_MESSAGES = {
    MODBUS_CLIENT_INIT_FAILED: "Failed to initialize Modbus client",
    MQTT_CLIENT_INIT_FAILED: "Failed to initialize MQTT client",
    MYSQL_CLIENT_INIT_FAILED: "Failed to initialize MySQL client",
    INVALID_THRESHOLD_CONFIG: "Invalid threshold configuration",
    POLLING_FAILED: "Polling failed",
    PUBLISH_FAILED: "Failed to publish telemetry",
    SAVE_TELEMETRY_FAILED: "Failed to save telemetry to database",
    ENVIRONMENT_CONFIG_MISSING: "Environment configuration missing",
};
// MQTT topics
exports.MQTT_TOPICS = {
    THINGSBOARD: "v1/devices/me/telemetry",
    EMQX_PATTERN: "viis/things/v2/{deviceId}/telemetry",
};
// Register types
exports.REGISTER_TYPES = {
    COILS: "coils",
    INPUTS: "inputs",
    HOLDINGS: "holdings",
};
// Modbus function codes
exports.MODBUS_FUNCTION_CODES = {
    READ_COILS: 1,
    READ_DISCRETE_INPUTS: 2,
    READ_HOLDING_REGISTERS: 3,
    READ_INPUT_REGISTERS: 4,
};
// Global context keys
exports.GLOBAL_CONTEXT_KEYS = {
    COIL_REGISTER_DATA: "coil_register_data",
    INPUT_REGISTER_DATA: "input_register_data",
    HOLDING_REGISTER_DATA: "holding_register_data",
};
// Value types for telemetry
exports.VALUE_TYPES = {
    INT: "int",
    FLOAT: "float",
    STRING: "string",
    BOOLEAN: "boolean",
    JSON: "json",
};

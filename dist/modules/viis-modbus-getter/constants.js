"use strict";
/**
 * Constants for VIIS Modbus Getter Node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALIDATION_LIMITS = exports.STATUS_MESSAGES = exports.ERROR_MESSAGES = exports.ENV_KEYS = exports.DEFAULT_CONFIG = exports.MODBUS_FUNCTION_CODES = void 0;
// Modbus Function Codes
exports.MODBUS_FUNCTION_CODES = {
    READ_COILS: 1,
    READ_DISCRETE_INPUTS: 2,
    READ_HOLDING_REGISTERS: 3,
    READ_INPUT_REGISTERS: 4
};
// Default Configuration
exports.DEFAULT_CONFIG = {
    MODBUS_TYPE: "TCP",
    MODBUS_HOST: "localhost",
    MODBUS_TCP_PORT: 502,
    MODBUS_SERIAL_PORT: "/dev/ttyUSB0",
    MODBUS_BAUD_RATE: 9600,
    MODBUS_PARITY: "none",
    MODBUS_UNIT_ID: 1,
    MODBUS_TIMEOUT: 5000,
    MODBUS_RECONNECT_INTERVAL: 5000
};
// Environment Variable Keys
exports.ENV_KEYS = {
    MODBUS_TYPE: "MODBUS_TYPE",
    MODBUS_HOST: "MODBUS_HOST",
    MODBUS_TCP_PORT: "MODBUS_TCP_PORT",
    MODBUS_SERIAL_PORT: "MODBUS_SERIAL_PORT",
    MODBUS_BAUD_RATE: "MODBUS_BAUD_RATE",
    MODBUS_PARITY: "MODBUS_PARITY",
    MODBUS_UNIT_ID: "MODBUS_UNIT_ID",
    MODBUS_TIMEOUT: "MODBUS_TIMEOUT",
    MODBUS_RECONNECT_INTERVAL: "MODBUS_RECONNECT_INTERVAL",
    // Multi-board support
    MODBUS_BOARDS: "MODBUS_BOARDS",
    MODBUS_DEFAULT_BOARD: "MODBUS_DEFAULT_BOARD"
};
// Error Messages
exports.ERROR_MESSAGES = {
    INVALID_PAYLOAD: "Invalid payload format",
    MISSING_REQUIRED_FIELDS: "Missing required fields in payload",
    MODBUS_CLIENT_NOT_INITIALIZED: "Modbus client is not initialized",
    MODBUS_CLIENT_NOT_CONNECTED: "Modbus client not connected",
    MODBUS_READ_ERROR: "Modbus read operation failed",
    UNSUPPORTED_FUNCTION_CODE: "Unsupported function code",
    INVALID_ADDRESS: "Invalid address",
    INVALID_QUANTITY: "Invalid quantity"
};
// Node Status Messages
exports.STATUS_MESSAGES = {
    INITIALIZING: "Initializing...",
    READY: "Ready",
    READING: "Reading...",
    ERROR: "Error",
    DISCONNECTED: "Disconnected"
};
// Validation Limits
exports.VALIDATION_LIMITS = {
    MIN_ADDRESS: 0,
    MAX_ADDRESS: 65535,
    MIN_QUANTITY: 1,
    MAX_QUANTITY_COILS: 2000,
    MAX_QUANTITY_REGISTERS: 125
};

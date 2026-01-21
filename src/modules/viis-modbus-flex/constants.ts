/**
 * Constants for VIIS Modbus Flex Node
 */

// Modbus Function Codes
export const MODBUS_FUNCTION_CODES = {
    // Read operations
    READ_COILS: 1,
    READ_DISCRETE_INPUTS: 2,
    READ_HOLDING_REGISTERS: 3,
    READ_INPUT_REGISTERS: 4,
    // Write operations
    WRITE_SINGLE_COIL: 5,
    WRITE_SINGLE_REGISTER: 6,
    WRITE_MULTIPLE_COILS: 15,
    WRITE_MULTIPLE_REGISTERS: 16
} as const;

// Default Configuration
export const DEFAULT_CONFIG = {
    MODBUS_TYPE: "TCP" as const,
    MODBUS_HOST: "localhost",
    MODBUS_TCP_PORT: 502,
    MODBUS_SERIAL_PORT: "/dev/ttyUSB0",
    MODBUS_BAUD_RATE: 9600,
    MODBUS_PARITY: "none" as const,
    MODBUS_UNIT_ID: 1,
    MODBUS_TIMEOUT: 5000,
    MODBUS_RECONNECT_INTERVAL: 5000
} as const;

// Environment Variable Keys
export const ENV_KEYS = {
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
} as const;

// Error Messages
export const ERROR_MESSAGES = {
    INVALID_PAYLOAD: "Invalid payload format",
    MISSING_REQUIRED_FIELDS: "Missing required fields in payload",
    MODBUS_CLIENT_NOT_INITIALIZED: "Modbus client is not initialized",
    MODBUS_CLIENT_NOT_CONNECTED: "Modbus client not connected",
    MODBUS_READ_ERROR: "Modbus read operation failed",
    MODBUS_WRITE_ERROR: "Modbus write operation failed",
    UNSUPPORTED_FUNCTION_CODE: "Unsupported function code",
    INVALID_ADDRESS: "Invalid address",
    INVALID_QUANTITY: "Invalid quantity",
    INVALID_VALUE: "Invalid value for write operation",
    MISSING_VALUE: "Missing value field for write operation"
} as const;

// Node Status Messages
export const STATUS_MESSAGES = {
    INITIALIZING: "Initializing...",
    READY: "Ready",
    READING: "Reading...",
    ERROR: "Error",
    DISCONNECTED: "Disconnected"
} as const;

// Validation Limits
export const VALIDATION_LIMITS = {
    MIN_ADDRESS: 0,
    MAX_ADDRESS: 65535,
    MIN_QUANTITY: 1,
    MAX_QUANTITY_COILS: 2000,
    MAX_QUANTITY_REGISTERS: 125,
    // Write operation limits
    MIN_REGISTER_VALUE: 0,
    MAX_REGISTER_VALUE: 65535,
    MAX_WRITE_MULTIPLE_COILS: 1968,
    MAX_WRITE_MULTIPLE_REGISTERS: 123
} as const;

/**
 * Constants for VIIS Device Protection Node
 * Centralized configuration and magic numbers
 */

// Context keys for storing data
export const CONTEXT_KEYS = {
    // Global context keys (shared across nodes)
    GLOBAL_CONFIG_VALUES: "configKeyValues",
    COIL_REGISTER_DATA: "coilRegisterData",
    SENSOR_REGISTER_DATA: "sensorRegisterData",
} as const;

// Environment variable keys
export const ENV_KEYS = {
    DEVICE_ID: "DEVICE_ID",
    DEVICE_ACCESS_TOKEN: "DEVICE_ACCESS_TOKEN",
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
    MODBUS_BOARDS: "MODBUS_BOARDS",
    MODBUS_DEFAULT_BOARD: "MODBUS_DEFAULT_BOARD",
    THINGSBOARD_HOST: "THINGSBOARD_HOST",
    THINGSBOARD_PORT: "THINGSBOARD_PORT",
    THINGSBOARD_PASSWORD: "THINGSBOARD_PASSWORD",
    EMQX_HOST: "EMQX_HOST",
    EMQX_PORT: "EMQX_PORT",
    EMQX_USERNAME: "EMQX_USERNAME",
    EMQX_PASSWORD: "EMQX_PASSWORD",
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
} as const;

// Protection check interval
export const PROTECTION_CONFIG = {
    CHECK_INTERVAL_MS: 1000,  // Check every 1 second
    CONFIG_CHECK_INTERVAL_MS: 30000,  // Check config every 30 seconds
} as const;

// Device types supported (must match device profile identifiers)
export const DEVICE_TYPES = [
    "lamp",
    "fan_intake",
    "fan_circ",
    "cool_ac1",
    "cool_ac2",
    "humid",
    "dehumid",
    "co2"
] as const;

// Device label mapping for config lookup (deviceKey -> config field prefix)
export const DEVICE_LABEL_MAP: Record<string, string> = {
    "lamp": "lamp_protect",
    "fan_intake": "fan_protect_intake",
    "fan_circ": "fan_protect_circ",
    "cool_ac1": "cool_protect_1",
    "cool_ac2": "cool_protect_2",
    "humid": "humid_protect",
    "dehumid": "dehumid_protect",
    "co2": "co2_protect"
} as const;

// Error messages
export const ERROR_MESSAGES = {
    CLIENT_INIT_FAILED: "Failed to initialize Modbus client",
    MODBUS_WRITE_FAILED: (key: string) => `Modbus write failed for ${key}`,
    MODBUS_READ_FAILED: (key: string) => `Modbus read failed for ${key}`,
    CONFIG_LOAD_FAILED: "Failed to load configuration",
    NOTIFICATION_CREATE_FAILED: "Failed to create notification",
} as const;

// Status messages
export const STATUS_MESSAGES = {
    RUNNING: "Running",
    NO_CONFIG: "No configKeyValues",
    MODBUS_FAILED: "Modbus client failed",
    PROTECTION_TRIGGERED: (device: string) => `${device} protection triggered`,
} as const;

// Default values
export const DEFAULTS = {
    DEVICE_ID: "unknown",
    EMPTY_JSON: "{}",
    ZERO: 0,
} as const;

/**
 * Constants for VIIS Auto Microclimate Control Node
 * Centralized configuration and magic numbers
 */

// Context keys for storing data
export const CONTEXT_KEYS = {
    // Flow context keys (node-specific)
    FAN_ROTATION_STATE: "fanRotationState",
    FAN_ROTATION_TIMER: "fanRotationTimer",
    WATER_PUMP_STATE: "waterPumpState",
    CURTAIN_TOLERANCE_TIMERS: "curtainToleranceTimers",
    LAST_CONTROL_EXECUTION: "lastControlExecution",

    // Global context keys (shared across nodes)
    GLOBAL_CONFIG_VALUES: "configKeyValues",
    GLOBAL_HOLDING_REGISTER_DATA: "holdingRegisterData",
    GLOBAL_COIL_REGISTER_DATA: "coilRegisterData",
    GLOBAL_MODBUS_COILS: "modbusCoils",
    GLOBAL_MODBUS_HOLDING_REGISTERS: "modbusHoldingRegisters",
} as const;

// Control configuration defaults
export const CONTROL_CONFIG = {
    POLLING_INTERVAL_MS: 10000, // 10 seconds
    MODBUS_TIMEOUT_MS: 5000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_MS: 1000,
} as const;

// Fan control constants
export const FAN_CONFIG = {
    // Fan grouping configurations
    GROUPS: {
        TWO_FANS: [
            ["quat_1", "quat_2"],
            ["quat_3", "quat_4"],
            ["quat_5", "quat_6"]
        ],
        FOUR_FANS: [
            ["quat_1", "quat_2", "quat_3", "quat_4"],
            ["quat_5", "quat_6", "quat_1", "quat_2"]
        ],
        SIX_FANS: [
            ["quat_1", "quat_2", "quat_3", "quat_4", "quat_5", "quat_6"]
        ]
    },
    
    // Default thresholds
    DEFAULT_HUMIDITY_THRESHOLDS: {
        K2_HUMIDITY: 65,
        K3_HUMIDITY: 55,
        K4_HUMIDITY: 75
    },
    
    // Modbus mapping for fans
    COIL_MAPPING: {
        "quat_1": 0,
        "quat_2": 1,
        "quat_3": 2,
        "quat_4": 3,
        "quat_5": 4,
        "quat_6": 5
    }
} as const;

// Fan dao (reverse fan) control constants
export const FAN_DAO_CONFIG = {
    COIL_MAPPING: {
        "quat_dao_1": 6,
        "quat_dao_2": 7,
        "quat_dao_3": 8
    }
} as const;

// Water pump control constants
export const WATER_PUMP_CONFIG = {
    COIL_MAPPING: {
        "bom_nuoc_1": 9
    },
    DEFAULT_THRESHOLDS: {
        LOW_HUMIDITY: 60,
        HIGH_HUMIDITY: 80
    }
} as const;

// Curtain (luoi) control constants
export const CURTAIN_CONFIG = {
    // Luoi mapping - each luoi has thu (retract) and dai (extend) coils
    LUOI_MAPPING: {
        "luoi_1": { thu: "luoi_1_thu", dai: "luoi_1_dai" },
        "luoi_2": { thu: "luoi_2_thu", dai: "luoi_2_dai" }
    },
    
    COIL_MAPPING: {
        "luoi_1_thu": 16,
        "luoi_1_dai": 17,
        "luoi_2_thu": 12,
        "luoi_2_dai": 13
    },
    
    // Coil pairs for conflict prevention
    COIL_PAIRS: [
        { key1: "luoi_1_thu", key2: "luoi_1_dai" },
        { key1: "luoi_2_thu", key2: "luoi_2_dai" }
    ],
    
    DEFAULT_THRESHOLDS: {
        LIGHT_DAI: 50000, // lux
        LIGHT_THU: 30000, // lux
        TOLERANCE_TIME: 5 // minutes
    }
} as const;

// Configuration keys that the node will read from global configKeyValues
export const CONFIG_KEYS = [
    // Operational settings
    "operational_script",
    "script_run_day",
    
    // Fan control
    "set_mode_fan",
    "set_auto_mode_fan",
    "set_k1_fan",
    "set_k2_fan", 
    "set_k3_fan",
    "set_k4_fan",
    "set_gr_alternate_fan",
    "set_time_alternate_fan",
    "set_time_fan_on",
    "set_time_fan_off",
    
    // Fan dao control
    "set_mode_fan_dao",
    "set_auto_mode_fan_dao",
    "set_threshold_on_fan_dao",
    "set_threshold_off_fan_dao",
    "set_time_alternate_fan_dao",
    
    // Water pump control
    "set_mode_tuong_nuoc",
    "set_threshold_low_water_bump",
    "set_threshold_high_water_bump",
    
    // Curtain control
    "set_mode_luoi",
    "set_auto_mode_luoi",
    "set_light_dai_luoi_1",
    "set_light_thu_luoi_1",
    "set_tolerance_light_luoi_1",
    "set_light_dai_luoi_2",
    "set_light_thu_luoi_2",
    "set_tolerance_light_luoi_2",
    "set_light_dai_luoi_3",
    "set_light_thu_luoi_3",
    "set_tolerance_light_luoi_3",
    "set_light_dai_luoi_4",
    "set_light_thu_luoi_4",
    "set_tolerance_light_luoi_4",
    
    // Environmental settings
    "ideal_light_time",
    "time_on_cooling",
    "time_off_cooling",
    "time_cut_off_sunlight",
    "time_off_cut_off_sunlight",
    "ideal_temperature",
    "ideal_humi",
    "ideal_light"
] as const;

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
} as const;

// Status messages
export const STATUS_MESSAGES = {
    INITIALIZING: "Initializing...",
    READY: "Ready",
    PROCESSING: "Processing control logic",
    FAN_CONTROL_ACTIVE: "Fan control active",
    WATER_PUMP_ACTIVE: "Water pump active",
    CURTAIN_CONTROL_ACTIVE: "Curtain control active",
    ERROR: "Error",
    DISABLED: "Auto control disabled"
} as const;

// Error messages
export const ERROR_MESSAGES = {
    CONFIG_READ_ERROR: "Failed to read configuration",
    SENSOR_DATA_ERROR: "Failed to read sensor data",
    MODBUS_WRITE_ERROR: "Modbus write operation failed",
    MODBUS_READ_ERROR: "Modbus read operation failed",
    INVALID_CONFIG: "Invalid configuration values",
    CONTROL_LOGIC_ERROR: "Control logic execution failed"
} as const;

// Modbus function codes
export const MODBUS_FUNCTION_CODES = {
    READ_COILS: 1,
    READ_INPUT_REGISTERS: 4,
    READ_HOLDING_REGISTERS: 3,
    WRITE_SINGLE_COIL: 5,
    WRITE_SINGLE_REGISTER: 6
} as const;

// Default Modbus configuration
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

/**
 * Fertilizer EC Control Module Constants
 *
 * Configuration constants for EC-based fertilizer control.
 * Values can be overridden via environment variables.
 */

// ========================================
// Modbus Register Addresses
// ========================================

export const MODBUS_REGISTERS = {
    // Control registers (write)
    CONTROL_MODE: 0,           // 0=Manual, 1=Flow, 2=EC
    IRI_SENSOR_MODE: 1,
    IRI_TIME: 2,
    SET_EC: 16,                // EC × 10 (e.g., 18 = 1.8)
    SET_PH: 17,                // pH × 10
    VALVE_PROGRAM_INDEX: 19,
    WATER_ONLY_TIME: 20,
    CYCLE_EC: 21,              // Cycle period × 0.6s (10 = 6s)
    CYCLE_PH: 22,

    // Valve ON times per cycle (ms)
    TIME_ON_VALVE_01: 23,
    TIME_ON_VALVE_02: 24,
    TIME_ON_VALVE_03: 25,
    TIME_ON_VALVE_04: 26,
    TIME_ON_VALVE_05: 27,

    // Manual valve times (seconds)
    TIME_VALVE_1: 4,
    TIME_VALVE_2: 5,
    TIME_VALVE_3: 6,
    TIME_VALVE_4: 7,
    TIME_VALVE_5: 8,

    // Flow setpoints
    SET_FLOW_1: 9,
    SET_FLOW_2: 10,
    SET_FLOW_3: 11,
    SET_FLOW_4: 12,
    SET_FLOW_5: 13,

    // Sensor readings (read)
    CURRENT_FLOW_1: 30,
    CURRENT_FLOW_2: 31,
    CURRENT_FLOW_3: 32,
    CURRENT_FLOW_4: 33,
    CURRENT_FLOW_5: 34,

    VOLUME_1: 36,
    VOLUME_2: 37,
    VOLUME_3: 38,
    VOLUME_4: 39,
    VOLUME_5: 40,

    IRI_TIME_REMAIN: 42,
    TOTAL_IRI_FLOW: 43,
    CURRENT_EC: 44,            // EC × 10
    CURRENT_PH: 45,            // pH × 10
    CURRENT_TEMP: 46,
    PUMP_PRESSURE: 47,

    // Calibration factors
    VOLUME_FACTOR_01: 200,
    VOLUME_FACTOR_02: 201,
    VOLUME_FACTOR_03: 202,
    VOLUME_FACTOR_04: 203,
    VOLUME_FACTOR_05: 204,
    VOLUME_FACTOR_MAIN: 205,

    FLOW_FACTOR_01: 210,
    FLOW_FACTOR_02: 211,
    FLOW_FACTOR_03: 212,
    FLOW_FACTOR_04: 213,
    FLOW_FACTOR_05: 214,
    FLOW_FACTOR_MAIN: 215,

    // Protection limits
    PRESSURE_DIV_FACTOR: 220,
    PRESSURE_SUB_FACTOR: 221,
    MIN_PRESSURE_LIMIT: 222,
    MAX_PRESSURE_LIMIT: 223,
    EC_MAX: 224,
    EC_MIN: 225,
} as const;

// ========================================
// Modbus Coil Addresses
// ========================================

export const MODBUS_COILS = {
    POWER: 30,
    MAIN_PUMP: 31,
    WATER_PUMP: 32,
    SUB_PUMP: 33,
    POWER_1: 34,
    POWER_2: 35,
    POWER_3: 36,
    POWER_4: 37,
    POWER_5: 38,
    VALVE_0: 39,
    VALVE_1: 40,
    VALVE_2: 41,
    VALVE_3: 42,
    VALVE_4: 43,
    VALVE_5: 44,
    VALVE_6: 45,
    EN_ALARM: 47,
    EN_EC_PH: 48,
    EN_PRESSURE: 50,
} as const;

// ========================================
// Control Mode Values
// ========================================

export const CONTROL_MODES = {
    MANUAL: 0,
    FLOW: 1,
    EC: 2,
} as const;

// ========================================
// EC Control Algorithm Defaults
// ========================================

export const EC_CONTROL_DEFAULTS = {
    /** Default cycle_ec value (10 × 0.6s = 6 second cycle) */
    CYCLE_EC: 10,

    /** Ramp-up period to skip for EC averaging (seconds) */
    RAMP_UP_SECONDS: 20,

    /** Adjustment step when EC deviates from target (ms) */
    ADJUSTMENT_STEP: 50,

    /** EC deviation threshold to trigger adjustment (mS/cm) */
    ADJUSTMENT_THRESHOLD: 0.05,

    /** Maximum valve ON time per cycle (ms) */
    MAX_VALVE_TIME: 5000,

    /** Minimum valve ON time per cycle (ms) */
    MIN_VALVE_TIME: 0,

    /** Polling interval for EC/flow readings (ms) */
    POLLING_INTERVAL: 1000,

    /** Context window size for EC averaging (samples) */
    CONTEXT_WINDOW_SIZE: 20,
} as const;

// ========================================
// Telemetry Key Mapping (Edge → Server)
// ========================================

export const TELEMETRY_KEY_MAP = {
    // EC sensor
    current_ec: 'EC',

    // Flow sensors
    current_flow_1: 'crt_flow_01',
    current_flow_2: 'crt_flow_02',
    current_flow_3: 'crt_flow_03',
    current_flow_4: 'crt_flow_04',
    current_flow_5: 'crt_flow_05',
} as const;

// ========================================
// Irrigation Run Status
// ========================================

export const RUN_STATUS = {
    RUNNING: 'Running',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    INTERRUPTED: 'Interrupted',
} as const;

// ========================================
// Data Type for Lookup Points
// ========================================

export const LOOKUP_DATA_TYPE = {
    ACTUAL: 'Actual',
    INTERPOLATED: 'Interpolated',
} as const;

// ========================================
// Error Codes
// ========================================

export const ERROR_CODES = {
    EC_TOO_HIGH: 'EC_HIGH',
    EC_TOO_LOW: 'EC_LOW',
    PRESSURE_HIGH: 'PRESSURE_HIGH',
    PRESSURE_LOW: 'PRESSURE_LOW',
    FLOW_ERROR: 'FLOW_ERROR',
    MODBUS_ERROR: 'MODBUS_ERROR',
    TIMEOUT: 'TIMEOUT',
    USER_STOP: 'USER_STOP',
} as const;

// ========================================
// Environment Variable Keys
// ========================================

export const ENV_KEYS = {
    CYCLE_EC: 'FERTILIZER_CYCLE_EC',
    RAMP_UP_SECONDS: 'FERTILIZER_RAMP_UP_SECONDS',
    ADJUSTMENT_STEP: 'FERTILIZER_ADJUSTMENT_STEP',
    ADJUSTMENT_THRESHOLD: 'FERTILIZER_ADJUSTMENT_THRESHOLD',
    MAX_VALVE_TIME: 'FERTILIZER_MAX_VALVE_TIME',
    TELEMETRY_MAP: 'FERTILIZER_TELEMETRY_MAP',
} as const;

// ========================================
// Backend API Endpoints
// ========================================

export const API_ENDPOINTS = {
    IRRIGATION_FINISHED: '/api/fertilizer/irrigation-finished',
    GET_LOOKUP_TABLE: '/api/fertilizer/:deviceId/lookup-table',
    UPDATE_LOOKUP_POINT: '/api/fertilizer/:deviceId/lookup-table-point',
    GET_HISTORY: '/api/fertilizer/:deviceId/history',
    SYNC: '/api/fertilizer/:deviceId/sync',
} as const;

// ========================================
// ThingsBoard Attribute Keys
// ========================================

export const TB_ATTRIBUTES = {
    LOOKUP_TABLE: 'fertilizer_lookup_table',
} as const;

"use strict";
/**
 * Fertilizer EC Control Module Constants
 *
 * Configuration constants for EC-based fertilizer control.
 * Values can be overridden via environment variables.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TB_ATTRIBUTES = exports.API_ENDPOINTS = exports.ENV_KEYS = exports.ERROR_CODES = exports.LOOKUP_DATA_TYPE = exports.RUN_STATUS = exports.TELEMETRY_KEY_MAP = exports.EC_CONTROL_DEFAULTS = exports.CONTROL_MODES = exports.MODBUS_COIL_KEYS = exports.MODBUS_REGISTER_KEYS = void 0;
const viis_telemetry_constants_1 = require("../../viis-telemetry/viis-telemetry-constants");
// ========================================
// Modbus Register Keys (for Global Context Lookup)
// ========================================
/**
 * Register keys to lookup addresses from global context
 * Usage: globalContext.get('modbus_board1_holding_registers')[MODBUS_REGISTER_KEYS.CONTROL_MODE]
 */
exports.MODBUS_REGISTER_KEYS = {
    // Control registers (write)
    CONTROL_MODE: 'control_mode', // 0=Manual, 1=Flow, 2=EC
    IRI_SENSOR_MODE: 'iri_sensor_mode',
    IRI_TIME: 'iri_time',
    SET_EC: 'set_ec', // EC × 10 (e.g., 18 = 1.8)
    SET_PH: 'set_ph', // pH × 10
    VALVE_PROGRAM_INDEX: 'valve_program_index',
    WATER_ONLY_TIME: 'water_only_time',
    CYCLE_EC: 'cycle_ec', // Cycle period × 0.6s (10 = 6s)
    CYCLE_PH: 'cycle_ph',
    // Valve ON times per cycle (ms)
    TIME_ON_VALVE_01: 'time_on_valve_01',
    TIME_ON_VALVE_02: 'time_on_valve_02',
    TIME_ON_VALVE_03: 'time_on_valve_03',
    TIME_ON_VALVE_04: 'time_on_valve_04',
    TIME_ON_VALVE_05: 'time_on_valve_05',
    // Manual valve times (seconds)
    TIME_VALVE_1: 'time_valve_1',
    TIME_VALVE_2: 'time_valve_2',
    TIME_VALVE_3: 'time_valve_3',
    TIME_VALVE_4: 'time_valve_4',
    TIME_VALVE_5: 'time_valve_5',
    // Flow setpoints
    SET_FLOW_1: 'set_flow_1',
    SET_FLOW_2: 'set_flow_2',
    SET_FLOW_3: 'set_flow_3',
    SET_FLOW_4: 'set_flow_4',
    SET_FLOW_5: 'set_flow_5',
    // Sensor readings (read)
    CURRENT_FLOW_1: 'current_flow_1',
    CURRENT_FLOW_2: 'current_flow_2',
    CURRENT_FLOW_3: 'current_flow_3',
    CURRENT_FLOW_4: 'current_flow_4',
    CURRENT_FLOW_5: 'current_flow_5',
    VOLUME_1: 'volume_1',
    VOLUME_2: 'volume_2',
    VOLUME_3: 'volume_3',
    VOLUME_4: 'volume_4',
    VOLUME_5: 'volume_5',
    IRI_TIME_REMAIN: 'iri_time_remain',
    TOTAL_IRI_FLOW: 'total_iri_flow',
    CURRENT_EC: 'current_ec', // Already scaled by polling node (÷1000)
    CURRENT_PH: 'current_ph', // Already scaled by polling node (÷100)
    CURRENT_TEMP: 'current_temp',
    PUMP_PRESSURE: 'pump_pressure', // Already scaled by polling node (÷10)
    // Calibration factors
    VOLUME_FACTOR_01: 'volume_factor_01',
    VOLUME_FACTOR_02: 'volume_factor_02',
    VOLUME_FACTOR_03: 'volume_factor_03',
    VOLUME_FACTOR_04: 'volume_factor_04',
    VOLUME_FACTOR_05: 'volume_factor_05',
    VOLUME_FACTOR_MAIN: 'volume_factor_main',
    FLOW_FACTOR_01: 'flow_factor_01',
    FLOW_FACTOR_02: 'flow_factor_02',
    FLOW_FACTOR_03: 'flow_factor_03',
    FLOW_FACTOR_04: 'flow_factor_04',
    FLOW_FACTOR_05: 'flow_factor_05',
    FLOW_FACTOR_MAIN: 'flow_factor_main',
    // Protection limits
    PRESSURE_DIV_FACTOR: 'pressure_div_factor',
    PRESSURE_SUB_FACTOR: 'pressure_sub_factor',
    MIN_PRESSURE_LIMIT: 'min_pressure_limit',
    MAX_PRESSURE_LIMIT: 'max_pressure_limit',
    EC_MAX: 'EC_max',
    EC_MIN: 'EC_min',
};
// ========================================
// Modbus Coil Keys (for Global Context Lookup)
// ========================================
/**
 * Coil keys to lookup addresses from global context
 * Usage: globalContext.get('modbus_board1_coils')[MODBUS_COIL_KEYS.POWER]
 */
exports.MODBUS_COIL_KEYS = {
    POWER: 'power',
    MAIN_PUMP: 'main_pump',
    WATER_PUMP: 'water_pump',
    SUB_PUMP: 'sub_pump',
    POWER_1: 'power_1',
    POWER_2: 'power_2',
    POWER_3: 'power_3',
    POWER_4: 'power_4',
    POWER_5: 'power_5',
    VALVE_0: 'valve_0',
    VALVE_1: 'valve_1',
    VALVE_2: 'valve_2',
    VALVE_3: 'valve_3',
    VALVE_4: 'valve_4',
    VALVE_5: 'valve_5',
    VALVE_6: 'valve_6',
    EN_ALARM: 'en_alarm',
    EN_EC_PH: 'en_ec_ph',
    EN_PRESSURE: 'en_pressure',
};
// ========================================
// Control Mode Values
// ========================================
exports.CONTROL_MODES = {
    MANUAL: 0,
    FLOW: 1,
    EC: 2,
};
// ========================================
// EC Control Algorithm Defaults
// ========================================
exports.EC_CONTROL_DEFAULTS = {
    /** Default cycle_ec value (10 × 0.6s = 6 second cycle) */
    CYCLE_EC: 10,
    /** Ramp-up period to skip for EC averaging (seconds) */
    RAMP_UP_SECONDS: 20,
    /** Adjustment step when EC deviates from target (ms) */
    ADJUSTMENT_STEP: 500,
    /** EC deviation threshold to trigger adjustment (mS/cm) */
    ADJUSTMENT_THRESHOLD: 0.05,
    /** Maximum valve ON time per cycle (ms) */
    MAX_VALVE_TIME: 10000,
    /** Minimum valve ON time per cycle (ms) */
    MIN_VALVE_TIME: 0,
    /** Polling interval for EC/flow readings (ms) - TCP connections */
    POLLING_INTERVAL: 1000,
    /** Polling interval for RTU connections (ms) - slower to avoid bus contention */
    POLLING_INTERVAL_RTU: 2000,
    /** Delay between consecutive Modbus writes for RTU (ms) */
    RTU_INTER_WRITE_DELAY: 100,
    /** Delay after completing all writes for RTU (ms) */
    RTU_WRITE_SETTLE_DELAY: 50,
    /** Context window size for EC averaging (samples) */
    CONTEXT_WINDOW_SIZE: 20,
    /** EC sensor scaling factor (PLC stores value × 1000) */
    EC_SCALE_FACTOR: 1000,
    /** pH sensor scaling factor (PLC stores value × 100) */
    PH_SCALE_FACTOR: 100,
    /** Maximum age of global context data before considered stale (ms) */
    GLOBAL_DATA_MAX_AGE: 10000,
    /** Global context key for holding register data (from polling flow) */
    GLOBAL_HOLDING_DATA_KEY: viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA,
    /** Global context key for coil data (from polling flow) */
    GLOBAL_COIL_DATA_KEY: viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA,
};
// ========================================
// Telemetry Key Mapping (Edge → Server)
// ========================================
exports.TELEMETRY_KEY_MAP = {
    // EC sensor
    current_ec: 'current_ec',
    // Flow sensors
    current_flow_1: 'current_flow_01',
    current_flow_2: 'current_flow_02',
    current_flow_3: 'current_flow_03',
    current_flow_4: 'current_flow_04',
    current_flow_5: 'current_flow_05',
};
// ========================================
// Irrigation Run Status
// ========================================
exports.RUN_STATUS = {
    RUNNING: 'Running',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    INTERRUPTED: 'Interrupted',
};
// ========================================
// Data Type for Lookup Points
// ========================================
exports.LOOKUP_DATA_TYPE = {
    ACTUAL: 'Actual',
    INTERPOLATED: 'Interpolated',
};
// ========================================
// Error Codes
// ========================================
exports.ERROR_CODES = {
    EC_TOO_HIGH: 'EC_HIGH',
    EC_TOO_LOW: 'EC_LOW',
    PRESSURE_HIGH: 'PRESSURE_HIGH',
    PRESSURE_LOW: 'PRESSURE_LOW',
    FLOW_ERROR: 'FLOW_ERROR',
    MODBUS_ERROR: 'MODBUS_ERROR',
    TIMEOUT: 'TIMEOUT',
    USER_STOP: 'USER_STOP',
};
// ========================================
// Environment Variable Keys
// ========================================
exports.ENV_KEYS = {
    CYCLE_EC: 'FERTILIZER_CYCLE_EC',
    RAMP_UP_SECONDS: 'FERTILIZER_RAMP_UP_SECONDS',
    ADJUSTMENT_STEP: 'FERTILIZER_ADJUSTMENT_STEP',
    ADJUSTMENT_THRESHOLD: 'FERTILIZER_ADJUSTMENT_THRESHOLD',
    MAX_VALVE_TIME: 'FERTILIZER_MAX_VALVE_TIME',
    TELEMETRY_MAP: 'FERTILIZER_TELEMETRY_MAP',
};
// ========================================
// Backend API Endpoints
// ========================================
exports.API_ENDPOINTS = {
    // NOTE: Backend uses /api/v2/ NOT /api/
    IRRIGATION_FINISHED: '/api/v2/fertilizer/irrigation-finished',
    GET_LOOKUP_TABLE: '/api/v2/fertilizer/:deviceId/lookup-table',
    UPDATE_LOOKUP_POINT: '/api/v2/fertilizer/:deviceId/lookup-table-point',
    GET_HISTORY: '/api/v2/fertilizer/:deviceId/history',
    SYNC: '/api/v2/fertilizer/:deviceId/sync',
};
// ========================================
// ThingsBoard Attribute Keys
// ========================================
exports.TB_ATTRIBUTES = {
    LOOKUP_TABLE: 'fertilizer_lookup_table',
};

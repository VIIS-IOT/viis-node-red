/**
 * Constants for viis-flow-calibration node
 */

export const ENV_KEYS = {
    MODBUS_BOARDS: 'MODBUS_BOARDS',
    MODBUS_DEFAULT_BOARD: 'MODBUS_DEFAULT_BOARD',
    MODBUS_BOARD1_HOLDING_REGISTERS: 'modbus_board1_holding_registers',
    MODBUS_BOARD2_HOLDING_REGISTERS: 'modbus_board2_holding_registers',
    MODBUS_BOARD2_INPUT_REGISTERS: 'modbus_board2_input_registers',
    DEVICE_ID: 'DEVICE_ID',
} as const;

export const DEFAULTS = {
    CHECK_INTERVAL: 2000,  // 2 seconds
    NUM_PUMPS: 16,
    SCALE_FACTOR: 100,     // Multiply values before writing to Modbus
} as const;

export const STATUS_MESSAGES = {
    INITIALIZING: 'Initializing...',
    READY: 'Ready',
    CHECKING: 'Checking calibration flags...',
    CALIBRATING: 'Calibrating...',
    SUCCESS: 'Calibration complete',
    ERROR: 'Error',
    NO_CALIBRATION: 'No calibration pending',
} as const;

export const ERROR_MESSAGES = {
    NO_MODBUS_CLIENT: 'Modbus client not available',
    DIVISION_BY_ZERO: 'Division by zero error',
    MISSING_DATA: 'Missing required data',
    INVALID_PUMP_INDEX: 'Invalid pump index',
} as const;

// Global context keys for calibration
export const CONFIG_KEYS = {
    CALCULATE_CALIB: (i: number) => `CALCULATE_CALIB_BOM_${i}`,
    CALIB_ACTUAL_ML: (i: number) => `CALIB_ACTUAL_ML_BOM_${i}`,
} as const;

// Modbus register keys for board1 (pump control)
export const BOARD1_KEYS = {
    SET_ML: (i: number) => `HOLDING_SETML_BOM_${i}`,
    CALIB: (i: number) => `HOLDING_CALIB_BOM_${i}`,
} as const;

// Modbus register keys for board2 (flow sensor)
export const BOARD2_KEYS = {
    K_FACTOR: (i: number) => `HOLDING_K_FACTOR_BOM_${i}`,
    FLOWRATE: (i: number) => `HOLDING_FLOWRATE_BOM_${i}`,
    INPUT_TOTAL_FLOW: (i: number) => `INPUT_TOTAL_FLOW_BOM_${i}`,
} as const;

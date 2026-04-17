/**
 * Constants for viis-flow-calibration node
 */

export const ENV_KEYS = {
    MODBUS_BOARDS: 'MODBUS_BOARDS',
    MODBUS_DEFAULT_BOARD: 'MODBUS_DEFAULT_BOARD',
    MODBUS_BOARD1_HOLDING_REGISTERS: 'modbus_board1_holding_registers',
    MODBUS_BOARD2_HOLDING_REGISTERS: 'modbus_board2_holding_registers',
    MODBUS_BOARD2_INPUT_REGISTERS: 'modbus_board2_input_registers',
    MODBUS_BOARD2_COILS: 'modbus_board2_coils',
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
// Note: Current mapping uses FLOWRATE = 0-15, K_FACTOR = 20-35, INPUT_TOTAL_FLOW = 20-35
export const BOARD2_KEYS = {
    K_FACTOR: (i: number) => `HOLDING_K_FACTOR_BOM_${i}`,
    FLOWRATE: (i: number) => `HOLDING_FLOWRATE_BOM_${i}`,
    INPUT_TOTAL_FLOW: (i: number) => `INPUT_TOTAL_FLOW_BOM_${i}`,
} as const;

/**
 * Board2 Register Address Mapping (for reference only)
 * 
 * DEPRECATED: Do not use BOARD2_ADDRESSES directly.
 * Board2 addresses are now read from global context (modbusMappings.board2.coils)
 * to avoid hard-coding and support flexible configuration.
 *
 * Holding Registers (write):
 * - FLOWRATE: addresses 0-15 (pump 1-16)
 * - K_FACTOR: addresses 20-35 (pump 1-16)
 *
 * Input Registers (read-only):
 * - CURRENT_FLOW: addresses 0-15 (pump 1-16)
 * - TOTAL_FLOW: addresses 20-35 (pump 1-16)
 *
 * Coils:
 * - PUMP_STATUS: 160-175 (pump 1-16)
 * - RESET_TOTAL_VOLUME: 200-215 (pump 1-16)
 */
export const BOARD2_ADDRESSES_DEPRECATED = {
    K_FACTOR_BASE: 20,          // K_FACTOR_BOM_1 = 20, K_FACTOR_BOM_2 = 21, ...
    FLOWRATE_BASE: 0,           // FLOWRATE_BOM_1 = 0, FLOWRATE_BOM_2 = 1, ...
    INPUT_CURRENT_FLOW_BASE: 0, // INPUT_CURRENT_FLOW_BOM_1 = 0, ...
    INPUT_TOTAL_FLOW_BASE: 20,  // INPUT_TOTAL_FLOW_BOM_1 = 20, ...
    COIL_PUMP_STATUS_BASE: 160, // PUMP_STATUS_BOM_1 = 160, ...
    COIL_RESET_BASE: 200,       // RESET_TOTAL_VOLUME_BOM_1 = 200, ...
} as const;

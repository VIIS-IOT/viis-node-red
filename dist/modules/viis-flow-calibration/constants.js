"use strict";
/**
 * Constants for viis-flow-calibration node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOARD2_ADDRESSES = exports.BOARD2_KEYS = exports.BOARD1_KEYS = exports.CONFIG_KEYS = exports.ERROR_MESSAGES = exports.STATUS_MESSAGES = exports.DEFAULTS = exports.ENV_KEYS = void 0;
exports.ENV_KEYS = {
    MODBUS_BOARDS: 'MODBUS_BOARDS',
    MODBUS_DEFAULT_BOARD: 'MODBUS_DEFAULT_BOARD',
    MODBUS_BOARD1_HOLDING_REGISTERS: 'modbus_board1_holding_registers',
    MODBUS_BOARD2_HOLDING_REGISTERS: 'modbus_board2_holding_registers',
    MODBUS_BOARD2_INPUT_REGISTERS: 'modbus_board2_input_registers',
    DEVICE_ID: 'DEVICE_ID',
};
exports.DEFAULTS = {
    CHECK_INTERVAL: 2000, // 2 seconds
    NUM_PUMPS: 16,
    SCALE_FACTOR: 100, // Multiply values before writing to Modbus
};
exports.STATUS_MESSAGES = {
    INITIALIZING: 'Initializing...',
    READY: 'Ready',
    CHECKING: 'Checking calibration flags...',
    CALIBRATING: 'Calibrating...',
    SUCCESS: 'Calibration complete',
    ERROR: 'Error',
    NO_CALIBRATION: 'No calibration pending',
};
exports.ERROR_MESSAGES = {
    NO_MODBUS_CLIENT: 'Modbus client not available',
    DIVISION_BY_ZERO: 'Division by zero error',
    MISSING_DATA: 'Missing required data',
    INVALID_PUMP_INDEX: 'Invalid pump index',
};
// Global context keys for calibration
exports.CONFIG_KEYS = {
    CALCULATE_CALIB: (i) => `CALCULATE_CALIB_BOM_${i}`,
    CALIB_ACTUAL_ML: (i) => `CALIB_ACTUAL_ML_BOM_${i}`,
};
// Modbus register keys for board1 (pump control)
exports.BOARD1_KEYS = {
    SET_ML: (i) => `HOLDING_SETML_BOM_${i}`,
    CALIB: (i) => `HOLDING_CALIB_BOM_${i}`,
};
// Modbus register keys for board2 (flow sensor)
// Note: Addresses follow formula: K_FACTOR = i-1, FLOWRATE = 19+i, INPUT_TOTAL_FLOW = 19+i
exports.BOARD2_KEYS = {
    K_FACTOR: (i) => `HOLDING_K_FACTOR_BOM_${i}`,
    FLOWRATE: (i) => `HOLDING_FLOWRATE_BOM_${i}`,
    INPUT_TOTAL_FLOW: (i) => `INPUT_TOTAL_FLOW_BOM_${i}`,
};
/**
 * Board2 Register Address Mapping (for reference)
 *
 * Holding Registers (write):
 * - K_FACTOR: addresses 0-15 (pump 1-16)
 * - FLOWRATE: addresses 20-35 (pump 1-16)
 *
 * Input Registers (read-only):
 * - CURRENT_FLOW: addresses 0-15 (pump 1-16)
 * - TOTAL_FLOW: addresses 20-35 (pump 1-16)
 *
 * Coils:
 * - PUMP_STATUS: 161-176 (pump 1-16)
 * - RESET_TOTAL_VOLUME: 201-216 (pump 1-16)
 */
exports.BOARD2_ADDRESSES = {
    K_FACTOR_BASE: 0, // K_FACTOR_BOM_1 = 0, K_FACTOR_BOM_2 = 1, ...
    FLOWRATE_BASE: 20, // FLOWRATE_BOM_1 = 20, FLOWRATE_BOM_2 = 21, ...
    INPUT_CURRENT_FLOW_BASE: 0, // INPUT_CURRENT_FLOW_BOM_1 = 0, ...
    INPUT_TOTAL_FLOW_BASE: 20, // INPUT_TOTAL_FLOW_BOM_1 = 20, ...
    COIL_PUMP_STATUS_BASE: 161, // PUMP_STATUS_BOM_1 = 161, ...
    COIL_RESET_BASE: 201, // RESET_TOTAL_VOLUME_BOM_1 = 201, ...
};

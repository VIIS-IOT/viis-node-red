"use strict";
/**
 * Constants for viis-flow-calibration node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOARD2_KEYS = exports.BOARD1_KEYS = exports.CONFIG_KEYS = exports.ERROR_MESSAGES = exports.STATUS_MESSAGES = exports.DEFAULTS = exports.ENV_KEYS = void 0;
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
exports.BOARD2_KEYS = {
    K_FACTOR: (i) => `HOLDING_K_FACTOR_BOM_${i}`,
    FLOWRATE: (i) => `HOLDING_FLOWRATE_BOM_${i}`,
    INPUT_TOTAL_FLOW: (i) => `INPUT_TOTAL_FLOW_BOM_${i}`,
};

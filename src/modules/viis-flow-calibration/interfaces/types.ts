/**
 * TypeScript interfaces for viis-flow-calibration node
 */

import { NodeDef } from "node-red";

/**
 * Node configuration definition
 */
export interface ViisFlowCalibrationNodeDef extends NodeDef {
    checkInterval: number;
    enableLogging: boolean;
    calibrateBoard1: boolean;
    calibrateBoard2: boolean;
}

/**
 * Input for calibration calculation
 */
export interface CalibrationInput {
    pumpIndex: number;           // 1-16
    actualMl: number;            // User measured volume (V_real)
    setMl: number;               // Target volume (from HOLDING_SETML_BOM_n)
    currentCalibBoard1: number;  // Current HOLDING_CALIB_BOM_n (scaled by 100)
    currentKFactor: number;      // Current K-Factor from board2
    currentFlowrate: number;     // Current expected pump flowrate (mL/s)
    reportedVolume: number | null; // Volume reported by flow sensor, null when unread
    hasBoard2Data?: boolean;     // True when board2 data is valid for K-Factor calibration
}

/**
 * Result of calibration calculation
 */
export interface CalibrationResult {
    pumpIndex: number;
    board1: {
        newCalibValue: number;     // New HOLDING_CALIB_BOM_n (scaled by 100)
        address: number;           // Modbus address
        registerKey: string;
    } | null;
    board2: {
        newKFactor: number;        // New K-Factor
        kFactorAddress: number;
        kFactorKey: string;
        newFlowrate?: number;      // Omitted when sensor volume or flowrate is missing
        flowrateAddress: number;
        flowrateKey: string;
    } | null;
    runTime: number;               // Calculated run time (seconds)
    success: boolean;
    error?: string;
}

/**
 * Status of calibration node
 */
export interface CalibrationStatus {
    lastCheck: number | null;
    lastCalibration: number | null;
    totalCalibrations: number;
    failedCalibrations: number;
    pendingCalibrations: number[];
}

/**
 * Modbus write command
 */
export interface ModbusWriteCommand {
    boardId: string;
    fc: number;           // Function code (6 = Write Single Register)
    unitId: number;
    address: number;
    value: number;
}

/**
 * MQTT publish payload for calibration flag reset
 */
export interface CalibrationFlagResetPayload {
    [key: string]: boolean | number;
}

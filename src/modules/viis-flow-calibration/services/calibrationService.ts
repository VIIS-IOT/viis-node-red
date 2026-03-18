/**
 * Calibration Service for viis-flow-calibration node
 * Handles the calibration calculation logic for both board1 (pump) and board2 (flow sensor)
 */

import { CalibrationInput, CalibrationResult } from "../interfaces/types";
import { DEFAULTS, BOARD1_KEYS, BOARD2_KEYS, ERROR_MESSAGES } from "../constants";

export class CalibrationService {
    private enableLogging: boolean;
    private nodeId: string;

    constructor(nodeId: string, enableLogging: boolean = false) {
        this.nodeId = nodeId;
        this.enableLogging = enableLogging;
    }

    private log(message: string): void {
        if (this.enableLogging) {
            console.log(`[FLOW_CALIB:${this.nodeId}] ${message}`);
        }
    }

    private warn(message: string): void {
        console.warn(`[FLOW_CALIB:${this.nodeId}] ${message}`);
    }

    /**
     * Calculate calibration values for both board1 and board2
     */
    public calculate(
        input: CalibrationInput,
        board1Registers: Record<string, number>,
        board2Registers: Record<string, number>,
        calibrateBoard1: boolean = true,
        calibrateBoard2: boolean = true
    ): CalibrationResult {
        const { pumpIndex, actualMl, setMl, currentCalibBoard1, currentKFactor, currentFlowrate, reportedVolume } = input;

        // Validate pump index
        if (pumpIndex < 1 || pumpIndex > DEFAULTS.NUM_PUMPS) {
            return this.errorResult(pumpIndex, ERROR_MESSAGES.INVALID_PUMP_INDEX);
        }

        // Validate actualMl to prevent division by zero
        if (!actualMl || actualMl === 0) {
            return this.errorResult(pumpIndex, `${ERROR_MESSAGES.DIVISION_BY_ZERO}: actualMl is zero`);
        }

        // Validate currentCalibBoard1 for board1 calibration
        if (calibrateBoard1 && (!currentCalibBoard1 || currentCalibBoard1 === 0)) {
            return this.errorResult(pumpIndex, `${ERROR_MESSAGES.DIVISION_BY_ZERO}: currentCalibBoard1 is zero`);
        }

        this.log(`Calculating calibration for pump ${pumpIndex}`);
        this.log(`  actualMl=${actualMl}, setMl=${setMl}, currentCalibBoard1=${currentCalibBoard1}`);
        this.log(`  currentKFactor=${currentKFactor}, reportedVolume=${reportedVolume}`);

        // Calculate run time: RUN_TIME = setMl / currentCalibBoard1
        // Note: currentCalibBoard1 is stored as value * 100 in Modbus
        const currentCalibUnscaled = currentCalibBoard1 / DEFAULTS.SCALE_FACTOR;
        const runTime = setMl / currentCalibUnscaled;

        this.log(`  runTime=${runTime.toFixed(4)}s`);

        const result: CalibrationResult = {
            pumpIndex,
            board1: null,
            board2: null,
            runTime,
            success: true,
        };

        // Calculate Board1: newCalibValue = actualMl / runTime (scaled by 100)
        if (calibrateBoard1) {
            const newCalibValue = actualMl / runTime;
            const scaledCalibValue = Math.round(newCalibValue * DEFAULTS.SCALE_FACTOR);
            const calibKey = BOARD1_KEYS.CALIB(pumpIndex);
            const calibAddress = board1Registers[calibKey];

            if (calibAddress !== undefined) {
                result.board1 = {
                    newCalibValue: scaledCalibValue,
                    address: calibAddress,
                    registerKey: calibKey,
                };
                this.log(`  Board1: newCalib=${newCalibValue.toFixed(4)} (scaled=${scaledCalibValue}), address=${calibAddress}`);
            } else {
                this.warn(`  Board1: Register ${calibKey} not found in mapping`);
            }
        }

        // Calculate Board2: K_new = K_old × (V_actual / V_reported)
        // Calculate Board2: Q_new = actualMl / runTime
        if (calibrateBoard2) {
            const kFactorKey = BOARD2_KEYS.K_FACTOR(pumpIndex);
            const flowrateKey = BOARD2_KEYS.FLOWRATE(pumpIndex);
            const kFactorAddress = board2Registers[kFactorKey];
            const flowrateAddress = board2Registers[flowrateKey];

            if (kFactorAddress !== undefined && flowrateAddress !== undefined) {
                // K-Factor calculation: K_new = K_old × (V_actual / V_reported)
                // Logic: If sensor over-reports (reported > actual), K-Factor should decrease
                //        If sensor under-reports (reported < actual), K-Factor should increase
                let newKFactor = currentKFactor;
                if (reportedVolume > 0 && actualMl > 0 && currentKFactor > 0) {
                    newKFactor = Math.round(currentKFactor * (actualMl / reportedVolume));
                }

                // Flowrate calculation: Q_new = V_actual / T_run (mL/s, scaled by 100)
                const newFlowrate = Math.round((actualMl / runTime) * DEFAULTS.SCALE_FACTOR);

                result.board2 = {
                    newKFactor,
                    kFactorAddress,
                    kFactorKey,
                    newFlowrate,
                    flowrateAddress,
                    flowrateKey,
                };
                this.log(`  Board2: newKFactor=${newKFactor}, newFlowrate=${newFlowrate / DEFAULTS.SCALE_FACTOR} mL/s`);
            } else {
                this.warn(`  Board2: Registers not found - kFactor=${kFactorKey}, flowrate=${flowrateKey}`);
            }
        }

        return result;
    }

    /**
     * Create error result
     */
    private errorResult(pumpIndex: number, error: string): CalibrationResult {
        this.warn(`Calibration error for pump ${pumpIndex}: ${error}`);
        return {
            pumpIndex,
            board1: null,
            board2: null,
            runTime: 0,
            success: false,
            error,
        };
    }
}

"use strict";
/**
 * Calibration Service for viis-flow-calibration node
 * Handles the calibration calculation logic for both board1 (pump) and board2 (flow sensor)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalibrationService = void 0;
const constants_1 = require("../constants");
class CalibrationService {
    constructor(nodeId, enableLogging = false) {
        this.nodeId = nodeId;
        this.enableLogging = enableLogging;
    }
    log(message) {
        if (this.enableLogging) {
            console.log(`[FLOW_CALIB:${this.nodeId}] ${message}`);
        }
    }
    warn(message) {
        console.warn(`[FLOW_CALIB:${this.nodeId}] ${message}`);
    }
    /**
     * Calculate calibration values for both board1 and board2
     */
    calculate(input, board1Registers, board2Registers, calibrateBoard1 = true, calibrateBoard2 = true) {
        const { pumpIndex, actualMl, setMl, currentCalibBoard1, currentKFactor, currentFlowrate, reportedVolume } = input;
        // Validate pump index
        if (pumpIndex < 1 || pumpIndex > constants_1.DEFAULTS.NUM_PUMPS) {
            return this.errorResult(pumpIndex, constants_1.ERROR_MESSAGES.INVALID_PUMP_INDEX);
        }
        // Validate actualMl to prevent division by zero
        if (!actualMl || actualMl === 0) {
            return this.errorResult(pumpIndex, `${constants_1.ERROR_MESSAGES.DIVISION_BY_ZERO}: actualMl is zero`);
        }
        // Validate currentCalibBoard1 for board1 calibration
        if (calibrateBoard1 && (!currentCalibBoard1 || currentCalibBoard1 === 0)) {
            return this.errorResult(pumpIndex, `${constants_1.ERROR_MESSAGES.DIVISION_BY_ZERO}: currentCalibBoard1 is zero`);
        }
        this.log(`Calculating calibration for pump ${pumpIndex}`);
        this.log(`  actualMl=${actualMl}, setMl=${setMl}, currentCalibBoard1=${currentCalibBoard1}`);
        this.log(`  currentKFactor=${currentKFactor}, reportedVolume=${reportedVolume}`);
        // Calculate run time: RUN_TIME = setMl / currentCalibBoard1
        // IMPORTANT: currentCalibBoard1 is read from global context (holding_register_data_1)
        // Node-RED "Map Holding Data" function already unscaled the value (divided by 100)
        // So currentCalibBoard1 = 10.00 (ml/s), NOT 1000 (scaled)
        // Example: Modbus value 1000 → Node-RED unscales to 10.00 → global stores 10.00
        const currentCalibUnscaled = currentCalibBoard1; // Already unscaled by Node-RED!
        const runTime = setMl / currentCalibUnscaled;
        this.log(`  runTime=${runTime.toFixed(4)}s`);
        const result = {
            pumpIndex,
            board1: null,
            board2: null,
            runTime,
            success: true,
        };
        // Calculate Board1: newCalibValue = actualMl / runTime (scaled by 100)
        if (calibrateBoard1) {
            const newCalibValue = actualMl / runTime;
            const scaledCalibValue = Math.round(newCalibValue * constants_1.DEFAULTS.SCALE_FACTOR);
            const calibKey = constants_1.BOARD1_KEYS.CALIB(pumpIndex);
            const calibAddress = board1Registers[calibKey];
            if (calibAddress !== undefined) {
                result.board1 = {
                    newCalibValue: scaledCalibValue,
                    address: calibAddress,
                    registerKey: calibKey,
                };
                this.log(`  Board1: newCalib=${newCalibValue.toFixed(4)} (scaled=${scaledCalibValue}), address=${calibAddress}`);
            }
            else {
                this.warn(`  Board1: Register ${calibKey} not found in mapping`);
            }
        }
        // Calculate Board2: K_new = K_old × (V_actual / V_reported)
        // Calculate Board2: Q_new = actualMl / runTime
        if (calibrateBoard2) {
            const kFactorKey = constants_1.BOARD2_KEYS.K_FACTOR(pumpIndex);
            const flowrateKey = constants_1.BOARD2_KEYS.FLOWRATE(pumpIndex);
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
                const newFlowrate = Math.round((actualMl / runTime) * constants_1.DEFAULTS.SCALE_FACTOR);
                result.board2 = {
                    newKFactor,
                    kFactorAddress,
                    kFactorKey,
                    newFlowrate,
                    flowrateAddress,
                    flowrateKey,
                };
                this.log(`  Board2: newKFactor=${newKFactor}, newFlowrate=${newFlowrate / constants_1.DEFAULTS.SCALE_FACTOR} mL/s`);
            }
            else {
                this.warn(`  Board2: Registers not found - kFactor=${kFactorKey}, flowrate=${flowrateKey}`);
            }
        }
        return result;
    }
    /**
     * Create error result
     */
    errorResult(pumpIndex, error) {
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
exports.CalibrationService = CalibrationService;

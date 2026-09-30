"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCalibrationTelemetry = buildCalibrationTelemetry;
exports.calibrationSkipReason = calibrationSkipReason;
function buildCalibrationTelemetry(input) {
    const pump = input.pumpIndex;
    const payload = {
        [`CALCULATE_CALIB_BOM_${pump}`]: false,
        [`CALIB_ERROR_BOM_${pump}`]: input.error,
    };
    if (input.calibUnscaled !== undefined) {
        payload[`HOLDING_CALIB_BOM_${pump}`] = input.calibUnscaled;
    }
    if (input.kFactorUnscaled !== undefined) {
        payload[`HOLDING_K_FACTOR_BOM_${pump}`] = input.kFactorUnscaled;
    }
    if (input.flowrateUnscaled !== undefined) {
        payload[`HOLDING_FLOWRATE_BOM_${pump}`] = input.flowrateUnscaled;
    }
    return payload;
}
function calibrationSkipReason(input) {
    const reasons = [];
    if (!input.hasBoard2Data) {
        reasons.push(`missing HOLDING_FLOWRATE_BOM_${input.pumpIndex}`);
    }
    if (input.reportedVolume === null) {
        reasons.push(`missing INPUT_TOTAL_FLOW_BOM_${input.pumpIndex}`);
    }
    return reasons.join("; ");
}

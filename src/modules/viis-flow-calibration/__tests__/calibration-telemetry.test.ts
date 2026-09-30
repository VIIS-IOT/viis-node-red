import { buildCalibrationTelemetry } from "../calibration-telemetry";

test("success telemetry clears the flag and the error", () => {
    expect(buildCalibrationTelemetry({
        pumpIndex: 1,
        calibUnscaled: 8,
        kFactorUnscaled: 8,
        flowrateUnscaled: 12.5,
        error: "",
    })).toEqual({
        CALCULATE_CALIB_BOM_1: false,
        CALIB_ERROR_BOM_1: "",
        HOLDING_CALIB_BOM_1: 8,
        HOLDING_K_FACTOR_BOM_1: 8,
        HOLDING_FLOWRATE_BOM_1: 12.5,
    });
});

test("skipped flowrate telemetry explains why", () => {
    expect(buildCalibrationTelemetry({
        pumpIndex: 2,
        calibUnscaled: 8,
        kFactorUnscaled: 8,
        error: "missing INPUT_TOTAL_FLOW_BOM_2",
    })).toEqual({
        CALCULATE_CALIB_BOM_2: false,
        CALIB_ERROR_BOM_2: "missing INPUT_TOTAL_FLOW_BOM_2",
        HOLDING_CALIB_BOM_2: 8,
        HOLDING_K_FACTOR_BOM_2: 8,
    });
});

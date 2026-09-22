export interface CalibrationTelemetryInput {
    pumpIndex: number;
    calibUnscaled?: number;
    kFactorUnscaled?: number;
    flowrateUnscaled?: number;
    error: string;
}

export function buildCalibrationTelemetry(
    input: CalibrationTelemetryInput,
): Record<string, string | number | boolean> {
    const pump = input.pumpIndex;
    const payload: Record<string, string | number | boolean> = {
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

export function calibrationSkipReason(input: {
    pumpIndex: number;
    hasBoard2Data?: boolean;
    reportedVolume: number | null;
}): string {
    const reasons: string[] = [];
    if (!input.hasBoard2Data) {
        reasons.push(`missing HOLDING_FLOWRATE_BOM_${input.pumpIndex}`);
    }
    if (input.reportedVolume === null) {
        reasons.push(`missing INPUT_TOTAL_FLOW_BOM_${input.pumpIndex}`);
    }
    return reasons.join("; ");
}

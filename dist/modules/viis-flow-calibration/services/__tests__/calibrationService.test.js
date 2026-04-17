"use strict";
/**
 * Unit tests for CalibrationService
 */
Object.defineProperty(exports, "__esModule", { value: true });
const calibrationService_1 = require("../calibrationService");
describe("CalibrationService", () => {
    let service;
    const board1Registers = {
        HOLDING_CALIB_BOM_1: 17,
        HOLDING_CALIB_BOM_2: 18,
    };
    const board2Registers = {
        HOLDING_K_FACTOR_BOM_1: 0,
        HOLDING_K_FACTOR_BOM_2: 1,
        HOLDING_FLOWRATE_BOM_1: 20,
        HOLDING_FLOWRATE_BOM_2: 21,
    };
    beforeEach(() => {
        service = new calibrationService_1.CalibrationService("test-node", false);
    });
    describe("calculate()", () => {
        it("should calculate calibration values correctly for normal input", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 950, // User measured 950 mL
                setMl: 1000, // Target was 1000 mL
                currentCalibBoard1: 10, // Current calib = 10.00 ml/s (already unscaled by Node-RED)
                currentKFactor: 450, // Current K-factor
                currentFlowrate: 10, // Current flowrate = 10 mL/s (already unscaled)
                reportedVolume: 1000, // Sensor reported 1000 mL
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, true);
            expect(result.success).toBe(true);
            expect(result.pumpIndex).toBe(1);
            expect(result.board1).not.toBeNull();
            expect(result.board2).not.toBeNull();
            // Board1: runTime = 1000 / 10 = 100s, newCalib = 950 / 100 = 9.5 (scaled = 950)
            expect(result.board1.address).toBe(17);
            expect(result.board1.newCalibValue).toBe(950);
            // Board2 K-Factor (pump coeff): K_new = 950 / 100 * 100 = 950
            expect(result.board2.newKFactor).toBe(950);
            // Board2 Flowrate (sensor coeff): F_new = 10 * (1000/950) * 100 ≈ 1053
            expect(result.board2.newFlowrate).toBe(1053);
        });
        it("should handle division by zero when actualMl is 0", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 0, // Will cause division by zero
                setMl: 1000,
                currentCalibBoard1: 10, // Already unscaled
                currentKFactor: 450,
                currentFlowrate: 10,
                reportedVolume: 1000,
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, true);
            expect(result.success).toBe(false);
            expect(result.error).toContain("actualMl is zero");
        });
        it("should handle division by zero when currentCalibBoard1 is 0", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 950,
                setMl: 1000,
                currentCalibBoard1: 0, // Will cause division by zero
                currentKFactor: 450,
                currentFlowrate: 10,
                reportedVolume: 1000,
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, true);
            expect(result.success).toBe(false);
            expect(result.error).toContain("currentCalibBoard1 is zero");
        });
        it("should handle invalid pump index", () => {
            const input = {
                pumpIndex: 20, // Invalid, max is 16
                actualMl: 950,
                setMl: 1000,
                currentCalibBoard1: 10,
                currentKFactor: 450,
                currentFlowrate: 10,
                reportedVolume: 1000,
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, true);
            expect(result.success).toBe(false);
            expect(result.error).toContain("Invalid pump index");
        });
        it("should calibrate only board1 when board2 is disabled", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 950,
                setMl: 1000,
                currentCalibBoard1: 10,
                currentKFactor: 450,
                currentFlowrate: 10,
                reportedVolume: 1000,
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, false);
            expect(result.success).toBe(true);
            expect(result.board1).not.toBeNull();
            expect(result.board2).toBeNull();
        });
        it("should calibrate only board2 when board1 is disabled", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 950,
                setMl: 1000,
                currentCalibBoard1: 10,
                currentKFactor: 450,
                currentFlowrate: 10,
                reportedVolume: 1000,
            };
            const result = service.calculate(input, board1Registers, board2Registers, false, true);
            expect(result.success).toBe(true);
            expect(result.board1).toBeNull();
            expect(result.board2).not.toBeNull();
        });
        it("should handle case where sensor reported more than actual", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 950, // User measured 950 mL
                setMl: 1000,
                currentCalibBoard1: 10,
                currentKFactor: 450,
                currentFlowrate: 10,
                reportedVolume: 1100, // Sensor over-reported
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, true);
            expect(result.success).toBe(true);
            // K-Factor is pump coeff based on runtime, independent from sensor ratio
            // K_new = 950 / 100 * 100 = 950
            expect(result.board2.newKFactor).toBe(950);
            // Flowrate sensor coeff increases when sensor over-reports
            // F_new = 10 * (1100/950) * 100 ≈ 1158
            expect(result.board2.newFlowrate).toBe(1158);
        });
        it("should handle case where sensor reported less than actual", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 1050, // User measured 1050 mL
                setMl: 1000,
                currentCalibBoard1: 10,
                currentKFactor: 450,
                currentFlowrate: 10,
                reportedVolume: 1000, // Sensor under-reported
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, true);
            expect(result.success).toBe(true);
            // K-Factor (pump coeff): K_new = 1050 / 100 * 100 = 1050
            expect(result.board2.newKFactor).toBe(1050);
            // Flowrate sensor coeff decreases when sensor under-reports
            // F_new = 10 * (1000/1050) * 100 ≈ 952
            expect(result.board2.newFlowrate).toBe(952);
        });
        it("should keep K-Factor unchanged when reported equals actual", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 1000, // User measured 1000 mL
                setMl: 1000,
                currentCalibBoard1: 10,
                currentKFactor: 450,
                currentFlowrate: 10,
                reportedVolume: 1000, // Sensor reported correctly
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, true);
            expect(result.success).toBe(true);
            // K-Factor (pump coeff): K_new = 1000 / 100 * 100 = 1000
            expect(result.board2.newKFactor).toBe(1000);
            // Flowrate sensor coeff unchanged ratio 1.0 => 10 * 100 = 1000
            expect(result.board2.newFlowrate).toBe(1000);
        });
        it("should handle multiple pumps", () => {
            const input1 = {
                pumpIndex: 1,
                actualMl: 900,
                setMl: 1000,
                currentCalibBoard1: 10,
                currentKFactor: 450,
                currentFlowrate: 10,
                reportedVolume: 1000,
            };
            const input2 = {
                pumpIndex: 2,
                actualMl: 800,
                setMl: 1000,
                currentCalibBoard1: 12, // 12.00 ml/s
                currentKFactor: 500,
                currentFlowrate: 12,
                reportedVolume: 1000,
            };
            const result1 = service.calculate(input1, board1Registers, board2Registers, true, true);
            const result2 = service.calculate(input2, board1Registers, board2Registers, true, true);
            expect(result1.success).toBe(true);
            expect(result2.success).toBe(true);
            expect(result1.pumpIndex).toBe(1);
            expect(result2.pumpIndex).toBe(2);
            expect(result1.board1.address).toBe(17);
            expect(result2.board1.address).toBe(18);
        });
    });
});

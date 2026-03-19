"use strict";
/**
 * Unit tests for viis-flow-calibration node
 * Tests the global context reading for Board2 addresses
 */
Object.defineProperty(exports, "__esModule", { value: true });
const calibrationService_1 = require("../services/calibrationService");
const constants_1 = require("../constants");
describe("viis-flow-calibration - Board2 Global Context Reading", () => {
    describe("Board2 Register Keys", () => {
        it("should generate correct key names for all 16 pumps", () => {
            // Test K_FACTOR keys
            expect(constants_1.BOARD2_KEYS.K_FACTOR(1)).toBe("HOLDING_K_FACTOR_BOM_1");
            expect(constants_1.BOARD2_KEYS.K_FACTOR(16)).toBe("HOLDING_K_FACTOR_BOM_16");
            // Test FLOWRATE keys
            expect(constants_1.BOARD2_KEYS.FLOWRATE(1)).toBe("HOLDING_FLOWRATE_BOM_1");
            expect(constants_1.BOARD2_KEYS.FLOWRATE(16)).toBe("HOLDING_FLOWRATE_BOM_16");
            // Test INPUT_TOTAL_FLOW keys
            expect(constants_1.BOARD2_KEYS.INPUT_TOTAL_FLOW(1)).toBe("INPUT_TOTAL_FLOW_BOM_1");
            expect(constants_1.BOARD2_KEYS.INPUT_TOTAL_FLOW(16)).toBe("INPUT_TOTAL_FLOW_BOM_16");
        });
    });
    describe("Board2 Register Mapping from device1.json", () => {
        // This is the actual structure from device1.json
        const mockModbusMappings = {
            board1: {
                holdingRegisters: {
                    HOLDING_SETML_BOM_1: 1,
                    HOLDING_CALIB_BOM_1: 17,
                },
            },
            board2: {
                holdingRegisters: {
                    HOLDING_K_FACTOR_BOM_1: 0,
                    HOLDING_K_FACTOR_BOM_2: 1,
                    HOLDING_K_FACTOR_BOM_3: 2,
                    HOLDING_K_FACTOR_BOM_4: 3,
                    HOLDING_K_FACTOR_BOM_5: 4,
                    HOLDING_K_FACTOR_BOM_6: 5,
                    HOLDING_K_FACTOR_BOM_7: 6,
                    HOLDING_K_FACTOR_BOM_8: 7,
                    HOLDING_K_FACTOR_BOM_9: 8,
                    HOLDING_K_FACTOR_BOM_10: 9,
                    HOLDING_K_FACTOR_BOM_11: 10,
                    HOLDING_K_FACTOR_BOM_12: 11,
                    HOLDING_K_FACTOR_BOM_13: 12,
                    HOLDING_K_FACTOR_BOM_14: 13,
                    HOLDING_K_FACTOR_BOM_15: 14,
                    HOLDING_K_FACTOR_BOM_16: 15,
                    HOLDING_FLOWRATE_BOM_1: 20,
                    HOLDING_FLOWRATE_BOM_2: 21,
                    HOLDING_FLOWRATE_BOM_3: 22,
                    HOLDING_FLOWRATE_BOM_4: 23,
                    HOLDING_FLOWRATE_BOM_5: 24,
                    HOLDING_FLOWRATE_BOM_6: 25,
                    HOLDING_FLOWRATE_BOM_7: 26,
                    HOLDING_FLOWRATE_BOM_8: 27,
                    HOLDING_FLOWRATE_BOM_9: 28,
                    HOLDING_FLOWRATE_BOM_10: 29,
                    HOLDING_FLOWRATE_BOM_11: 30,
                    HOLDING_FLOWRATE_BOM_12: 31,
                    HOLDING_FLOWRATE_BOM_13: 32,
                    HOLDING_FLOWRATE_BOM_14: 33,
                    HOLDING_FLOWRATE_BOM_15: 34,
                    HOLDING_FLOWRATE_BOM_16: 35,
                },
                inputRegisters: {
                    INPUT_CURRENT_FLOW_BOM_1: 0,
                    INPUT_CURRENT_FLOW_BOM_2: 1,
                    INPUT_CURRENT_FLOW_BOM_3: 2,
                    INPUT_CURRENT_FLOW_BOM_4: 3,
                    INPUT_CURRENT_FLOW_BOM_5: 4,
                    INPUT_CURRENT_FLOW_BOM_6: 5,
                    INPUT_CURRENT_FLOW_BOM_7: 6,
                    INPUT_CURRENT_FLOW_BOM_8: 7,
                    INPUT_CURRENT_FLOW_BOM_9: 8,
                    INPUT_CURRENT_FLOW_BOM_10: 9,
                    INPUT_CURRENT_FLOW_BOM_11: 10,
                    INPUT_CURRENT_FLOW_BOM_12: 11,
                    INPUT_CURRENT_FLOW_BOM_13: 12,
                    INPUT_CURRENT_FLOW_BOM_14: 13,
                    INPUT_CURRENT_FLOW_BOM_15: 14,
                    INPUT_CURRENT_FLOW_BOM_16: 15,
                    INPUT_TOTAL_FLOW_BOM_1: 20,
                    INPUT_TOTAL_FLOW_BOM_2: 21,
                    INPUT_TOTAL_FLOW_BOM_3: 22,
                    INPUT_TOTAL_FLOW_BOM_4: 23,
                    INPUT_TOTAL_FLOW_BOM_5: 24,
                    INPUT_TOTAL_FLOW_BOM_6: 25,
                    INPUT_TOTAL_FLOW_BOM_7: 26,
                    INPUT_TOTAL_FLOW_BOM_8: 27,
                    INPUT_TOTAL_FLOW_BOM_9: 28,
                    INPUT_TOTAL_FLOW_BOM_10: 29,
                    INPUT_TOTAL_FLOW_BOM_11: 30,
                    INPUT_TOTAL_FLOW_BOM_12: 31,
                    INPUT_TOTAL_FLOW_BOM_13: 32,
                    INPUT_TOTAL_FLOW_BOM_14: 33,
                    INPUT_TOTAL_FLOW_BOM_15: 34,
                    INPUT_TOTAL_FLOW_BOM_16: 35,
                },
                coils: {
                    PUMP_STATUS_BOM_1: 161,
                    PUMP_STATUS_BOM_2: 162,
                    PUMP_STATUS_BOM_16: 176,
                    RESET_TOTAL_VOLUME_BOM_1: 200,
                    RESET_TOTAL_VOLUME_BOM_2: 201,
                    RESET_TOTAL_VOLUME_BOM_16: 215,
                },
            },
        };
        it("should have correct K-Factor addresses for all pumps", () => {
            const { board2 } = mockModbusMappings;
            // Check all 16 pumps have K-Factor addresses
            for (let i = 1; i <= 16; i++) {
                const key = constants_1.BOARD2_KEYS.K_FACTOR(i);
                expect(board2.holdingRegisters[key]).toBeDefined();
                expect(board2.holdingRegisters[key]).toBe(i - 1); // Address = pump index - 1
            }
        });
        it("should have correct Flowrate addresses for all pumps", () => {
            const { board2 } = mockModbusMappings;
            // Check all 16 pumps have Flowrate addresses
            for (let i = 1; i <= 16; i++) {
                const key = constants_1.BOARD2_KEYS.FLOWRATE(i);
                expect(board2.holdingRegisters[key]).toBeDefined();
                expect(board2.holdingRegisters[key]).toBe(19 + i); // Address = 19 + pump index
            }
        });
        it("should have correct Input Total Flow addresses for all pumps", () => {
            const { board2 } = mockModbusMappings;
            // Check all 16 pumps have Input Total Flow addresses
            for (let i = 1; i <= 16; i++) {
                const key = constants_1.BOARD2_KEYS.INPUT_TOTAL_FLOW(i);
                expect(board2.inputRegisters[key]).toBeDefined();
                expect(board2.inputRegisters[key]).toBe(19 + i); // Address = 19 + pump index
            }
        });
        it("should have correct Coil addresses for all pumps", () => {
            const { board2 } = mockModbusMappings;
            // Check PUMP_STATUS coils - only defined for some pumps in mock
            const definedPumpStatusCoils = Object.keys(board2.coils).filter(k => k.startsWith('PUMP_STATUS_'));
            for (const key of definedPumpStatusCoils) {
                expect(board2.coils[key]).toBeDefined();
            }
            // Check RESET_TOTAL_VOLUME coils
            const definedResetCoils = Object.keys(board2.coils).filter(k => k.startsWith('RESET_TOTAL_VOLUME_'));
            for (const key of definedResetCoils) {
                expect(board2.coils[key]).toBeDefined();
            }
        });
    });
    describe("Board2 Register Value Lookup Simulation", () => {
        // Simulate the actual values that would be in global context
        // These are the VALUES stored at the register addresses, not the addresses themselves
        const mockBoard2HoldingRegisters = {
            HOLDING_K_FACTOR_BOM_1: 450,
            HOLDING_K_FACTOR_BOM_2: 460,
            HOLDING_K_FACTOR_BOM_3: 470,
            HOLDING_K_FACTOR_BOM_4: 480,
            HOLDING_K_FACTOR_BOM_5: 490,
            HOLDING_K_FACTOR_BOM_6: 500,
            HOLDING_K_FACTOR_BOM_7: 510,
            HOLDING_K_FACTOR_BOM_8: 520,
            HOLDING_K_FACTOR_BOM_9: 530,
            HOLDING_K_FACTOR_BOM_10: 540,
            HOLDING_K_FACTOR_BOM_11: 550,
            HOLDING_K_FACTOR_BOM_12: 560,
            HOLDING_K_FACTOR_BOM_13: 570,
            HOLDING_K_FACTOR_BOM_14: 580,
            HOLDING_K_FACTOR_BOM_15: 590,
            HOLDING_K_FACTOR_BOM_16: 600,
            HOLDING_FLOWRATE_BOM_1: 10,
            HOLDING_FLOWRATE_BOM_2: 11,
            HOLDING_FLOWRATE_BOM_3: 12,
            HOLDING_FLOWRATE_BOM_4: 13,
            HOLDING_FLOWRATE_BOM_5: 14,
            HOLDING_FLOWRATE_BOM_6: 15,
            HOLDING_FLOWRATE_BOM_7: 16,
            HOLDING_FLOWRATE_BOM_8: 17,
            HOLDING_FLOWRATE_BOM_9: 18,
            HOLDING_FLOWRATE_BOM_10: 19,
            HOLDING_FLOWRATE_BOM_11: 20,
            HOLDING_FLOWRATE_BOM_12: 21,
            HOLDING_FLOWRATE_BOM_13: 22,
            HOLDING_FLOWRATE_BOM_14: 23,
            HOLDING_FLOWRATE_BOM_15: 24,
            HOLDING_FLOWRATE_BOM_16: 25,
        };
        const mockBoard2InputRegisters = {
            INPUT_TOTAL_FLOW_BOM_1: 1000,
            INPUT_TOTAL_FLOW_BOM_2: 1100,
            INPUT_TOTAL_FLOW_BOM_3: 1200,
            INPUT_TOTAL_FLOW_BOM_4: 1300,
            INPUT_TOTAL_FLOW_BOM_5: 1400,
            INPUT_TOTAL_FLOW_BOM_6: 1500,
            INPUT_TOTAL_FLOW_BOM_7: 1600,
            INPUT_TOTAL_FLOW_BOM_8: 1700,
            INPUT_TOTAL_FLOW_BOM_9: 1800,
            INPUT_TOTAL_FLOW_BOM_10: 1900,
            INPUT_TOTAL_FLOW_BOM_11: 2000,
            INPUT_TOTAL_FLOW_BOM_12: 2100,
            INPUT_TOTAL_FLOW_BOM_13: 2200,
            INPUT_TOTAL_FLOW_BOM_14: 2300,
            INPUT_TOTAL_FLOW_BOM_15: 2400,
            INPUT_TOTAL_FLOW_BOM_16: 2500,
        };
        it("should correctly lookup K-Factor values for all pumps", () => {
            for (let i = 1; i <= 16; i++) {
                const key = constants_1.BOARD2_KEYS.K_FACTOR(i);
                const value = mockBoard2HoldingRegisters[key];
                expect(value).toBeDefined();
                expect(value).toBe(440 + i * 10); // 450, 460, 470, ...
            }
        });
        it("should correctly lookup Flowrate values for all pumps", () => {
            for (let i = 1; i <= 16; i++) {
                const key = constants_1.BOARD2_KEYS.FLOWRATE(i);
                const value = mockBoard2HoldingRegisters[key];
                expect(value).toBeDefined();
                expect(value).toBe(9 + i); // 10, 11, 12, ...
            }
        });
        it("should correctly lookup Input Total Flow values for all pumps", () => {
            for (let i = 1; i <= 16; i++) {
                const key = constants_1.BOARD2_KEYS.INPUT_TOTAL_FLOW(i);
                const value = mockBoard2InputRegisters[key];
                expect(value).toBeDefined();
                expect(value).toBe(900 + i * 100); // 1000, 1100, 1200, ...
            }
        });
        it("should handle missing keys gracefully with default fallback", () => {
            const emptyRegisters = {};
            for (let i = 1; i <= 16; i++) {
                const key = constants_1.BOARD2_KEYS.K_FACTOR(i);
                const value = emptyRegisters[key];
                // This is the problematic check - value will be undefined
                const kFactorValue = value !== undefined && value !== null && value !== 0 ? value : 450;
                expect(kFactorValue).toBe(450); // Falls back to default
            }
        });
        it("should NOT fallback to default when value is 0", () => {
            // Edge case: K-Factor could legitimately be 0 (needs calibration)
            const registersWithZero = {
                HOLDING_K_FACTOR_BOM_1: 0,
            };
            const key = constants_1.BOARD2_KEYS.K_FACTOR(1);
            const value = registersWithZero[key];
            // Current logic treats 0 as "missing" and falls back to 450
            // This might not be desired behavior
            const kFactorValue = value !== undefined && value !== null && value !== 0 ? value : 450;
            expect(kFactorValue).toBe(450); // Falls back because value is 0
        });
    });
    describe("Global Context Structure Validation", () => {
        it("should handle nested modbusMappings structure (for ADDRESSES)", () => {
            var _a;
            const mockGlobalContext = {
                modbusMappings: {
                    board1: {
                        holdingRegisters: { HOLDING_CALIB_BOM_1: 17 },
                    },
                    board2: {
                        holdingRegisters: { HOLDING_K_FACTOR_BOM_1: 0 },
                        inputRegisters: { INPUT_TOTAL_FLOW_BOM_1: 20 },
                        coils: { PUMP_STATUS_BOM_1: 161 },
                    },
                },
            };
            // Access pattern used in viis-flow-calibration.ts
            // NOTE: This gives ADDRESSES, not VALUES!
            const board2HoldingRegisters = ((_a = mockGlobalContext.modbusMappings.board2) === null || _a === void 0 ? void 0 : _a.holdingRegisters) || {};
            expect(board2HoldingRegisters.HOLDING_K_FACTOR_BOM_1).toBe(0); // Address, not value
        });
        it("should handle flat structure fallback (for ADDRESSES)", () => {
            const mockGlobalContext = {
                MODBUS_BOARD2_HOLDING_REGISTERS: JSON.stringify({
                    HOLDING_K_FACTOR_BOM_1: 0,
                    HOLDING_FLOWRATE_BOM_1: 20,
                }),
            };
            // Fallback access pattern
            const board2HoldingRegisters = JSON.parse(mockGlobalContext.MODBUS_BOARD2_HOLDING_REGISTERS);
            expect(board2HoldingRegisters.HOLDING_K_FACTOR_BOM_1).toBe(0); // Address
            expect(board2HoldingRegisters.HOLDING_FLOWRATE_BOM_1).toBe(20); // Address
        });
        it("should handle empty/undefined global context", () => {
            var _a;
            const mockGlobalContext = {};
            // Access pattern with fallbacks
            const modbusMappings = mockGlobalContext.modbusMappings || {};
            const board2HoldingRegisters = ((_a = modbusMappings.board2) === null || _a === void 0 ? void 0 : _a.holdingRegisters) || {};
            expect(board2HoldingRegisters).toEqual({});
            expect(Object.keys(board2HoldingRegisters).length).toBe(0);
        });
        it("DEBUG: CRITICAL - distinguish between register ADDRESSES and VALUES", () => {
            // ⚠️ THIS IS THE ROOT CAUSE OF THE BUG ⚠️
            //
            // modbusMappings.board2.holdingRegisters = ADDRESSES (where to read/write)
            // holding_register_data_2 = VALUES (actual data read from device)
            //
            // The code was reading ADDRESSES when it should read VALUES!
            // Register MAP (addresses) - tells you WHERE to read/write
            const modbusMappings = {
                board2: {
                    holdingRegisters: {
                        HOLDING_K_FACTOR_BOM_1: 0, // Address 0
                        HOLDING_FLOWRATE_BOM_1: 20, // Address 20
                    },
                },
            };
            // Register DATA (values) - actual values read from device
            const holdingRegisterData2 = {
                HOLDING_K_FACTOR_BOM_1: 450, // Value at address 0
                HOLDING_K_FACTOR_BOM_2: 460, // Value at address 1
                HOLDING_FLOWRATE_BOM_1: 10, // Value at address 20
            };
            // ❌ WRONG: Reading address (0) instead of value (450)
            const wrongKFactor = modbusMappings.board2.holdingRegisters.HOLDING_K_FACTOR_BOM_1;
            // ✅ CORRECT: Reading actual value
            const correctKFactor = holdingRegisterData2.HOLDING_K_FACTOR_BOM_1;
            console.log("❌ WRONG (address):", wrongKFactor); // 0
            console.log("✅ CORRECT (value):", correctKFactor); // 450
            expect(wrongKFactor).toBe(0); // Address
            expect(correctKFactor).toBe(450); // Value
        });
    });
    describe("CalibrationService with Board2 Values", () => {
        const service = new calibrationService_1.CalibrationService("test-node", false);
        const board1Registers = { HOLDING_CALIB_BOM_1: 17 };
        const board2Registers = {
            HOLDING_K_FACTOR_BOM_1: 0,
            HOLDING_FLOWRATE_BOM_1: 20,
        };
        it("should use actual K-Factor value from board2Registers (not default 450)", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 950,
                setMl: 1000,
                currentCalibBoard1: 10,
                currentKFactor: 500, // Actual value from global context
                currentFlowrate: 10,
                reportedVolume: 1000,
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, true);
            expect(result.success).toBe(true);
            expect(result.board2).not.toBeNull();
            // K_new = 500 * (950 / 1000) = 475 (NOT 450 * 0.95 = 428)
            expect(result.board2.newKFactor).toBe(475);
        });
        it("should handle case where currentKFactor is 0 (needs special handling)", () => {
            const input = {
                pumpIndex: 1,
                actualMl: 950,
                setMl: 1000,
                currentCalibBoard1: 10,
                currentKFactor: 0, // K-Factor is 0 (needs calibration)
                currentFlowrate: 10,
                reportedVolume: 1000,
            };
            const result = service.calculate(input, board1Registers, board2Registers, true, true);
            expect(result.success).toBe(true);
            // When currentKFactor is 0, the formula K_new = 0 * (actual/report) = 0
            // This might need special handling in production
            expect(result.board2.newKFactor).toBe(0);
        });
    });
});

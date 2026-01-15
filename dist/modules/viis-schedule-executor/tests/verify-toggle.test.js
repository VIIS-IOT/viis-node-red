"use strict";
/**
 * Unit tests for verifyAfterWrite toggle feature
 * Tests the ability to enable/disable write verification for schedules
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
// Mock Node-RED node
const mockNode = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    context: jest.fn(() => ({
        global: {
            get: jest.fn((key) => {
                if (key === 'scaleConfigs')
                    return [];
                if (key === 'activeModbusCommands')
                    return {};
                if (key === 'manualModbusOverrides')
                    return {};
                return null;
            }),
            set: jest.fn()
        },
        flow: {
            get: jest.fn(),
            set: jest.fn()
        }
    }))
};
// Mock Modbus client
const mockModbusClient = {
    readCoils: jest.fn(),
    readHoldingRegisters: jest.fn(),
    writeCoil: jest.fn(),
    writeRegister: jest.fn()
};
describe('ScheduleService - Verify After Write Toggle', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    describe('Constructor and Initialization', () => {
        test('should default verifyAfterWrite to true when not specified', () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode);
            expect(service.verifyAfterWrite).toBe(true);
        });
        test('should accept verifyAfterWrite = true', () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true);
            expect(service.verifyAfterWrite).toBe(true);
        });
        test('should accept verifyAfterWrite = false', () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, false);
            expect(service.verifyAfterWrite).toBe(false);
        });
    });
    describe('verifyModbusWrite - When Verification Enabled', () => {
        let service;
        beforeEach(() => {
            service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true); // Enable verification
        });
        test('should verify coil write and return true when values match', async () => {
            const commands = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            mockModbusClient.readCoils.mockResolvedValue({
                data: [true]
            });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledWith(10, 1);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('✅ VERIFICATION SUCCESS'));
        });
        test('should verify holding register write and return true when values match', async () => {
            const commands = [
                { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 }
            ];
            mockModbusClient.readHoldingRegisters.mockResolvedValue({
                data: [100]
            });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readHoldingRegisters).toHaveBeenCalledWith(20, 1);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('✅ VERIFICATION SUCCESS'));
        });
        test('should return false when coil verification fails (value mismatch)', async () => {
            const commands = [
                { key: 'valve', value: true, fc: 5, unitid: 1, address: 15, quantity: 1 }
            ];
            mockModbusClient.readCoils.mockResolvedValue({
                data: [false] // Different from expected value
            });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(false);
            expect(mockModbusClient.readCoils).toHaveBeenCalledWith(15, 1);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('❌ VERIFICATION FAILED'));
        });
        test('should return false when holding register verification fails (value mismatch)', async () => {
            const commands = [
                { key: 'flow_rate', value: 250, fc: 6, unitid: 1, address: 25, quantity: 1 }
            ];
            mockModbusClient.readHoldingRegisters.mockResolvedValue({
                data: [200] // Different from expected value
            });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(false);
            expect(mockModbusClient.readHoldingRegisters).toHaveBeenCalledWith(25, 1);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('❌ VERIFICATION FAILED'));
        });
        test('should verify multiple commands correctly', async () => {
            const commands = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 },
                { key: 'valve', value: false, fc: 5, unitid: 1, address: 11, quantity: 1 }
            ];
            mockModbusClient.readCoils
                .mockResolvedValueOnce({ data: [true] })
                .mockResolvedValueOnce({ data: [false] });
            mockModbusClient.readHoldingRegisters
                .mockResolvedValueOnce({ data: [100] });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledTimes(2);
            expect(mockModbusClient.readHoldingRegisters).toHaveBeenCalledTimes(1);
        });
        test('should return false if any command verification fails', async () => {
            const commands = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 }
            ];
            mockModbusClient.readCoils.mockResolvedValue({ data: [true] });
            mockModbusClient.readHoldingRegisters.mockResolvedValue({ data: [99] }); // Mismatch
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(false);
        });
        test('should return false on read error during verification', async () => {
            const commands = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            mockModbusClient.readCoils.mockRejectedValue(new Error('Connection timeout'));
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('❌ VERIFICATION ERROR'));
        });
    });
    describe('verifyModbusWrite - When Verification Disabled', () => {
        let service;
        beforeEach(() => {
            service = new viis_schedule_executor_service_1.ScheduleService(mockNode, false); // Disable verification
        });
        test('should still verify coils even when verification disabled', async () => {
            const commands = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            mockModbusClient.readCoils.mockResolvedValue({
                data: [true]
            });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledWith(10, 1); // Coils ARE verified
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('🔍 VERIFYING COILS'));
        });
        test('should verify coils but skip holding registers', async () => {
            const commands = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'pump2', value: false, fc: 5, unitid: 1, address: 11, quantity: 1 },
                { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 }
            ];
            mockModbusClient.readCoils
                .mockResolvedValueOnce({ data: [true] })
                .mockResolvedValueOnce({ data: [false] });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledTimes(2); // Coils ARE verified
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled(); // Holding registers skipped
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('HOLDING REGISTER VERIFICATION SKIPPED: 1 commands'));
        });
        test('should skip holding register verification even if actual values would differ', async () => {
            // This tests the scenario where write/read values differ normally
            const commands = [
                { key: 'special_register', value: 1000, fc: 6, unitid: 1, address: 50, quantity: 1 }
            ];
            // Even though Modbus would return a different value, we don't check it
            mockModbusClient.readHoldingRegisters.mockResolvedValue({
                data: [999] // Different value, but we don't care when verification is disabled
            });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled(); // Holding registers not verified
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('HOLDING REGISTER VERIFICATION SKIPPED'));
        });
        test('should return true for empty command array', async () => {
            const commands = [];
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).not.toHaveBeenCalled();
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
        });
        test('should fail if coil verification fails (even with verification disabled)', async () => {
            const commands = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            mockModbusClient.readCoils.mockResolvedValue({
                data: [false] // Mismatch!
            });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(false);
            expect(mockModbusClient.readCoils).toHaveBeenCalled(); // Coils are still verified
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('❌ VERIFICATION FAILED'));
        });
    });
    describe('Edge Cases and Boundary Conditions', () => {
        test('should handle verification enabled with empty command array', async () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true);
            const commands = [];
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).not.toHaveBeenCalled();
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
        });
        test('should handle verification disabled with empty command array', async () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, false);
            const commands = [];
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
        });
        test('should handle unknown function codes gracefully when verification enabled', async () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true);
            const commands = [
                { key: 'unknown', value: 123, fc: 99, unitid: 1, address: 30, quantity: 1 } // Unknown FC
            ];
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true); // Should skip unknown FC and return true
            expect(mockModbusClient.readCoils).not.toHaveBeenCalled();
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
        });
        test('should handle mixed valid and unknown function codes when verification enabled', async () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true);
            const commands = [
                { key: 'pump', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'unknown', value: 123, fc: 99, unitid: 1, address: 30, quantity: 1 }
            ];
            mockModbusClient.readCoils.mockResolvedValue({ data: [true] });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledTimes(1);
        });
    });
    describe('Integration Scenario Tests', () => {
        test('should work correctly in write-read mismatch scenario for holding registers (verification disabled)', async () => {
            // Scenario: Some PLCs scale values differently on read than write
            // Example: Writing 1000 but reading back 100 (scaled by 10)
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, false);
            const commands = [
                { key: 'scaled_value', value: 1000, fc: 6, unitid: 1, address: 40, quantity: 1 }
            ];
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled(); // Holding registers skipped
        });
        test('should fail correctly in write-read mismatch scenario for holding registers (verification enabled)', async () => {
            // Same scenario but with verification enabled - should fail
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true);
            const commands = [
                { key: 'scaled_value', value: 1000, fc: 6, unitid: 1, address: 40, quantity: 1 }
            ];
            mockModbusClient.readHoldingRegisters.mockResolvedValue({
                data: [100] // PLC returns scaled value
            });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(false);
            expect(mockModbusClient.readHoldingRegisters).toHaveBeenCalled();
        });
        test('should always verify coils even with mixed commands and verification disabled', async () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, false);
            const commands = [
                { key: 'pump', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }, // Coil - will be verified
                { key: 'scaled_value', value: 1000, fc: 6, unitid: 1, address: 40, quantity: 1 } // Holding - skipped
            ];
            mockModbusClient.readCoils.mockResolvedValue({ data: [true] });
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalled(); // Coil verified
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled(); // Holding skipped
        });
        test('should handle transient read errors for coils when verification enabled', async () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true);
            const commands = [
                { key: 'pump', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            mockModbusClient.readCoils.mockRejectedValue(new Error('Modbus exception: Illegal data address'));
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('❌ VERIFICATION ERROR'));
        });
        test('should handle transient read errors for coils even when verification disabled', async () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, false);
            const commands = [
                { key: 'pump', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            mockModbusClient.readCoils.mockRejectedValue(new Error('Modbus exception: Illegal data address'));
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            expect(result).toBe(false); // Should still fail because coils are always verified
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('❌ VERIFICATION ERROR'));
        });
    });
    describe('Performance and Behavior Tests', () => {
        test('verification disabled should skip holding registers but still verify coils', async () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, false);
            const commands = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'pump2', value: true, fc: 5, unitid: 1, address: 11, quantity: 1 },
                { key: 'setpoint1', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 },
                { key: 'setpoint2', value: 200, fc: 6, unitid: 1, address: 21, quantity: 1 },
                { key: 'setpoint3', value: 300, fc: 6, unitid: 1, address: 22, quantity: 1 }
            ];
            mockModbusClient.readCoils
                .mockResolvedValueOnce({ data: [true] })
                .mockResolvedValueOnce({ data: [true] });
            const startTime = Date.now();
            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            const duration = Date.now() - startTime;
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledTimes(2); // Coils verified
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled(); // Holdings skipped
            expect(duration).toBeLessThan(100); // Should be fast (only 2 coil reads)
        });
        test('should log appropriate message count when holding register verification skipped', async () => {
            const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, false);
            const holdingCommands = Array.from({ length: 10 }, (_, i) => ({
                key: `setpoint${i}`,
                value: i * 100,
                fc: 6,
                unitid: 1,
                address: 20 + i,
                quantity: 1
            }));
            const coilCommands = Array.from({ length: 3 }, (_, i) => ({
                key: `pump${i}`,
                value: true,
                fc: 5,
                unitid: 1,
                address: 10 + i,
                quantity: 1
            }));
            mockModbusClient.readCoils
                .mockResolvedValue({ data: [true] });
            await service.verifyModbusWrite(mockModbusClient, [...coilCommands, ...holdingCommands]);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('HOLDING REGISTER VERIFICATION SKIPPED: 10 commands'));
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('🔍 VERIFYING COILS: 3 commands'));
        });
    });
});

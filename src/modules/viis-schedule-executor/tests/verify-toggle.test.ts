/**
 * Unit tests for verifyAfterWrite toggle feature
 * Tests the ability to enable/disable write verification for schedules
 */

import { ScheduleService } from '../viis-schedule-executor-service';
import { ModbusClientCore } from '../../../core/modbus-client';
import { ModbusCmd } from '../type';

// Mock Node-RED node
const mockNode: any = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    context: jest.fn(() => ({
        global: {
            get: jest.fn((key: string) => {
                if (key === 'scaleConfigs') return [];
                if (key === 'activeModbusCommands') return {};
                if (key === 'manualModbusOverrides') return {};
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
const mockModbusClient: Partial<ModbusClientCore> = {
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
            const service = new ScheduleService(mockNode);
            expect((service as any).verifyAfterWrite).toBe(true);
        });

        test('should accept verifyAfterWrite = true', () => {
            const service = new ScheduleService(mockNode, true);
            expect((service as any).verifyAfterWrite).toBe(true);
        });

        test('should accept verifyAfterWrite = false', () => {
            const service = new ScheduleService(mockNode, false);
            expect((service as any).verifyAfterWrite).toBe(false);
        });
    });

    describe('verifyModbusWrite - When Verification Enabled', () => {
        let service: ScheduleService;

        beforeEach(() => {
            service = new ScheduleService(mockNode, true); // Enable verification
        });

        test('should verify coil write and return true when values match', async () => {
            const commands: ModbusCmd[] = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            (mockModbusClient.readCoils as jest.Mock).mockResolvedValue({
                data: [true]
            });

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledWith(10, 1);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('✅ VERIFICATION SUCCESS')
            );
        });

        test('should verify holding register write and return true when values match', async () => {
            const commands: ModbusCmd[] = [
                { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 }
            ];

            (mockModbusClient.readHoldingRegisters as jest.Mock).mockResolvedValue({
                data: [100]
            });

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readHoldingRegisters).toHaveBeenCalledWith(20, 1);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('✅ VERIFICATION SUCCESS')
            );
        });

        test('should return false when coil verification fails (value mismatch)', async () => {
            const commands: ModbusCmd[] = [
                { key: 'valve', value: true, fc: 5, unitid: 1, address: 15, quantity: 1 }
            ];

            (mockModbusClient.readCoils as jest.Mock).mockResolvedValue({
                data: [false] // Different from expected value
            });

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(false);
            expect(mockModbusClient.readCoils).toHaveBeenCalledWith(15, 1);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('❌ VERIFICATION FAILED')
            );
        });

        test('should return false when holding register verification fails (value mismatch)', async () => {
            const commands: ModbusCmd[] = [
                { key: 'flow_rate', value: 250, fc: 6, unitid: 1, address: 25, quantity: 1 }
            ];

            (mockModbusClient.readHoldingRegisters as jest.Mock).mockResolvedValue({
                data: [200] // Different from expected value
            });

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(false);
            expect(mockModbusClient.readHoldingRegisters).toHaveBeenCalledWith(25, 1);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('❌ VERIFICATION FAILED')
            );
        });

        test('should verify multiple commands correctly', async () => {
            const commands: ModbusCmd[] = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 },
                { key: 'valve', value: false, fc: 5, unitid: 1, address: 11, quantity: 1 }
            ];

            (mockModbusClient.readCoils as jest.Mock)
                .mockResolvedValueOnce({ data: [true] })
                .mockResolvedValueOnce({ data: [false] });

            (mockModbusClient.readHoldingRegisters as jest.Mock)
                .mockResolvedValueOnce({ data: [100] });

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledTimes(2);
            expect(mockModbusClient.readHoldingRegisters).toHaveBeenCalledTimes(1);
        });

        test('should return false if any command verification fails', async () => {
            const commands: ModbusCmd[] = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 }
            ];

            (mockModbusClient.readCoils as jest.Mock).mockResolvedValue({ data: [true] });
            (mockModbusClient.readHoldingRegisters as jest.Mock).mockResolvedValue({ data: [99] }); // Mismatch

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(false);
        });

        test('should return false on read error during verification', async () => {
            const commands: ModbusCmd[] = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            (mockModbusClient.readCoils as jest.Mock).mockRejectedValue(new Error('Connection timeout'));

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('❌ VERIFICATION ERROR')
            );
        });
    });

    describe('verifyModbusWrite - When Verification Disabled', () => {
        let service: ScheduleService;

        beforeEach(() => {
            service = new ScheduleService(mockNode, false); // Disable verification
        });

        test('should return true immediately without reading when verification disabled', async () => {
            const commands: ModbusCmd[] = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).not.toHaveBeenCalled();
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('⏭️  VERIFICATION SKIPPED')
            );
        });

        test('should skip verification for multiple commands', async () => {
            const commands: ModbusCmd[] = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'pump2', value: false, fc: 5, unitid: 1, address: 11, quantity: 1 },
                { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 }
            ];

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).not.toHaveBeenCalled();
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('VERIFICATION SKIPPED: 3 commands')
            );
        });

        test('should return true even if actual values would differ', async () => {
            // This tests the scenario where write/read values differ normally
            const commands: ModbusCmd[] = [
                { key: 'special_register', value: 1000, fc: 6, unitid: 1, address: 50, quantity: 1 }
            ];

            // Even though Modbus would return a different value, we don't check it
            (mockModbusClient.readHoldingRegisters as jest.Mock).mockResolvedValue({
                data: [999] // Different value, but we don't care when verification is disabled
            });

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
        });

        test('should skip verification for empty command array', async () => {
            const commands: ModbusCmd[] = [];

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).not.toHaveBeenCalled();
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
        });
    });

    describe('Edge Cases and Boundary Conditions', () => {
        test('should handle verification enabled with empty command array', async () => {
            const service = new ScheduleService(mockNode, true);
            const commands: ModbusCmd[] = [];

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).not.toHaveBeenCalled();
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
        });

        test('should handle verification disabled with empty command array', async () => {
            const service = new ScheduleService(mockNode, false);
            const commands: ModbusCmd[] = [];

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
        });

        test('should handle unknown function codes gracefully when verification enabled', async () => {
            const service = new ScheduleService(mockNode, true);
            const commands: ModbusCmd[] = [
                { key: 'unknown', value: 123, fc: 99, unitid: 1, address: 30, quantity: 1 } // Unknown FC
            ];

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true); // Should skip unknown FC and return true
            expect(mockModbusClient.readCoils).not.toHaveBeenCalled();
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
        });

        test('should handle mixed valid and unknown function codes when verification enabled', async () => {
            const service = new ScheduleService(mockNode, true);
            const commands: ModbusCmd[] = [
                { key: 'pump', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'unknown', value: 123, fc: 99, unitid: 1, address: 30, quantity: 1 }
            ];

            (mockModbusClient.readCoils as jest.Mock).mockResolvedValue({ data: [true] });

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledTimes(1);
        });
    });

    describe('Integration Scenario Tests', () => {
        test('should work correctly in write-read mismatch scenario (verification disabled)', async () => {
            // Scenario: Some PLCs scale values differently on read than write
            // Example: Writing 1000 but reading back 100 (scaled by 10)
            const service = new ScheduleService(mockNode, false);
            const commands: ModbusCmd[] = [
                { key: 'scaled_value', value: 1000, fc: 6, unitid: 1, address: 40, quantity: 1 }
            ];

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
        });

        test('should fail correctly in write-read mismatch scenario (verification enabled)', async () => {
            // Same scenario but with verification enabled - should fail
            const service = new ScheduleService(mockNode, true);
            const commands: ModbusCmd[] = [
                { key: 'scaled_value', value: 1000, fc: 6, unitid: 1, address: 40, quantity: 1 }
            ];

            (mockModbusClient.readHoldingRegisters as jest.Mock).mockResolvedValue({
                data: [100] // PLC returns scaled value
            });

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(false);
            expect(mockModbusClient.readHoldingRegisters).toHaveBeenCalled();
        });

        test('should handle transient read errors when verification enabled', async () => {
            const service = new ScheduleService(mockNode, true);
            const commands: ModbusCmd[] = [
                { key: 'pump', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            (mockModbusClient.readCoils as jest.Mock).mockRejectedValue(
                new Error('Modbus exception: Illegal data address')
            );

            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(result).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('❌ VERIFICATION ERROR')
            );
        });
    });

    describe('Performance and Behavior Tests', () => {
        test('verification disabled should be significantly faster (no read operations)', async () => {
            const service = new ScheduleService(mockNode, false);
            const commands: ModbusCmd[] = [
                { key: 'pump1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'pump2', value: true, fc: 5, unitid: 1, address: 11, quantity: 1 },
                { key: 'pump3', value: true, fc: 5, unitid: 1, address: 12, quantity: 1 }
            ];

            const startTime = Date.now();
            const result = await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);
            const duration = Date.now() - startTime;

            expect(result).toBe(true);
            expect(duration).toBeLessThan(10); // Should complete almost instantly
            expect(mockModbusClient.readCoils).not.toHaveBeenCalled();
        });

        test('should log appropriate message count when verification skipped', async () => {
            const service = new ScheduleService(mockNode, false);
            const commands: ModbusCmd[] = Array.from({ length: 10 }, (_, i) => ({
                key: `pump${i}`,
                value: true,
                fc: 5,
                unitid: 1,
                address: i,
                quantity: 1
            }));

            await service.verifyModbusWrite(mockModbusClient as ModbusClientCore, commands);

            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('VERIFICATION SKIPPED: 10 commands')
            );
        });
    });
});

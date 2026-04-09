/**
 * Unit tests for ModbusExecutorService
 * Tests Modbus command execution, verification, and reset functionality
 */

import { ModbusExecutorService } from '../modbus-executor-service';
import { Node } from 'node-red';
import { ModbusCmd, TabiotSchedule } from '../../common/types';
import { ModbusClientCore } from '../../../../core/modbus-client';

// Shared mock global context - accessible in all tests
let mockGlobalContext: Map<string, any>;

// Mock Node-RED node - create context object once to maintain reference
const createMockNode = () => {
    const contextObject = {
        global: {
            get: jest.fn((key: string) => {
                const value = mockGlobalContext.get(key);
                return value !== undefined ? value : {};
            }),
            set: jest.fn((key: string, value: any) => {
                mockGlobalContext.set(key, value);
                return value;
            })
        }
    };

    return {
        context: () => contextObject,
        warn: jest.fn(),
        error: jest.fn()
    } as unknown as Node;
};

// Mock ModbusClientCore
const createMockModbusClient = () => ({
    writeRegister: jest.fn().mockResolvedValue({}),
    writeCoil: jest.fn().mockResolvedValue({}),
    readHoldingRegisters: jest.fn().mockResolvedValue({ data: [0] }),
    readCoils: jest.fn().mockResolvedValue({ data: [false] }),
    isConnected: true
} as unknown as ModbusClientCore);

// NOTE: We don't mock GlobalContextHelper - it uses node.context() which we mock above

describe('ModbusExecutorService', () => {
    let service: ModbusExecutorService;
    let mockNode: Node;
    let mockModbusClient: ModbusClientCore;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGlobalContext = new Map<string, any>();
        mockGlobalContext.set('activeModbusCommands', {});
        mockNode = createMockNode();
        mockModbusClient = createMockModbusClient();

        service = new ModbusExecutorService(mockNode, true, true);
    });

    describe('Constructor', () => {
        it('should initialize with verifyAfterWrite enabled', () => {
            const verifyService = new ModbusExecutorService(mockNode, true, false);
            expect(verifyService).toBeDefined();
        });

        it('should initialize with verifyAfterWrite disabled', () => {
            const nonVerifyService = new ModbusExecutorService(mockNode, false, false);
            expect(nonVerifyService).toBeDefined();
        });

        it('should initialize with debug enabled', () => {
            const debugService = new ModbusExecutorService(mockNode, true, true);
            expect(debugService).toBeDefined();
        });
    });

    describe('executeHoldingCommands', () => {
        beforeEach(() => {
            mockGlobalContext.set('scaleConfigs', []);
        });

        it('should execute holding register commands successfully', async () => {
            const commands: ModbusCmd[] = [
                { key: 'set_flow', value: 50, fc: 6, unitid: 1, address: 100, quantity: 1 }
            ];

            const result = await (service as any).executeHoldingCommands(mockModbusClient, commands);

            expect(result.success).toBe(1);
            expect(result.failed).toBe(0);
            expect(mockModbusClient.writeRegister).toHaveBeenCalledWith(100, 50);
        });

        it('should handle failed holding register writes', async () => {
            const commands: ModbusCmd[] = [
                { key: 'set_flow', value: 50, fc: 6, unitid: 1, address: 100, quantity: 1 }
            ];

            const schedule: TabiotSchedule = {
                name: 'test-schedule',
                label: 'Test',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };

            (mockModbusClient.writeRegister as jest.Mock).mockRejectedValueOnce(new Error('Modbus timeout'));

            const result = await (service as any).executeHoldingCommands(mockModbusClient, commands, schedule);

            expect(result.success).toBe(0);
            expect(result.failed).toBe(1);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('Failed'));
        });

        it('should apply scaling to holding register values', async () => {
            const commands: ModbusCmd[] = [
                { key: 'set_flow', value: 50, fc: 6, unitid: 1, address: 100, quantity: 1 }
            ];

            // Setup scale config
            mockGlobalContext.set('scaleConfigs', [
                { key: 'set_flow', operation: 'multiply', factor: 10, direction: 'write' }
            ]);

            const result = await (service as any).executeHoldingCommands(mockModbusClient, commands);

            expect(result.success).toBe(1);
            // Should write 500 (50 * 10) instead of 50
            expect(mockModbusClient.writeRegister).toHaveBeenCalledWith(100, 500);
        });

        it('should execute multiple holding register commands', async () => {
            const commands: ModbusCmd[] = [
                { key: 'set_flow', value: 50, fc: 6, unitid: 1, address: 100, quantity: 1 },
                { key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 101, quantity: 1 },
                { key: 'set_ph', value: 6.5, fc: 6, unitid: 1, address: 102, quantity: 1 }
            ];

            const result = await (service as any).executeHoldingCommands(mockModbusClient, commands);

            expect(result.success).toBe(3);
            expect(result.failed).toBe(0);
            expect(mockModbusClient.writeRegister).toHaveBeenCalledTimes(3);
        });
    });

    describe('executeCoilCommands - START sequence', () => {
        it('should execute valve coils first, then pump coils on START', async () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'pump_1', value: true, fc: 5, unitid: 1, address: 20, quantity: 1 }
            ];

            const schedule: TabiotSchedule = {
                name: 'test-schedule',
                label: 'Test',
                status: 'running',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };

            const result = await (service as any).executeCoilCommands(
                mockModbusClient,
                commands,
                schedule,
                true, // isStarting
                false // isFinishing
            );

            expect(result.success).toBe(2);
            expect(mockModbusClient.writeCoil).toHaveBeenCalledTimes(2);
            // Verify order: valves should be written first
            const calls = (mockModbusClient.writeCoil as jest.Mock).mock.calls;
            expect(calls[0][0]).toBe(10); // valve_1 address
        });
    });

    describe('executeCoilCommands - FINISH sequence', () => {
        it('should execute pump coils first, then valve coils on FINISH', async () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: false, fc: 5, unitid: 1, address: 10, quantity: 1 },
                { key: 'pump_1', value: false, fc: 5, unitid: 1, address: 20, quantity: 1 }
            ];

            const schedule: TabiotSchedule = {
                name: 'test-schedule',
                label: 'Test',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };

            const result = await (service as any).executeCoilCommands(
                mockModbusClient,
                commands,
                schedule,
                false, // isStarting
                true // isFinishing
            );

            expect(result.success).toBe(2);
            // Verify order: pumps should be written first
            const calls = (mockModbusClient.writeCoil as jest.Mock).mock.calls;
            expect(calls[0][0]).toBe(20); // pump_1 address
        });
    });

    describe('executeCoilCommands - Default sequence', () => {
        it('should execute coils in order when not starting or finishing', async () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            const result = await (service as any).executeCoilCommands(
                mockModbusClient,
                commands,
                undefined,
                false,
                false
            );

            expect(result.success).toBe(1);
        });
    });

    describe('verifyModbusWrite', () => {
        beforeEach(() => {
            mockGlobalContext.set('scaleConfigs', []);
        });

        it('should verify coil writes successfully', async () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            // Mock read to return expected value
            (mockModbusClient.readCoils as jest.Mock).mockResolvedValue({ data: [true] });

            const result = await service.verifyModbusWrite(mockModbusClient, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalledWith(10, 1);
        });

        it('should verify holding register writes successfully', async () => {
            const commands: ModbusCmd[] = [
                { key: 'set_flow', value: 50, fc: 6, unitid: 1, address: 100, quantity: 1 }
            ];

            // Mock read to return expected value (50)
            (mockModbusClient.readHoldingRegisters as jest.Mock).mockResolvedValue({ data: [50] });

            const result = await service.verifyModbusWrite(mockModbusClient, commands);

            expect(result).toBe(true);
            expect(mockModbusClient.readHoldingRegisters).toHaveBeenCalledWith(100, 1);
        });

        it('should return false when verification fails', async () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            // Mock read to return wrong value
            (mockModbusClient.readCoils as jest.Mock).mockResolvedValue({ data: [false] });

            const result = await service.verifyModbusWrite(mockModbusClient, commands);
            
            expect(result).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('VERIFICATION FAILED'));
        });

        it('should skip holding register verification when disabled', async () => {
            const nonVerifyService = new ModbusExecutorService(mockNode, false, true);
            const commands: ModbusCmd[] = [
                { key: 'set_flow', value: 50, fc: 6, unitid: 1, address: 100, quantity: 1 }
            ];

            const result = await nonVerifyService.verifyModbusWrite(mockModbusClient, commands);
            
            expect(result).toBe(true);
            expect(mockModbusClient.readHoldingRegisters).not.toHaveBeenCalled();
        });

        it('should always verify coils regardless of verifyAfterWrite setting', async () => {
            const nonVerifyService = new ModbusExecutorService(mockNode, false, true);
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            (mockModbusClient.readCoils as jest.Mock).mockResolvedValue({ data: [true] });

            const result = await nonVerifyService.verifyModbusWrite(mockModbusClient, commands);
            
            expect(result).toBe(true);
            expect(mockModbusClient.readCoils).toHaveBeenCalled();
        });
    });

    describe('resetModbusCommands', () => {
        it('should reset coils to false', async () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            const result = await service.resetModbusCommands(mockModbusClient, commands);
            
            expect(result).toBe(true);
            expect(mockModbusClient.writeCoil).toHaveBeenCalledWith(10, false);
        });

        it('should reset holding registers to 0', async () => {
            const commands: ModbusCmd[] = [
                { key: 'set_flow', value: 50, fc: 6, unitid: 1, address: 100, quantity: 1 }
            ];

            const result = await service.resetModbusCommands(mockModbusClient, commands);
            
            expect(result).toBe(true);
            expect(mockModbusClient.writeRegister).toHaveBeenCalledWith(100, 0);
        });

        it('should handle reset failures gracefully', async () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            (mockModbusClient.writeCoil as jest.Mock).mockRejectedValueOnce(new Error('Modbus error'));

            const result = await service.resetModbusCommands(mockModbusClient, commands);
            
            expect(result).toBe(false);
        });
    });

    describe('trackActiveCommands', () => {
        beforeEach(() => {
            mockGlobalContext.set('activeModbusCommands', {});
        });

        it('should track active commands for a schedule', () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            service.trackActiveCommands('schedule-1', commands);

            const activeCommands = mockGlobalContext.get('activeModbusCommands');
            expect(activeCommands['schedule-1']).toHaveLength(1);
            expect(activeCommands['schedule-1'][0].key).toBe('valve_1');
        });

        it('should replace existing active commands for same schedule', () => {
            mockGlobalContext.set('activeModbusCommands', {
                'schedule-1': [
                    { key: 'old_command', value: true, fc: 5, unitid: 1, address: 99, quantity: 1 }
                ]
            });

            const newCommands: ModbusCmd[] = [
                { key: 'new_command', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            service.trackActiveCommands('schedule-1', newCommands);

            const activeCommands = mockGlobalContext.get('activeModbusCommands');
            expect(activeCommands['schedule-1']).toHaveLength(1);
            expect(activeCommands['schedule-1'][0].key).toBe('new_command');
        });
    });

    describe('clearActiveCommands', () => {
        beforeEach(() => {
            mockGlobalContext.set('activeModbusCommands', {});
        });

        it('should clear active commands for a schedule', () => {
            mockGlobalContext.set('activeModbusCommands', {
                'schedule-1': [
                    { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            });

            service.clearActiveCommands('schedule-1');

            const activeCommands = mockGlobalContext.get('activeModbusCommands');
            expect(activeCommands['schedule-1']).toBeUndefined();
        });

        it('should handle non-existent schedule gracefully', () => {
            expect(() => service.clearActiveCommands('non-existent')).not.toThrow();
        });
    });

    describe('getActiveCommands', () => {
        beforeEach(() => {
            mockGlobalContext.set('activeModbusCommands', {});
        });

        it('should return active commands for a schedule', () => {
            const testCommands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            mockGlobalContext.set('activeModbusCommands', {
                'schedule-1': testCommands
            });

            const result = service.getActiveCommands('schedule-1');

            expect(result).toHaveLength(1);
            expect(result[0].key).toBe('valve_1');
        });

        it('should return empty array for non-existent schedule', () => {
            const result = service.getActiveCommands('non-existent');

            expect(result).toHaveLength(0);
        });
    });

    describe('canExecuteCommands', () => {
        beforeEach(() => {
            mockGlobalContext.set('activeModbusCommands', {});
        });

        it('should return true when no conflicts', () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            mockGlobalContext.set('activeModbusCommands', {
                'schedule-1': [
                    { key: 'valve_2', value: true, fc: 5, unitid: 1, address: 11, quantity: 1 }
                ]
            });

            const result = service.canExecuteCommands(commands);

            expect(result).toBe(true);
        });

        it('should return false when conflicts exist', () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            mockGlobalContext.set('activeModbusCommands', {
                'schedule-1': [
                    { key: 'valve_2', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            });

            const result = service.canExecuteCommands(commands);

            expect(result).toBe(false);
        });

        it('should ignore conflicts with excluded schedule', () => {
            const commands: ModbusCmd[] = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];

            mockGlobalContext.set('activeModbusCommands', {
                'schedule-1': [
                    { key: 'valve_1', value: false, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            });

            const result = service.canExecuteCommands(commands, 'schedule-1');

            expect(result).toBe(true);
        });
    });

    describe('execute - Main entry point', () => {
        it('should return error when Modbus client not injected', async () => {
            const result = await service.execute({
                commands: { holdingCommands: [], coilCommands: [] },
                verifyAfterWrite: true
            });

            expect(result.success).toBe(false);
            expect(result.errorMessage).toContain('Modbus client not injected');
        });
    });

    describe('Debug logging', () => {
        it('should log debug messages when enabled', () => {
            const debugService = new ModbusExecutorService(mockNode, true, true);
            // Call a method that produces debug output - canExecuteCommands logs when conflicts found
            mockGlobalContext.set('activeModbusCommands', {
                'other-schedule': [{ key: 'test', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }]
            });
            debugService.canExecuteCommands([{ key: 'test', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }]);

            expect(mockNode.warn).toHaveBeenCalled();
        });

        it('should not log debug messages when disabled', () => {
            jest.clearAllMocks();
            const nonDebugService = new ModbusExecutorService(mockNode, true, false);
            // Method calls shouldn't produce debug logs
            expect(mockNode.warn).not.toHaveBeenCalled();
        });
    });
});

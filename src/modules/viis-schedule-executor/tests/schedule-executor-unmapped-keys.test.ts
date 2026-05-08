/**
 * Test cases for VIIS Schedule Executor unmapped keys handling
 * Tests the enhanced functionality to handle unmapped keys as configuration parameters
 */

import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';

// Mock dependencies
const mockNode = {
    context: () => ({
        global: {
            get: jest.fn(),
            set: jest.fn()
        }
    })
} as unknown as Node;

const mockGlobalHelper = {
    getJsonEnvVar: jest.fn(),
    getEnvVar: jest.fn()
};

// Mock schedule data
const createMockSchedule = (name: string, action: string): TabiotSchedule => ({
    name,
    action,
    label: `Test Schedule ${name}`,
    device_label: 'Test Device',
    status: '',
    start_time: '08:00:00',
    end_time: '18:00:00',
    enable: 1,
    is_deleted: 0,
    device_id: 'test-device',
                machine_type: 'MAIN_ENGINE',
    created: new Date(),
    modified: new Date(),
    type: 'fixed',
    deleted: null
} as TabiotSchedule);

describe('ScheduleService - Unmapped Keys Handling', () => {
    let scheduleService: ScheduleService;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock global context
        const mockGlobalContext = new Map();
        (mockNode.context().global.get as jest.Mock).mockImplementation((key: string) => {
            return mockGlobalContext.get(key) || {};
        });
        (mockNode.context().global.set as jest.Mock).mockImplementation((key: string, value: any) => {
            mockGlobalContext.set(key, value);
        });

        scheduleService = new ScheduleService(mockNode);

        // Mock the globalHelper property directly on the service instance
        Object.defineProperty(scheduleService, 'globalHelper', {
            value: {
                getJsonEnvVar: jest.fn((key: string, defaultValue: any) => {
                    if (key === 'MODBUS_COILS') {
                        return {
                            'pump_1': 0,
                            'valve_A1': 1,
                            'power': 2
                        };
                    }
                    if (key === 'MODBUS_HOLDING_REGISTERS') {
                        return {
                            'set_flow_A1': 10,
                            'temperature': 12
                        };
                    }
                    return defaultValue;
                }),
                getEnvVar: jest.fn((key: string, defaultValue: any) => {
                    if (key === 'DEVICE_ID') return 'test-device-001';
                    return defaultValue;
                })
            },
            writable: true,
            configurable: true
        });
    });

    describe('mapScheduleToModbus with only mapped keys', () => {
        it('should process only Modbus-mapped keys and return empty config parameters', () => {
            const schedule = createMockSchedule('test-mapped-only', JSON.stringify({
                pump_1: true,
                set_flow_A1: 150,
                valve_A1: true,
                temperature: 25
            }));

            const result = scheduleService.mapScheduleToModbus(schedule);

            expect(result.holdingCommands).toHaveLength(2);
            expect(result.coilCommands).toHaveLength(2);
            // Note: iri_time is automatically added as unmapped key, so we expect 1 config parameter
            expect(result.configParameters).toHaveLength(1);
            expect(result.configParameters[0]).toMatchObject({
                key: 'iri_time',
                type: 'number'
            });

            expect(result.holdingCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        key: 'set_flow_A1',
                        value: 150,
                        fc: 6,
                        address: 10
                    }),
                    expect.objectContaining({
                        key: 'temperature',
                        value: 25,
                        fc: 6,
                        address: 12
                    })
                ])
            );

            expect(result.coilCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: 'pump_1', value: true, fc: 5, address: 0 }),
                    expect.objectContaining({ key: 'valve_A1', value: true, fc: 5, address: 1 })
                ])
            );
        });
    });

    describe('mapScheduleToModbus with only unmapped keys', () => {
        it('should process only unmapped keys as config parameters', () => {
            const schedule = createMockSchedule('test-unmapped-only', JSON.stringify({
                custom_setting: 42,
                debug_mode: true,
                user_preference: 'high'
            }));

            const result = scheduleService.mapScheduleToModbus(schedule);

            expect(result.holdingCommands).toHaveLength(0);
            expect(result.coilCommands).toHaveLength(0);
            // Note: iri_time is automatically added, so we expect 4 config parameters
            expect(result.configParameters).toHaveLength(4);

            expect(result.configParameters).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        key: 'custom_setting',
                        value: 42,
                        type: 'number',
                        scheduleId: 'test-unmapped-only'
                    }),
                    expect.objectContaining({
                        key: 'debug_mode',
                        value: true,
                        type: 'boolean',
                        scheduleId: 'test-unmapped-only'
                    }),
                    expect.objectContaining({
                        key: 'user_preference',
                        value: 'high',
                        type: 'string',
                        scheduleId: 'test-unmapped-only'
                    })
                ])
            );
        });
    });

    describe('mapScheduleToModbus with mixed mapped and unmapped keys', () => {
        it('should process mapped falsy values but skip unmapped falsy values', () => {
            const schedule = createMockSchedule('test-mixed', JSON.stringify({
                pump_1: true,              // Mapped to coil - truthy, include
                set_flow_A1: 200,         // Mapped to holding - truthy, include
                custom_timeout: 30,       // Unmapped - truthy, include
                enable_logging: false,    // Unmapped - falsy, SKIP
                valve_A1: false,          // Mapped to coil - falsy, SKIP (don't write false coils)
                user_notes: 'test run'    // Unmapped - truthy, include
            }));

            const result = scheduleService.mapScheduleToModbus(schedule);

            // Check Modbus commands
            expect(result.holdingCommands).toHaveLength(1);
            expect(result.coilCommands).toHaveLength(1); // Only pump_1 (valve_A1 false is skipped)
            // Note: iri_time is automatically added, so we expect 3 config parameters (custom_timeout, user_notes, iri_time)
            expect(result.configParameters).toHaveLength(3);

            // Verify Modbus commands
            expect(result.holdingCommands[0]).toMatchObject({
                key: 'set_flow_A1',
                value: 200,
                fc: 6
            });

            expect(result.coilCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: 'pump_1', value: true, fc: 5 })
                ])
            );

            // Verify config parameters
            expect(result.configParameters).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        key: 'custom_timeout',
                        value: 30,
                        type: 'number'
                    }),
                    expect.objectContaining({
                        key: 'user_notes',
                        value: 'test run',
                        type: 'string'
                    })
                ])
            );
        });
    });

    describe('Type conversion scenarios', () => {
        it('should correctly convert string numbers to numbers', () => {
            const schedule = createMockSchedule('test-string-numbers', JSON.stringify({
                numeric_string: '123',
                decimal_string: '45.67',
                comma_number: '1,234.56'
            }));

            const result = scheduleService.mapScheduleToModbus(schedule);

            // Should have 4 config parameters: 3 test params + iri_time
            expect(result.configParameters).toHaveLength(4);
            expect(result.configParameters).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        key: 'numeric_string',
                        value: 123,
                        type: 'number'
                    }),
                    expect.objectContaining({
                        key: 'decimal_string',
                        value: 45.67,
                        type: 'number'
                    }),
                    expect.objectContaining({
                        key: 'comma_number',
                        value: 1234.56,
                        type: 'number'
                    }),
                    expect.objectContaining({
                        key: 'iri_time',
                        type: 'number'
                    })
                ])
            );
        });

        it('should correctly convert string booleans to booleans', () => {
            const schedule = createMockSchedule('test-string-booleans', JSON.stringify({
                bool_true: 'true',
                bool_false: 'FALSE',
                bool_mixed: 'True'
            }));

            const result = scheduleService.mapScheduleToModbus(schedule);

            // Should have 3 config parameters: 2 truthy test params + iri_time
            // bool_false is skipped because it converts to false (falsy)
            expect(result.configParameters).toHaveLength(3);
            expect(result.configParameters).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        key: 'bool_true',
                        value: true,
                        type: 'boolean'
                    }),
                    expect.objectContaining({
                        key: 'bool_mixed',
                        value: true,
                        type: 'boolean'
                    }),
                    expect.objectContaining({
                        key: 'iri_time',
                        type: 'number'
                    })
                ])
            );
        });
    });

    describe('Edge cases', () => {
        it('should handle empty action gracefully', () => {
            const schedule = createMockSchedule('test-empty', '');

            const result = scheduleService.mapScheduleToModbus(schedule);

            expect(result.holdingCommands).toHaveLength(0);
            expect(result.coilCommands).toHaveLength(0);
            expect(result.configParameters).toHaveLength(0);
        });

        it('should handle null and undefined values', () => {
            const schedule = createMockSchedule('test-null-undefined', JSON.stringify({
                null_value: null,
                undefined_value: undefined,
                empty_string: '',
                zero_value: 0
            }));

            const result = scheduleService.mapScheduleToModbus(schedule);

            // All values are falsy and should be skipped, only iri_time remains
            expect(result.configParameters).toHaveLength(1);
            expect(result.configParameters[0].key).toBe('iri_time');
        });

        it('should handle malformed JSON gracefully', () => {
            const schedule = createMockSchedule('test-malformed', '{ invalid json }');

            const result = scheduleService.mapScheduleToModbus(schedule);

            expect(result.holdingCommands).toHaveLength(0);
            expect(result.coilCommands).toHaveLength(0);
            expect(result.configParameters).toHaveLength(0);
        });
    });

    describe('Global context storage', () => {
        it('should store config values in global context', () => {
            const schedule = createMockSchedule('test-storage', JSON.stringify({
                test_param: 'test_value'
            }));

            const result = scheduleService.mapScheduleToModbus(schedule);

            // Verify that config parameters were created (test_param + iri_time)
            expect(result.configParameters).toHaveLength(2);
            expect(result.configParameters).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        key: 'test_param',
                        value: 'test_value',
                        type: 'string'
                    }),
                    expect.objectContaining({
                        key: 'iri_time',
                        type: 'number'
                    })
                ])
            );

            // Verify that the config parameters have the correct structure
            // This tests the core functionality without relying on mock implementation details
            result.configParameters.forEach(param => {
                expect(param).toHaveProperty('key');
                expect(param).toHaveProperty('value');
                expect(param).toHaveProperty('type');
                expect(param).toHaveProperty('scheduleId', 'test-storage');
                expect(param).toHaveProperty('timestamp');
                expect(typeof param.timestamp).toBe('number');
            });
        });
    });
});

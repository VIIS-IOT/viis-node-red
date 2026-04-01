"use strict";
/**
 * Test cases for VIIS Schedule Executor Falsy Value Handling
 *
 * This test suite verifies that falsy values (0, "0", false, null, undefined, "")
 * are properly skipped for both Modbus-mapped keys and config parameters.
 *
 * Business Rule: All falsy values should be ignored during schedule execution
 * to prevent unintended device control or configuration updates.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
// Mock dependencies
const mockNode = {
    context: () => ({
        global: {
            get: jest.fn(),
            set: jest.fn()
        }
    }),
    warn: jest.fn(),
    error: jest.fn()
};
// Mock schedule data
const createMockSchedule = (name, action) => ({
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
});
describe('ScheduleService - Falsy Value Handling', () => {
    let scheduleService;
    let mockGlobalContext;
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock global context
        mockGlobalContext = new Map();
        mockNode.context().global.get.mockImplementation((key) => {
            return mockGlobalContext.get(key) || {};
        });
        mockNode.context().global.set.mockImplementation((key, value) => {
            mockGlobalContext.set(key, value);
        });
        scheduleService = new viis_schedule_executor_service_1.ScheduleService(mockNode);
        // Mock the globalHelper property directly on the service instance
        Object.defineProperty(scheduleService, 'globalHelper', {
            value: {
                getJsonEnvVar: jest.fn((key, defaultValue) => {
                    if (key === 'MODBUS_COILS') {
                        return {
                            'pump_1': 0,
                            'valve_A1': 1,
                            'power': 2,
                            'main_pump': 3
                        };
                    }
                    if (key === 'MODBUS_HOLDING_REGISTERS') {
                        return {
                            'set_flow_A1': 10,
                            'temperature': 12,
                            'set_temp': 14,
                            'pressure': 16
                        };
                    }
                    return defaultValue;
                }),
                getEnvVar: jest.fn((key, defaultValue) => {
                    if (key === 'DEVICE_ID')
                        return 'test-device-001';
                    return defaultValue;
                })
            },
            writable: true,
            configurable: true
        });
    });
    describe('mapScheduleToModbus - Falsy values for Modbus-mapped keys', () => {
        it('should skip holding register with value 0', () => {
            const schedule = createMockSchedule('test-zero-holding', JSON.stringify({
                set_flow_A1: 0, // Falsy - should be skipped
                temperature: 25 // Truthy - should be included
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.holdingCommands).toHaveLength(1);
            expect(result.holdingCommands[0].key).toBe('temperature');
            expect(result.configParameters).toHaveLength(1); // Only iri_time
        });
        it('should skip holding register with value "0" (string)', () => {
            const schedule = createMockSchedule('test-string-zero-holding', JSON.stringify({
                set_flow_A1: "0", // Falsy - should be skipped
                temperature: 25
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.holdingCommands).toHaveLength(1);
            expect(result.holdingCommands[0].key).toBe('temperature');
        });
        it('should skip coil with value false', () => {
            const schedule = createMockSchedule('test-false-coil', JSON.stringify({
                pump_1: false, // Falsy - should be skipped
                valve_A1: true // Truthy - should be included
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.coilCommands).toHaveLength(1);
            expect(result.coilCommands[0].key).toBe('valve_A1');
        });
        it('should skip coil with value "false" (string)', () => {
            const schedule = createMockSchedule('test-string-false-coil', JSON.stringify({
                pump_1: "false", // Falsy - should be skipped
                valve_A1: "true"
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.coilCommands).toHaveLength(1);
            expect(result.coilCommands[0].key).toBe('valve_A1');
        });
        it('should skip all falsy values: 0, false, null, undefined, ""', () => {
            const schedule = createMockSchedule('test-all-falsy', JSON.stringify({
                set_flow_A1: 0, // Falsy
                temperature: null, // Falsy
                pressure: undefined, // Falsy
                set_temp: "", // Falsy
                pump_1: false, // Falsy
                valve_A1: 0, // Falsy
                power: false // Falsy
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.holdingCommands).toHaveLength(0);
            expect(result.coilCommands).toHaveLength(0);
            expect(result.configParameters).toHaveLength(1); // Only iri_time
        });
        it('should include truthy values alongside falsy values', () => {
            const schedule = createMockSchedule('test-mixed-truthy-falsy', JSON.stringify({
                set_flow_A1: 0, // Falsy - skip
                temperature: 25, // Truthy - include
                pressure: 0, // Falsy - skip
                pump_1: false, // Falsy - skip
                valve_A1: true, // Truthy - include
                power: 0, // Falsy - skip
                main_pump: true // Truthy - include
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.holdingCommands).toHaveLength(1);
            expect(result.holdingCommands[0].key).toBe('temperature');
            expect(result.coilCommands).toHaveLength(2);
            expect(result.coilCommands).toEqual(expect.arrayContaining([
                expect.objectContaining({ key: 'valve_A1', value: true }),
                expect.objectContaining({ key: 'main_pump', value: true })
            ]));
        });
    });
    describe('mapScheduleToModbus - Falsy values for unmapped keys (config parameters)', () => {
        it('should skip config parameter with value 0', () => {
            const schedule = createMockSchedule('test-zero-config', JSON.stringify({
                custom_setting: 0, // Falsy - should be skipped
                valid_param: 42 // Truthy - should be included
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            // Should only have iri_time (auto-added) and valid_param
            expect(result.configParameters).toHaveLength(2);
            expect(result.configParameters.map(p => p.key)).toContain('valid_param');
            expect(result.configParameters.map(p => p.key)).not.toContain('custom_setting');
        });
        it('should skip config parameter with value "0" (string)', () => {
            const schedule = createMockSchedule('test-string-zero-config', JSON.stringify({
                custom_setting: "0", // Falsy - should be skipped
                valid_param: "42"
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.configParameters).toHaveLength(2); // iri_time + valid_param
            expect(result.configParameters.map(p => p.key)).not.toContain('custom_setting');
        });
        it('should skip config parameter with value false', () => {
            const schedule = createMockSchedule('test-false-config', JSON.stringify({
                debug_mode: false, // Falsy - should be skipped
                enable_log: true // Truthy - should be included
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.configParameters).toHaveLength(2); // iri_time + enable_log
            expect(result.configParameters.map(p => p.key)).not.toContain('debug_mode');
        });
        it('should skip config parameter with value "false" (string)', () => {
            const schedule = createMockSchedule('test-string-false-config', JSON.stringify({
                debug_mode: "false", // Falsy - should be skipped
                enable_log: "true"
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.configParameters).toHaveLength(2); // iri_time + enable_log
            expect(result.configParameters.map(p => p.key)).not.toContain('debug_mode');
        });
        it('should skip all falsy config values: 0, "0", false, "false", null, undefined, ""', () => {
            const schedule = createMockSchedule('test-all-falsy-config', JSON.stringify({
                zero_num: 0, // Falsy
                zero_str: "0", // Falsy
                false_bool: false, // Falsy
                false_str: "false", // Falsy
                null_val: null, // Falsy
                undefined_val: undefined, // Falsy
                empty_str: "", // Falsy
                valid_param: "keep_me" // Truthy - should be included
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            // Should only have iri_time and valid_param
            expect(result.configParameters).toHaveLength(2);
            expect(result.configParameters.map(p => p.key)).toEqual(expect.arrayContaining(['iri_time', 'valid_param']));
        });
        it('should handle mixed truthy and falsy config values', () => {
            const schedule = createMockSchedule('test-mixed-config', JSON.stringify({
                irrigation_mode: "auto", // Truthy - include
                priority: 0, // Falsy - skip
                debug_mode: false, // Falsy - skip
                user_id: "farmer_001", // Truthy - include
                max_duration: "0", // Falsy - skip
                notes: "" // Falsy - skip
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            // Should have iri_time, irrigation_mode, and user_id
            expect(result.configParameters).toHaveLength(3);
            expect(result.configParameters.map(p => p.key)).toEqual(expect.arrayContaining(['iri_time', 'irrigation_mode', 'user_id']));
        });
    });
    describe('storeConfigParameter - Falsy value handling', () => {
        it('should return null for value 0', () => {
            const result = scheduleService.storeConfigParameter('test_key', 0, 'test-schedule');
            expect(result).toBeNull();
        });
        it('should return null for value "0" (string)', () => {
            const result = scheduleService.storeConfigParameter('test_key', "0", 'test-schedule');
            expect(result).toBeNull();
        });
        it('should return null for value false', () => {
            const result = scheduleService.storeConfigParameter('test_key', false, 'test-schedule');
            expect(result).toBeNull();
        });
        it('should return null for value "false" (string)', () => {
            const result = scheduleService.storeConfigParameter('test_key', "false", 'test-schedule');
            expect(result).toBeNull();
        });
        it('should return null for null value', () => {
            const result = scheduleService.storeConfigParameter('test_key', null, 'test-schedule');
            expect(result).toBeNull();
        });
        it('should return null for undefined value', () => {
            const result = scheduleService.storeConfigParameter('test_key', undefined, 'test-schedule');
            expect(result).toBeNull();
        });
        it('should return null for empty string', () => {
            const result = scheduleService.storeConfigParameter('test_key', "", 'test-schedule');
            expect(result).toBeNull();
        });
        it('should store truthy number values', () => {
            const result = scheduleService.storeConfigParameter('test_key', 42, 'test-schedule');
            expect(result).not.toBeNull();
            expect(result).toMatchObject({
                key: 'test_key',
                value: 42,
                type: 'number',
                scheduleId: 'test-schedule'
            });
        });
        it('should store truthy boolean values', () => {
            const result = scheduleService.storeConfigParameter('test_key', true, 'test-schedule');
            expect(result).not.toBeNull();
            expect(result).toMatchObject({
                key: 'test_key',
                value: true,
                type: 'boolean',
                scheduleId: 'test-schedule'
            });
        });
        it('should store truthy string values', () => {
            const result = scheduleService.storeConfigParameter('test_key', "valid_value", 'test-schedule');
            expect(result).not.toBeNull();
            expect(result).toMatchObject({
                key: 'test_key',
                value: "valid_value",
                type: 'string',
                scheduleId: 'test-schedule'
            });
        });
    });
    describe('processRpcControlCommand - Falsy value handling', () => {
        it('should skip RPC command with value 0', () => {
            const result = scheduleService.processRpcControlCommand('test_key', 0);
            expect(result.success).toBe(false);
        });
        it('should skip RPC command with value "0" (string)', () => {
            const result = scheduleService.processRpcControlCommand('test_key', "0");
            expect(result.success).toBe(false);
        });
        it('should skip RPC command with value false', () => {
            const result = scheduleService.processRpcControlCommand('test_key', false);
            expect(result.success).toBe(false);
        });
        it('should skip RPC command with value "false" (string)', () => {
            const result = scheduleService.processRpcControlCommand('test_key', "false");
            expect(result.success).toBe(false);
        });
        it('should skip RPC command with null value', () => {
            const result = scheduleService.processRpcControlCommand('test_key', null);
            expect(result.success).toBe(false);
        });
        it('should skip RPC command with undefined value', () => {
            const result = scheduleService.processRpcControlCommand('test_key', undefined);
            expect(result.success).toBe(false);
        });
        it('should skip RPC command with empty string', () => {
            const result = scheduleService.processRpcControlCommand('test_key', "");
            expect(result.success).toBe(false);
        });
        it('should process RPC command with truthy value', () => {
            const result = scheduleService.processRpcControlCommand('test_key', 42);
            expect(result.success).toBe(true);
        });
    });
    describe('Integration scenarios', () => {
        it('should handle realistic irrigation schedule with falsy values', () => {
            const schedule = createMockSchedule('irrigation-schedule', JSON.stringify({
                // Modbus mapped - truthy
                main_pump: true,
                valve_A1: true,
                set_flow_A1: 150,
                // Modbus mapped - falsy (should be skipped)
                pump_1: false,
                set_temp: 0,
                temperature: 0,
                // Unmapped config - truthy
                irrigation_mode: "automatic",
                user_id: "farmer_001",
                // Unmapped config - falsy (should be skipped)
                debug_mode: false,
                priority: 0,
                notes: "",
                max_duration: "0"
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            // Modbus commands: 3 truthy values
            expect(result.holdingCommands).toHaveLength(1); // set_flow_A1 only
            expect(result.coilCommands).toHaveLength(2); // main_pump, valve_A1
            // Config parameters: iri_time + 2 truthy unmapped
            expect(result.configParameters).toHaveLength(3);
            expect(result.configParameters.map(p => p.key)).toEqual(expect.arrayContaining(['iri_time', 'irrigation_mode', 'user_id']));
        });
        it('should handle schedule with all falsy action values', () => {
            const schedule = createMockSchedule('all-falsy-schedule', JSON.stringify({
                pump_1: 0,
                valve_A1: false,
                set_flow_A1: 0,
                custom_setting: null,
                debug_mode: false,
                notes: ""
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            // No Modbus commands, only iri_time as config
            expect(result.holdingCommands).toHaveLength(0);
            expect(result.coilCommands).toHaveLength(0);
            expect(result.configParameters).toHaveLength(1); // Only iri_time
            expect(result.configParameters[0].key).toBe('iri_time');
        });
    });
    describe('Backward compatibility', () => {
        it('should maintain existing behavior for truthy values', () => {
            const schedule = createMockSchedule('backward-compat', JSON.stringify({
                pump_1: true,
                valve_A1: true,
                set_flow_A1: 200,
                temperature: 25,
                custom_setting: 42,
                debug_mode: true,
                irrigation_mode: "auto"
            }));
            const result = scheduleService.mapScheduleToModbus(schedule);
            // All truthy values should be processed
            expect(result.holdingCommands).toHaveLength(2);
            expect(result.coilCommands).toHaveLength(2);
            expect(result.configParameters.length).toBeGreaterThan(2); // iri_time + unmapped
        });
    });
});

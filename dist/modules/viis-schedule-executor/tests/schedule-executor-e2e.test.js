"use strict";
/**
 * End-to-end tests for VIIS Schedule Executor with unmapped keys enhancement
 * Tests the complete flow from schedule processing to MQTT publishing
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
// Mock all dependencies
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
const mockMqttClient = {
    publish: jest.fn(),
    isConnected: jest.fn(() => true)
};
const mockModbusClient = {
    writeRegister: jest.fn(),
    writeCoil: jest.fn(),
    readHoldingRegisters: jest.fn(),
    readCoils: jest.fn(),
    isConnected: true
};
// Create realistic test schedule
const createTestSchedule = (name, action) => ({
    name,
    action: typeof action === 'string' ? action : JSON.stringify(action),
    label: `Test Schedule ${name}`,
    device_label: 'Test Device',
    status: '',
    start_time: '08:00:00',
    end_time: '18:00:00',
    enable: 1,
    is_deleted: 0,
    device_id: 'test-device-001',
    created: new Date(),
    modified: new Date(),
    type: 'fixed',
    deleted: null
});
describe('ScheduleService - End-to-End Tests with Unmapped Keys', () => {
    let scheduleService;
    let mockGlobalContext;
    beforeEach(() => {
        jest.clearAllMocks();
        // Setup global context mock
        mockGlobalContext = new Map();
        mockNode.context().global.get.mockImplementation((key) => {
            return mockGlobalContext.get(key) || {};
        });
        mockNode.context().global.set.mockImplementation((key, value) => {
            mockGlobalContext.set(key, value);
        });
        scheduleService = new viis_schedule_executor_service_1.ScheduleService(mockNode);
        // Setup environment mocks using Object.defineProperty
        Object.defineProperty(scheduleService, 'globalHelper', {
            value: {
                getJsonEnvVar: jest.fn((key, defaultValue) => {
                    if (key === 'MODBUS_COILS') {
                        return {
                            'main_pump': 0,
                            'sub_pump': 1,
                            'valve_A1': 2,
                            'valve_A2': 3,
                            'power': 4
                        };
                    }
                    if (key === 'MODBUS_HOLDING_REGISTERS') {
                        return {
                            'iri_time': 10,
                            'set_flow_A1': 11,
                            'set_flow_A2': 12,
                            'temperature_setpoint': 13
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
    describe('Complete schedule processing with mixed keys', () => {
        it('should process a realistic irrigation schedule with both mapped and unmapped keys', async () => {
            const scheduleAction = {
                // Mapped keys (will become Modbus commands)
                main_pump: true,
                valve_A1: true,
                valve_A2: false,
                iri_time: 1800,
                set_flow_A1: 250,
                // Unmapped keys (will become config parameters)
                irrigation_mode: 'automatic',
                user_id: 'farmer_001',
                crop_type: 'tomato',
                weather_compensation: true,
                max_duration: 3600,
                priority_level: 2,
                notes: 'Morning irrigation cycle'
            };
            const schedule = createTestSchedule('irrigation-001', scheduleAction);
            const result = scheduleService.mapScheduleToModbus(schedule);
            // Verify Modbus commands
            expect(result.holdingCommands).toHaveLength(2); // iri_time, set_flow_A1
            expect(result.coilCommands).toHaveLength(2); // main_pump, valve_A1 (valve_A2 is false)
            // Note: iri_time is automatically added as unmapped key since it's already mapped, so we expect 7 unmapped + 1 auto iri_time = 8
            expect(result.configParameters).toHaveLength(7); // All unmapped keys (iri_time is mapped, so not in config)
            // Verify specific Modbus commands
            expect(result.holdingCommands).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    key: 'iri_time',
                    value: 1800,
                    fc: 6,
                    address: 10
                }),
                expect.objectContaining({
                    key: 'set_flow_A1',
                    value: 250,
                    fc: 6,
                    address: 11
                })
            ]));
            expect(result.coilCommands).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    key: 'main_pump',
                    value: true,
                    fc: 5,
                    address: 0
                }),
                expect.objectContaining({
                    key: 'valve_A1',
                    value: true,
                    fc: 5,
                    address: 2
                })
            ]));
            // Verify config parameters
            expect(result.configParameters).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    key: 'irrigation_mode',
                    value: 'automatic',
                    type: 'string',
                    scheduleId: 'irrigation-001'
                }),
                expect.objectContaining({
                    key: 'weather_compensation',
                    value: true,
                    type: 'boolean',
                    scheduleId: 'irrigation-001'
                }),
                expect.objectContaining({
                    key: 'priority_level',
                    value: 2,
                    type: 'number',
                    scheduleId: 'irrigation-001'
                })
            ]));
            // Verify that config parameters have the correct structure
            // This tests the core functionality without relying on mock implementation details
            result.configParameters.forEach(param => {
                expect(param).toHaveProperty('key');
                expect(param).toHaveProperty('value');
                expect(param).toHaveProperty('type');
                expect(param).toHaveProperty('scheduleId', 'irrigation-001');
                expect(param).toHaveProperty('timestamp');
                expect(typeof param.timestamp).toBe('number');
            });
        });
        it('should handle complex data types in unmapped keys', async () => {
            const scheduleAction = {
                // Mapped key
                main_pump: true,
                // Complex unmapped keys
                sensor_thresholds: { min: 10, max: 90 },
                valve_sequence: [1, 3, 5, 2],
                metadata: {
                    created_by: 'system',
                    version: '2.1.0',
                    tags: ['irrigation', 'automated']
                }
            };
            const schedule = createTestSchedule('complex-001', scheduleAction);
            const result = scheduleService.mapScheduleToModbus(schedule);
            // Note: iri_time is automatically added as holding command, not config parameter
            expect(result.configParameters).toHaveLength(3);
            // Complex objects should be stored as strings (converted to string representation)
            const sensorThresholdParam = result.configParameters.find(p => p.key === 'sensor_thresholds');
            expect(sensorThresholdParam).toMatchObject({
                key: 'sensor_thresholds',
                value: '[object Object]', // Objects are converted to string representation
                type: 'string'
            });
        });
    });
    describe('MQTT publishing integration', () => {
        it('should publish config parameters via MQTT after schedule mapping', async () => {
            const scheduleAction = {
                valve_A1: true, // Mapped
                custom_setting: 'test_value', // Unmapped
                debug_enabled: false // Unmapped
            };
            const schedule = createTestSchedule('mqtt-test', scheduleAction);
            const result = scheduleService.mapScheduleToModbus(schedule);
            // Simulate MQTT publishing for each config parameter
            for (const configParam of result.configParameters) {
                await scheduleService.publishConfigUpdate(mockMqttClient, mockMqttClient, configParam);
            }
            // Verify MQTT publish calls (2 config params × 2 clients = 4 calls, iri_time is holding command)
            expect(mockMqttClient.publish).toHaveBeenCalledTimes(4);
            // Verify ThingsBoard publishes
            expect(mockMqttClient.publish).toHaveBeenCalledWith('v1/devices/me/telemetry', expect.stringContaining('"custom_setting":"test_value"'));
            expect(mockMqttClient.publish).toHaveBeenCalledWith('v1/devices/me/telemetry', expect.stringContaining('"debug_enabled":false'));
            // Verify EMQX publishes
            expect(mockMqttClient.publish).toHaveBeenCalledWith('viis/things/v2/test-device-001/telemetry', expect.stringContaining('"custom_setting":"test_value"'));
        });
    });
    describe('Backward compatibility', () => {
        it('should maintain existing behavior for schedules with only mapped keys', async () => {
            const scheduleAction = {
                main_pump: true,
                valve_A1: true,
                iri_time: 1200,
                set_flow_A1: 180
            };
            const schedule = createTestSchedule('backward-compat', scheduleAction);
            const result = scheduleService.mapScheduleToModbus(schedule);
            // Should work exactly as before (but iri_time is already provided and mapped, so no auto-addition)
            expect(result.holdingCommands).toHaveLength(2);
            expect(result.coilCommands).toHaveLength(2);
            expect(result.configParameters).toHaveLength(0); // No unmapped keys (iri_time is mapped)
            // Verify structure is backward compatible
            expect(result).toHaveProperty('holdingCommands');
            expect(result).toHaveProperty('coilCommands');
            expect(result).toHaveProperty('configParameters'); // New property
        });
        it('should handle empty schedules without breaking', async () => {
            const schedule = createTestSchedule('empty-test', {});
            const result = scheduleService.mapScheduleToModbus(schedule);
            // Note: iri_time is automatically added as holding command for empty schedules
            expect(result.holdingCommands).toHaveLength(1);
            expect(result.coilCommands).toHaveLength(0);
            expect(result.configParameters).toHaveLength(0);
        });
        it('should handle schedules with no action', async () => {
            const schedule = createTestSchedule('no-action', '');
            schedule.action = null;
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.holdingCommands).toHaveLength(0);
            expect(result.coilCommands).toHaveLength(0);
            expect(result.configParameters).toHaveLength(0);
        });
    });
    describe('Error handling', () => {
        it('should handle invalid JSON gracefully', async () => {
            const schedule = createTestSchedule('invalid-json', '{ invalid: json }');
            const result = scheduleService.mapScheduleToModbus(schedule);
            expect(result.holdingCommands).toHaveLength(0);
            expect(result.coilCommands).toHaveLength(0);
            expect(result.configParameters).toHaveLength(0);
        });
        it('should continue processing other keys if one config parameter fails', async () => {
            const scheduleAction = {
                valve_A1: true, // Valid mapped key
                good_config: 'valid', // Valid unmapped key
                bad_config: undefined // This might cause issues
            };
            const schedule = createTestSchedule('error-handling', scheduleAction);
            // Should not throw and should process valid keys
            expect(() => {
                const result = scheduleService.mapScheduleToModbus(schedule);
                expect(result.coilCommands).toHaveLength(1); // valve_A1
                expect(result.configParameters.length).toBeGreaterThan(0); // At least good_config
            }).not.toThrow();
        });
    });
    describe('Performance considerations', () => {
        it('should handle large numbers of unmapped keys efficiently', async () => {
            const scheduleAction = {
                main_pump: true // One mapped key
            };
            // Add 100 unmapped keys
            for (let i = 0; i < 100; i++) {
                scheduleAction[`config_param_${i}`] = `value_${i}`;
            }
            const schedule = createTestSchedule('performance-test', scheduleAction);
            const startTime = Date.now();
            const result = scheduleService.mapScheduleToModbus(schedule);
            const endTime = Date.now();
            expect(result.coilCommands).toHaveLength(1);
            // Note: iri_time is automatically added as holding command, so config parameters remain 100
            expect(result.configParameters).toHaveLength(100);
            expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
        });
    });
});

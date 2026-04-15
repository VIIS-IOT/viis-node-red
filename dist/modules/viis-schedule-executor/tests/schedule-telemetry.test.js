"use strict";
/**
 * Test cases for schedule telemetry publishing:
 * - Telemetry is published on schedule start with all Modbus keys
 * - Telemetry is published on schedule finish with reset keys and config values
 * - Deduplication prevents duplicate publishes within 5 seconds
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
// Use a plain object as our mock global context
let globalStore = {};
function resetGlobalStore() {
    globalStore = {
        configKeyValues: {},
        scheduleConfigKeys: {},
        activeModbusCommands: {},
    };
}
const mockNode = {
    context: () => ({
        global: {
            get: (key) => globalStore[key],
            set: (key, value) => { globalStore[key] = value; }
        }
    }),
    warn: jest.fn()
};
// Mock MQTT client
const createMockMqttClient = () => ({
    publish: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    waitForConnection: jest.fn().mockResolvedValue(true),
    disconnect: jest.fn().mockResolvedValue(undefined),
});
// Helper to create service with fresh mocks
function createService() {
    const service = new viis_schedule_executor_service_1.ScheduleService(mockNode);
    // Override globalHelper
    Object.defineProperty(service, 'globalHelper', {
        value: {
            getJsonEnvVar: (key, defaultValue) => {
                if (key === 'MODBUS_COILS')
                    return {
                        'pump_air': 0,
                        'valve_1': 1,
                        'valve_2': 2
                    };
                if (key === 'MODBUS_HOLDING_REGISTERS')
                    return {
                        'set_ec': 16,
                        'set_ph': 17,
                        'control_mode': 0
                    };
                return defaultValue;
            },
            getEnvVar: (key, defaultValue) => {
                if (key === 'DEVICE_ID')
                    return 'test-device-001';
                return defaultValue;
            }
        },
        writable: true
    });
    return service;
}
// Mock schedule
const createMockSchedule = (name, status = 'running') => {
    return {
        name,
        action: JSON.stringify({
            pump_air: true,
            valve_1: true,
            set_ec: 2.5,
            set_ph: 6.0,
            user_id: "farmer_001"
        }),
        label: `Test Schedule ${name}`,
        device_label: 'Test Device',
        status,
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
    };
};
describe('ScheduleService - Telemetry Publishing', () => {
    let service;
    let mockThingsboardClient;
    let mockEmqxClient;
    beforeEach(() => {
        jest.clearAllMocks();
        resetGlobalStore();
        service = createService();
        mockThingsboardClient = createMockMqttClient();
        mockEmqxClient = createMockMqttClient();
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });
    describe('publishScheduleTelemetry on schedule start', () => {
        it('should publish all Modbus keys in one object on start', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            const commands = {
                holdingCommands: [
                    { key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 16, quantity: 1 },
                    { key: 'set_ph', value: 6.0, fc: 6, unitid: 1, address: 17, quantity: 1 }
                ],
                coilCommands: [
                    { key: 'pump_air', value: true, fc: 5, unitid: 1, address: 0, quantity: 1 },
                    { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 1, quantity: 1 }
                ]
            };
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'start', commands);
            // Verify both MQTT clients were called
            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(1);
            expect(mockEmqxClient.publish).toHaveBeenCalledTimes(1);
            // Verify payload structure
            const tbCall = mockThingsboardClient.publish.mock.calls[0];
            const payload = JSON.parse(tbCall[1]);
            expect(payload).toHaveProperty('ts');
            expect(payload._schedule_action).toBe('start');
            expect(payload._schedule_id).toBe('sch-1');
            expect(payload._schedule_label).toBe('Test Schedule sch-1');
            // All Modbus keys should be present
            expect(payload.set_ec).toBe(2.5);
            expect(payload.set_ph).toBe(6.0);
            expect(payload.pump_air).toBe(true);
            expect(payload.valve_1).toBe(true);
            // Should have 6 keys total (ts + _schedule_action + _schedule_id + _schedule_label + 4 data keys)
            expect(Object.keys(payload).length).toBe(8);
        });
        it('should include configKeyValues if provided', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            const commands = {
                holdingCommands: [],
                coilCommands: []
            };
            const configKeyValues = {
                user_id: 'farmer_001',
                irrigation_mode: 'automatic'
            };
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'start', commands, configKeyValues);
            const tbCall = mockThingsboardClient.publish.mock.calls[0];
            const payload = JSON.parse(tbCall[1]);
            expect(payload.user_id).toBe('farmer_001');
            expect(payload.irrigation_mode).toBe('automatic');
        });
    });
    describe('publishScheduleTelemetry on schedule finish', () => {
        it('should publish reset commands (false/0) on finish', async () => {
            const schedule = createMockSchedule('sch-1', 'finished');
            const commands = {
                holdingCommands: [
                    { key: 'set_ec', value: 0, fc: 6, unitid: 1, address: 16, quantity: 1 },
                    { key: 'set_ph', value: 0, fc: 6, unitid: 1, address: 17, quantity: 1 }
                ],
                coilCommands: [
                    { key: 'pump_air', value: false, fc: 5, unitid: 1, address: 0, quantity: 1 },
                    { key: 'valve_1', value: false, fc: 5, unitid: 1, address: 1, quantity: 1 }
                ]
            };
            const configKeyValues = {
                user_id: 0,
                irrigation_mode: 0
            };
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'end', commands, configKeyValues);
            const tbCall = mockThingsboardClient.publish.mock.calls[0];
            const payload = JSON.parse(tbCall[1]);
            expect(payload._schedule_action).toBe('end');
            // All values should be reset to 0 or false
            expect(payload.set_ec).toBe(0);
            expect(payload.set_ph).toBe(0);
            expect(payload.pump_air).toBe(false);
            expect(payload.valve_1).toBe(false);
            expect(payload.user_id).toBe(0);
            expect(payload.irrigation_mode).toBe(0);
        });
    });
    describe('telemetry deduplication', () => {
        it('should skip duplicate publish within 5 seconds', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            const commands = {
                holdingCommands: [
                    { key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 16, quantity: 1 }
                ],
                coilCommands: []
            };
            // First publish
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'start', commands);
            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(1);
            // Second publish with same data immediately
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'start', commands);
            // Should still be 1 (deduplicated)
            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(1);
        });
        it('should allow publish after 5 seconds even with same data', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            const commands = {
                holdingCommands: [
                    { key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 16, quantity: 1 }
                ],
                coilCommands: []
            };
            // First publish
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'start', commands);
            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(1);
            // Simulate time passing (6 seconds)
            jest.advanceTimersByTime(6000);
            // Second publish with same data after timeout
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'start', commands);
            // Should be 2 (not deduplicated after timeout)
            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(2);
        });
        it('should allow different data to be published immediately', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            // First publish with set_ec = 2.5
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'start', {
                holdingCommands: [
                    { key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 16, quantity: 1 }
                ],
                coilCommands: []
            });
            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(1);
            // Second publish with different value (set_ec = 3.0)
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'start', {
                holdingCommands: [
                    { key: 'set_ec', value: 3.0, fc: 6, unitid: 1, address: 16, quantity: 1 }
                ],
                coilCommands: []
            });
            // Should be 2 (different data, not deduplicated)
            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(2);
        });
        it('should track deduplication per schedule and action', async () => {
            const schedule1 = createMockSchedule('sch-1', 'running');
            const schedule2 = createMockSchedule('sch-2', 'running');
            const commands = {
                holdingCommands: [
                    { key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 16, quantity: 1 }
                ],
                coilCommands: []
            };
            // Publish start for sch-1
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule1, 'start', commands);
            // Publish start for sch-2 (different schedule, should not be deduplicated)
            await service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule2, 'start', commands);
            // Should be 2 (different schedules)
            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(2);
        });
    });
    describe('telemetry error handling', () => {
        it('should not throw error if MQTT publish fails', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            const commands = {
                holdingCommands: [],
                coilCommands: []
            };
            mockThingsboardClient.publish.mockRejectedValue(new Error('MQTT connection lost'));
            // Should not throw
            await expect(service.publishScheduleTelemetry(mockThingsboardClient, mockEmqxClient, schedule, 'start', commands)).resolves.not.toThrow();
        });
    });
});

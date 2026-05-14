"use strict";
/**
 * Test cases for schedule finish cleanup:
 * - ConfigKeyValues are RESET to falsy defaults when schedule finishes
 * - scheduleConfigKeys tracking is cleared after finish
 * - Reset values are returned for MQTT telemetry publishing
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
// Helper to create service with fresh mocks
function createService() {
    const service = new viis_schedule_executor_service_1.ScheduleService(mockNode);
    // Override globalHelper
    Object.defineProperty(service, 'globalHelper', {
        value: {
            getJsonEnvVar: (key, defaultValue) => {
                if (key === 'MODBUS_COILS')
                    return {
                        'lamp_control_1': 1,
                        'fan_control_intake': 5
                    };
                if (key === 'MODBUS_HOLDING_REGISTERS')
                    return {};
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
const createMockSchedule = (name, actionObj) => {
    const defaultAction = {
        lamp_control_1: true,
        fan_control_intake: true,
        irrigation_mode: "automatic",
        user_id: "farmer_001",
        max_duration: 3600
    };
    return {
        name,
        action: JSON.stringify(actionObj || defaultAction),
        label: `Test ${name}`,
        device_label: 'Test Device',
        status: 'running',
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
describe('ScheduleService - Finish Config Cleanup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetGlobalStore();
    });
    describe('clearScheduleConfigValues resets values to falsy defaults', () => {
        it('should store and track unmapped keys when mapping schedule', () => {
            const service = createService();
            const schedule = createMockSchedule('sch-1');
            const result = service.mapScheduleToModbus(schedule);
            // Unmapped keys should be in configParameters
            const configParamKeys = result.configParameters.map(p => p.key);
            expect(configParamKeys).toContain('irrigation_mode');
            expect(configParamKeys).toContain('user_id');
            expect(configParamKeys).toContain('max_duration');
            // Should be in global store
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('automatic');
            expect(globalStore['scheduleConfigKeys']['sch-1']).toContain('irrigation_mode');
        });
        it('should reset values to falsy defaults and clear keys when schedule finishes', () => {
            const service = createService();
            const schedule = createMockSchedule('sch-1');
            service.mapScheduleToModbus(schedule);
            // Verify stored with truthy values
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('automatic');
            expect(globalStore['configKeyValues']['user_id']).toBe('farmer_001');
            expect(globalStore['configKeyValues']['max_duration']).toBe(3600);
            // Simulate finish
            const resetValues = service.clearScheduleConfigValues('sch-1');
            // Values should be reset to falsy defaults
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe(false);
            expect(globalStore['configKeyValues']['user_id']).toBe(false);
            expect(globalStore['configKeyValues']['max_duration']).toBe(false);
            // Reset values should be returned for telemetry
            expect(resetValues).toHaveProperty('irrigation_mode');
            expect(resetValues).toHaveProperty('user_id');
            expect(resetValues).toHaveProperty('max_duration');
            // Tracking should be cleared
            expect(globalStore['scheduleConfigKeys']['sch-1']).toBeUndefined();
        });
        it('should reset values with declared types from configKeys', () => {
            // Set up declared types
            globalStore['configKeys'] = {
                'irrigation_mode': 'string',
                'max_duration': 'number',
                'enable_feature': 'boolean'
            };
            const service = createService();
            const schedule = createMockSchedule('sch-typed', {
                lamp_control_1: true,
                irrigation_mode: "automatic",
                max_duration: 3600,
                enable_feature: true
            });
            service.mapScheduleToModbus(schedule);
            // Verify stored with truthy values
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('automatic');
            expect(globalStore['configKeyValues']['max_duration']).toBe(3600);
            expect(globalStore['configKeyValues']['enable_feature']).toBe(true);
            // Simulate finish
            const resetValues = service.clearScheduleConfigValues('sch-typed');
            // Values should be reset to type-appropriate falsy defaults
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('');
            expect(globalStore['configKeyValues']['max_duration']).toBe(0);
            expect(globalStore['configKeyValues']['enable_feature']).toBe(false);
            // Reset values should match
            expect(resetValues['irrigation_mode']).toBe('');
            expect(resetValues['max_duration']).toBe(0);
            expect(resetValues['enable_feature']).toBe(false);
        });
        it('should NOT affect tracking or values of other schedules', () => {
            const service = createService();
            const sch1 = createMockSchedule('sch-1');
            const sch2 = createMockSchedule('sch-2');
            service.mapScheduleToModbus(sch1);
            service.mapScheduleToModbus(sch2);
            service.clearScheduleConfigValues('sch-1');
            // sch-1 values should be reset
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe(false);
            // sch-2 tracking still exists
            expect(globalStore['scheduleConfigKeys']['sch-2']).toBeDefined();
        });
        it('should handle non-existent schedule gracefully', () => {
            const service = createService();
            const result = service.clearScheduleConfigValues('non-existent');
            expect(result).toEqual({});
        });
        it('should NOT store falsy values as config parameters', () => {
            const service = createService();
            const schedule = createMockSchedule('sch-falsy', {
                lamp_control_1: true,
                irrigation_mode: "automatic",
                debug_mode: false,
                log_level: 0,
                enable_feature: "false",
                max_retries: 5
            });
            service.mapScheduleToModbus(schedule);
            const trackedKeys = globalStore['scheduleConfigKeys']['sch-falsy'] || [];
            expect(trackedKeys).toContain('irrigation_mode');
            expect(trackedKeys).toContain('max_retries');
            expect(trackedKeys).not.toContain('debug_mode');
            expect(trackedKeys).not.toContain('log_level');
            expect(trackedKeys).not.toContain('enable_feature');
        });
        it('should simulate complete lifecycle: start → store → finish (reset) → next schedule overwrites', () => {
            const service = createService();
            // START - schedule runs and sets truthy values
            const sch = createMockSchedule('irrigation');
            service.mapScheduleToModbus(sch);
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('automatic');
            expect(globalStore['scheduleConfigKeys']['irrigation']).toBeDefined();
            // FINISH - values reset to falsy, keys cleared
            const resetValues = service.clearScheduleConfigValues('irrigation');
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe(false);
            expect(globalStore['scheduleConfigKeys']['irrigation']).toBeUndefined();
            expect(resetValues['irrigation_mode']).toBe(false);
            // NEW SCHEDULE - can overwrite with new truthy value
            const newSch = createMockSchedule('new', {
                lamp_control_1: true,
                irrigation_mode: "manual"
            });
            service.mapScheduleToModbus(newSch);
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('manual');
        });
    });
});

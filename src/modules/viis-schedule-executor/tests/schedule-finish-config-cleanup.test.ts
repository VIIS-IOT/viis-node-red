/**
 * Test cases for schedule finish cleanup:
 * - ConfigKeyValues are PRESERVED when schedule finishes (keys are NOT deleted)
 * - scheduleConfigKeys tracking is preserved after finish
 */

import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';

// Use a plain object as our mock global context
let globalStore: Record<string, any> = {};

function resetGlobalStore() {
    globalStore = {
        configKeyValues: {},
        scheduleConfigKeys: {},
        activeModbusCommands: {},
    };
}

const mockNode: Node = {
    context: () => ({
        global: {
            get: (key: string) => globalStore[key],
            set: (key: string, value: any) => { globalStore[key] = value; }
        }
    }),
    warn: jest.fn()
} as unknown as Node;

// Helper to create service with fresh mocks
function createService(): ScheduleService {
    const service = new ScheduleService(mockNode);

    // Override globalHelper
    Object.defineProperty(service, 'globalHelper', {
        value: {
            getJsonEnvVar: (key: string, defaultValue: any) => {
                if (key === 'MODBUS_COILS') return {
                    'lamp_control_1': 1,
                    'fan_control_intake': 5
                };
                if (key === 'MODBUS_HOLDING_REGISTERS') return {};
                return defaultValue;
            },
            getEnvVar: (key: string, defaultValue: any) => {
                if (key === 'DEVICE_ID') return 'test-device-001';
                return defaultValue;
            }
        },
        writable: true
    });

    return service;
}

// Mock schedule
const createMockSchedule = (name: string, actionObj?: Record<string, any>): TabiotSchedule => {
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
    } as TabiotSchedule;
};

describe('ScheduleService - Finish Config Cleanup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetGlobalStore();
    });

    describe('clearScheduleConfigValues preserves values and keeps keys', () => {
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

        it('should preserve values and KEEP keys when schedule finishes', () => {
            const service = createService();
            const schedule = createMockSchedule('sch-1');
            service.mapScheduleToModbus(schedule);

            // Verify stored with truthy values
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('automatic');
            expect(globalStore['configKeyValues']['user_id']).toBe('farmer_001');
            expect(globalStore['configKeyValues']['max_duration']).toBe(3600);

            // Simulate finish
            service.clearScheduleConfigValues('sch-1');

            // Values should be preserved, and keys should STILL exist
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('automatic');
            expect(globalStore['configKeyValues']['user_id']).toBe('farmer_001');
            expect(globalStore['configKeyValues']['max_duration']).toBe(3600);

            // Tracking should be preserved (NOT deleted)
            expect(globalStore['scheduleConfigKeys']['sch-1']).toBeDefined();
            expect(globalStore['scheduleConfigKeys']['sch-1']).toContain('irrigation_mode');
        });

        it('should NOT affect tracking or values of other schedules', () => {
            const service = createService();
            const sch1 = createMockSchedule('sch-1');
            const sch2 = createMockSchedule('sch-2');

            service.mapScheduleToModbus(sch1);
            service.mapScheduleToModbus(sch2);

            const preservedMode = globalStore['configKeyValues']['irrigation_mode'];

            service.clearScheduleConfigValues('sch-1');

            // Values remain preserved
            expect(globalStore['configKeyValues']['irrigation_mode']).toBe(preservedMode);

            // sch-2 tracking still exists
            expect(globalStore['scheduleConfigKeys']['sch-2']).toBeDefined();
        });

        it('should handle non-existent schedule gracefully', () => {
            const service = createService();
            expect(() => {
                service.clearScheduleConfigValues('non-existent');
            }).not.toThrow();
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

        it('should simulate complete lifecycle: start → store → finish (preserve) → next schedule overwrites', () => {
            const service = createService();

            // START - schedule runs and sets truthy values
            const sch = createMockSchedule('irrigation');
            service.mapScheduleToModbus(sch);

            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('automatic');
            expect(globalStore['scheduleConfigKeys']['irrigation']).toBeDefined();

            // FINISH - values preserved, keys stay
            service.clearScheduleConfigValues('irrigation');

            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('automatic');
            expect(globalStore['scheduleConfigKeys']['irrigation']).toBeDefined();

            // NEW SCHEDULE - can overwrite the same key with new truthy value
            const newSch = createMockSchedule('new', {
                lamp_control_1: true,
                irrigation_mode: "manual"  // overwrites the 0
            });
            service.mapScheduleToModbus(newSch);

            expect(globalStore['configKeyValues']['irrigation_mode']).toBe('manual');
            expect(globalStore['configKeyValues']['max_duration']).toBe(3600); // old key preserved until explicitly overwritten
        });

        it('should preserve mode values during overlap boundary to avoid auto/manual flicker', () => {
            const service = createService();

            const schA = createMockSchedule('sch-a', {
                lamp_control_1: true,
                set_mode_fan: 1,
                set_auto_mode_fan: 1
            });

            const schB = createMockSchedule('sch-b', {
                lamp_control_1: true,
                set_mode_fan: 1,
                set_auto_mode_fan: 1
            });

            service.mapScheduleToModbus(schA);
            expect(globalStore['configKeyValues']['set_auto_mode_fan']).toBe(1);

            // Schedule A finishes at boundary; values must remain stable.
            service.clearScheduleConfigValues('sch-a');
            expect(globalStore['configKeyValues']['set_auto_mode_fan']).toBe(1);

            // Schedule B starts and writes same mode values, no transient 0 expected.
            service.mapScheduleToModbus(schB);
            expect(globalStore['configKeyValues']['set_auto_mode_fan']).toBe(1);
        });
    });
});

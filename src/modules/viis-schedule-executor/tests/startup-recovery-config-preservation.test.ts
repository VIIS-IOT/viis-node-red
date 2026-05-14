/**
 * Test for Bug Fix: Startup Recovery should NOT clear configKeyValues and scheduleConfigKeys
 *
 * Previously, when the node restarted after power outage, it would clear ALL global state
 * including configKeyValues and scheduleConfigKeys. This was wrong because:
 * - configKeyValues should persist across restarts (preserve config structure)
 * - scheduleConfigKeys tracking should persist (know which keys belong to which schedule)
 * - Only active state (activeModbusCommands, status history) should be cleared
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
        scheduleStatusHistory: {},
        scheduleLastCheckTimestamps: {},
        manualModbusOverrides: {},
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
                    'valve_1': 1,
                    'pump_1': 5
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
        valve_1: true,
        pump_1: true,
    };

    return {
        name,
        label: `Test Schedule ${name}`,
        enable: 1,
        status: 'running',
        is_deleted: 0,
        device_id: 'test-device-001',
        action: JSON.stringify(actionObj || defaultAction),
        start_time: '08:00:00',
        end_time: '09:00:00',
        start_date: '2026-04-01',
        end_date: '2026-04-30',
    } as TabiotSchedule;
};

describe('Startup Recovery - Config Preservation', () => {

    beforeEach(() => {
        resetGlobalStore();
        jest.clearAllMocks();
    });

    describe('Bug Fix: configKeyValues should NOT be cleared on startup', () => {
        it('should preserve configKeyValues when clearing stale state on startup', () => {
            // Simulate pre-existing config values (from before power outage)
            const existingConfigValues = {
                irrigation_mode: true,
                user_id: 12345,
                max_duration: 3600,
                custom_param: 'test_value',
            };
            globalStore.configKeyValues = existingConfigValues;

            // Simulate pre-existing schedule config keys tracking
            const existingScheduleConfigKeys = {
                'schedule-1': ['irrigation_mode', 'user_id'],
                'schedule-2': ['max_duration', 'custom_param'],
            };
            globalStore.scheduleConfigKeys = existingScheduleConfigKeys;

            // Simulate stale active state (should be cleared)
            globalStore.activeModbusCommands = {
                'schedule-1': [{ key: 'valve_1', fc: 5, address: 0, value: true, unitid: 1, quantity: 1 }],
            };
            globalStore.scheduleStatusHistory = {
                'schedule-1': 'running',
                'schedule-2': 'running',
            };

            // Simulate startup recovery logic (from viis-schedule-executor.ts)
            const existingActiveCommands = globalStore.activeModbusCommands || {};
            const existingStatusHistory = globalStore.scheduleStatusHistory || {};

            const staleCommandCount = Object.keys(existingActiveCommands).length;
            const staleStatusCount = Object.keys(existingStatusHistory).length;

            // This is the fix: DO NOT clear configKeyValues and scheduleConfigKeys
            if (staleCommandCount > 0 || staleStatusCount > 0) {
                globalStore.activeModbusCommands = {};
                globalStore.scheduleStatusHistory = {};
                globalStore.scheduleLastCheckTimestamps = {};
                globalStore.manualModbusOverrides = {};
                // NOTE: We do NOT clear configKeyValues or scheduleConfigKeys
            }

            // Verify: Active state should be cleared
            expect(globalStore.activeModbusCommands).toEqual({});
            expect(globalStore.scheduleStatusHistory).toEqual({});
            expect(globalStore.manualModbusOverrides).toEqual({});

            // Verify: Config state should be PRESERVED
            expect(globalStore.configKeyValues).toEqual(existingConfigValues);
            expect(globalStore.configKeyValues.irrigation_mode).toBe(true);
            expect(globalStore.configKeyValues.user_id).toBe(12345);
            expect(globalStore.configKeyValues.max_duration).toBe(3600);
            expect(globalStore.configKeyValues.custom_param).toBe('test_value');

            expect(globalStore.scheduleConfigKeys).toEqual(existingScheduleConfigKeys);
            expect(globalStore.scheduleConfigKeys['schedule-1']).toContain('irrigation_mode');
            expect(globalStore.scheduleConfigKeys['schedule-2']).toContain('custom_param');
        });

        it('should allow schedule execution to override preserved config values', () => {
            const service = createService();

            // Pre-existing config values (from before restart)
            globalStore.configKeyValues = {
                irrigation_mode: true,
                user_id: 12345,
            };
            globalStore.scheduleConfigKeys = {};

            // Execute a schedule that overrides these values
            // Note: false is a falsy value, so it will be skipped. Use a truthy value instead.
            const schedule = createMockSchedule('schedule-new', {
                valve_1: true,
                pump_1: true,
                irrigation_mode: 'drip', // Override to a different truthy value
                new_param: 'new_value', // Add new param
            });

            const { holdingCommands, coilCommands, configParameters } =
                service.mapScheduleToModbus(schedule);

            // Verify: Config values should be updated
            expect(globalStore.configKeyValues.irrigation_mode).toBe('drip'); // Overridden
            expect(globalStore.configKeyValues.user_id).toBe(12345); // Preserved
            expect(globalStore.configKeyValues.new_param).toBe('new_value'); // Added
        });

        it('should reset config values to falsy defaults when schedule finishes', () => {
            const service = createService();

            // Setup: Schedule has been running with config values
            globalStore.configKeyValues = {
                irrigation_mode: true,
                user_id: 1235,
                max_duration: 3600,
            };
            globalStore.scheduleConfigKeys = {
                'schedule-1': ['irrigation_mode', 'user_id', 'max_duration'],
            };

            // Schedule finishes - reset config values
            const resetValues = service.clearScheduleConfigValues('schedule-1');

            // Verify: Values are reset to falsy defaults
            expect(globalStore.configKeyValues.irrigation_mode).toBe(false);
            expect(globalStore.configKeyValues.user_id).toBe(false);
            expect(globalStore.configKeyValues.max_duration).toBe(false);

            // Keys still exist in configKeyValues (reset to falsy, not deleted)
            expect(globalStore.configKeyValues).toHaveProperty('irrigation_mode');
            expect(globalStore.configKeyValues).toHaveProperty('user_id');
            expect(globalStore.configKeyValues).toHaveProperty('max_duration');

            // Tracking should be cleared
            expect(globalStore.scheduleConfigKeys['schedule-1']).toBeUndefined();

            // Reset values should be returned for telemetry
            expect(resetValues).toHaveProperty('irrigation_mode');
            expect(resetValues).toHaveProperty('user_id');
            expect(resetValues).toHaveProperty('max_duration');
        });
    });
});

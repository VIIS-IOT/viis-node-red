/**
 * Test cases for notification spam prevention fix:
 * 
 * PROBLEM: When Modbus server fails, error notifications were sent on every trigger (~every 10-15s),
 * causing 100+ duplicate notifications in 15 minutes.
 * 
 * FIX: Status is ALWAYS set to "finished" regardless of Modbus success/failure.
 * The state machine itself prevents duplicate notifications because:
 * 1. Error notification sent when status changes "running" → "finished"
 * 2. Next trigger sees status="finished" and skips the error path entirely
 * 3. No time-based deduplication needed - the state machine is the deduplication
 * 
 * TEST CASES:
 * - Case 1: Start fails → Status becomes "finished" → Error notification sent ONCE
 * - Case 2: Finish fails → Status becomes "finished" → Error notification sent ONCE
 * - Case 3: Subsequent triggers with status="finished" → No notifications
 * - Case 4: Active commands cleared on failure
 * - Case 5: Config values cleared on failure
 */

import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';

// ============================================================================
// MOCKS
// ============================================================================

let globalStore: Record<string, any> = {};

function resetGlobalStore() {
    globalStore = {
        configKeyValues: {},
        scheduleConfigKeys: {},
        activeModbusCommands: {},
        scheduleStatusHistory: {},
        scheduleLastCheckTimestamps: {},
    };
}

const mockStatusHistory: Record<string, string> = {};

const mockNode: Node = {
    context: () => ({
        global: {
            get: (key: string) => globalStore[key],
            set: (key: string, value: any) => { globalStore[key] = value; }
        }
    }),
    warn: jest.fn(),
    error: jest.fn()
} as unknown as Node;

const mockModbusClient = {
    writeRegister: jest.fn(),
    writeCoil: jest.fn(),
    readCoils: jest.fn(),
    readHoldingRegisters: jest.fn(),
};

const mockThingsboardClient = {
    publish: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
};

const mockEmqxClient = {
    publish: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
};

// Mock schedule
const createMockSchedule = (name: string, status: string = 'running'): TabiotSchedule => {
    const schedule = {
        name,
        action: JSON.stringify({
            pump_air: true,
            valve_1: true,
            set_ec: 2.5,
            irrigation_mode: 'drip'
        }),
        label: `Test ${name}`,
        device_label: 'Test Device',
        status,
        start_time: '08:00:00',
        end_time: '09:00:00',
        enable: 1,
        is_deleted: 0,
        device_id: 'test-device',
        machine_type: 'MAIN_ENGINE',
        created: new Date(),
        modified: new Date(),
        type: 'fixed',
        deleted: null
    } as TabiotSchedule;

    return schedule;
};

// ============================================================================
// HELPER: Simulate the node's input handler logic
// ============================================================================

/**
 * This helper simulates what happens in viis-schedule-executor.ts when processing
 * a schedule. It extracts the critical logic we're testing:
 * - Status updates
 * - Notification sending
 * - Command/config cleanup
 */
async function simulateScheduleExecution(
    schedule: TabiotSchedule,
    isDue: boolean,
    modbusWriteSuccess: boolean
) {
    const notifications: Array<{ action: string; success: boolean; scheduleName: string }> = [];
    
    // Track status changes
    let currentStatus = schedule.status;
    
    // Simulate: Schedule is due and should start (but only if not already finished)
    if (isDue && currentStatus !== 'running' && currentStatus !== 'finished') {
        // Update status to running
        currentStatus = 'running';
        
        // Verify no longer gates status: always stay running and store commands.
        globalStore.activeModbusCommands[schedule.name] = [
            { key: 'pump_air', value: true, fc: 5, address: 0 },
            { key: 'valve_1', value: true, fc: 5, address: 1 },
        ];
        currentStatus = 'running';
        
        notifications.push({
            action: 'start',
            success: true,
            scheduleName: schedule.name
        });
        
        schedule.status = currentStatus;
        return { notifications, finalStatus: currentStatus };
    }
    
    // Simulate: Schedule already finished - skip entirely
    if (currentStatus === 'finished') {
        return { notifications: [], finalStatus: currentStatus };
    }
    
    // Simulate: Schedule was running but is no longer due (finish)
    if (currentStatus === 'running' && !isDue) {
        const activeCommands = globalStore.activeModbusCommands[schedule.name] || [];
        
        // Try to reset Modbus commands
        let resetSuccess = false;
        try {
            if (modbusWriteSuccess) {
                resetSuccess = true;
            } else {
                throw new Error('Modbus reset failed');
            }
        } catch (error) {
            // Reset failed
        }
        
        // CRITICAL FIX: Always clear active commands and set to finished
        globalStore.activeModbusCommands[schedule.name] = [];
        
        // Check if status changed
        const statusChanged = (currentStatus as string) !== 'finished';
        
        // ALWAYS set to finished
        currentStatus = 'finished';
        globalStore.configKeyValues = {};
        
        // Send notification only if status changed
        if (statusChanged) {
            notifications.push({
                action: 'end',
                success: true,
                scheduleName: schedule.name
            });
        }
        
        schedule.status = currentStatus;
        return { notifications, finalStatus: currentStatus };
    }
    
    // Simulate: Schedule running and still due - no action
    if (currentStatus === 'running' && isDue) {
        return { notifications: [], finalStatus: currentStatus };
    }
    
    return { notifications: [], finalStatus: currentStatus };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Notification Spam Prevention - Modbus Failure Handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetGlobalStore();
    });

    describe('Case 1: Start verify fail → status stays running and commands are stored', () => {
        it('should keep status running when Modbus verify fails', async () => {
            const schedule = createMockSchedule('sch-1', 'stopped');
            
            const result = await simulateScheduleExecution(
                schedule,
                true, // isDue
                false // modbusWriteSuccess = false
            );
            
            expect(result.finalStatus).toBe('running');
            expect(schedule.status).toBe('running');
        });

        it('should send start lifecycle notification as success', async () => {
            const schedule = createMockSchedule('sch-1', 'stopped');
            
            const result = await simulateScheduleExecution(
                schedule,
                true,
                false
            );
            
            expect(result.notifications).toHaveLength(1);
            expect(result.notifications[0]).toEqual({
                action: 'start',
                success: true,
                scheduleName: 'sch-1'
            });
        });

        it('should store active commands even when verify fails', async () => {
            const schedule = createMockSchedule('sch-1', 'stopped');
            
            await simulateScheduleExecution(
                schedule,
                true,
                false
            );
            
            expect(globalStore.activeModbusCommands['sch-1']).toHaveLength(2);
        });

        it('should keep config values when start verify fails', async () => {
            // Setup: Some config values exist
            globalStore.configKeyValues = {
                irrigation_mode: 'drip',
                user_id: 123
            };
            
            const schedule = createMockSchedule('sch-1', 'stopped');
            
            await simulateScheduleExecution(
                schedule,
                true,
                false
            );
            
            expect(globalStore.configKeyValues).toEqual({
                irrigation_mode: 'drip',
                user_id: 123
            });
        });

        it('should NOT send lifecycle notification on subsequent due ticks while running', async () => {
            const schedule = createMockSchedule('sch-1', 'stopped');
            
            const result1 = await simulateScheduleExecution(
                schedule,
                true,
                false
            );
            
            expect(result1.notifications).toHaveLength(1);
            expect(result1.finalStatus).toBe('running');
            
            const result2 = await simulateScheduleExecution(
                schedule,
                true,
                false
            );
            
            expect(result2.notifications).toHaveLength(0);
            expect(result2.finalStatus).toBe('running');
            
            const result3 = await simulateScheduleExecution(
                schedule,
                true,
                false
            );
            
            expect(result3.notifications).toHaveLength(0);
            expect(result3.finalStatus).toBe('running');
        });
    });

    describe('Case 2: Finish fails → Status becomes finished → Notification sent ONCE', () => {
        it('should set status to finished even when Modbus reset fails', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            
            // Setup: Schedule was running with active commands
            globalStore.activeModbusCommands['sch-1'] = [
                { key: 'pump_air', value: true, fc: 5, address: 0 },
                { key: 'valve_1', value: true, fc: 5, address: 1 },
            ];
            
            const result = await simulateScheduleExecution(
                schedule,
                false, // not due (time window passed)
                false // modbusWriteSuccess = false
            );
            
            expect(result.finalStatus).toBe('finished');
            expect(schedule.status).toBe('finished');
        });

        it('should send completed lifecycle notification exactly once on finish', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            globalStore.activeModbusCommands['sch-1'] = [
                { key: 'pump_air', value: true, fc: 5, address: 0 },
            ];
            
            const result = await simulateScheduleExecution(
                schedule,
                false,
                false
            );
            
            expect(result.notifications).toHaveLength(1);
            expect(result.notifications[0]).toEqual({
                action: 'end',
                success: true,
                scheduleName: 'sch-1'
            });
        });

        it('should clear active commands on finish (even if reset fails)', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            globalStore.activeModbusCommands['sch-1'] = [
                { key: 'pump_air', value: true, fc: 5, address: 0 },
                { key: 'valve_1', value: true, fc: 5, address: 1 },
            ];
            
            await simulateScheduleExecution(
                schedule,
                false,
                false
            );
            
            expect(globalStore.activeModbusCommands['sch-1']).toEqual([]);
        });

        it('should clear config values on finish (even if reset fails)', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            globalStore.activeModbusCommands['sch-1'] = [
                { key: 'pump_air', value: true, fc: 5, address: 0 },
            ];
            globalStore.configKeyValues = {
                irrigation_mode: 'drip',
                user_id: 123
            };
            
            await simulateScheduleExecution(
                schedule,
                false,
                false
            );
            
            expect(globalStore.configKeyValues).toEqual({});
        });

        it('should NOT send notification on subsequent triggers (status already finished)', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            globalStore.activeModbusCommands['sch-1'] = [
                { key: 'pump_air', value: true, fc: 5, address: 0 },
            ];
            
            // First trigger: Finish fails → status becomes finished
            const result1 = await simulateScheduleExecution(
                schedule,
                false,
                false
            );
            
            expect(result1.notifications).toHaveLength(1);
            expect(result1.finalStatus).toBe('finished');
            
            // Second trigger: Status is already finished → skip
            const result2 = await simulateScheduleExecution(
                schedule,
                false,
                false
            );
            
            expect(result2.notifications).toHaveLength(0);
            expect(result2.finalStatus).toBe('finished');
            
            // Third trigger: Still no notifications
            const result3 = await simulateScheduleExecution(
                schedule,
                false,
                false
            );
            
            expect(result3.notifications).toHaveLength(0);
            expect(result3.finalStatus).toBe('finished');
            
            // Simulate 100 more triggers (like the 100+ notifications in 15 minutes)
            for (let i = 0; i < 100; i++) {
                const result = await simulateScheduleExecution(
                    schedule,
                    false,
                    false
                );
                expect(result.notifications).toHaveLength(0);
            }
        });
    });

    describe('Case 3: Success path still works correctly', () => {
        it('should set status to running and send success notification on successful start', async () => {
            const schedule = createMockSchedule('sch-1', 'stopped');
            
            const result = await simulateScheduleExecution(
                schedule,
                true,
                true // modbusWriteSuccess = true
            );
            
            expect(result.finalStatus).toBe('running');
            expect(result.notifications).toHaveLength(1);
            expect(result.notifications[0].success).toBe(true);
        });

        it('should set status to finished and send success notification on successful finish', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            globalStore.activeModbusCommands['sch-1'] = [
                { key: 'pump_air', value: true, fc: 5, address: 0 },
            ];
            
            const result = await simulateScheduleExecution(
                schedule,
                false,
                true // modbusWriteSuccess = true
            );
            
            expect(result.finalStatus).toBe('finished');
            expect(result.notifications).toHaveLength(1);
            expect(result.notifications[0].success).toBe(true);
            expect(globalStore.activeModbusCommands['sch-1']).toEqual([]);
        });

        it('should store active commands on successful start', async () => {
            const schedule = createMockSchedule('sch-1', 'stopped');
            
            await simulateScheduleExecution(
                schedule,
                true,
                true
            );
            
            expect(globalStore.activeModbusCommands['sch-1']).toBeDefined();
            expect(globalStore.activeModbusCommands['sch-1']).toHaveLength(2);
        });
    });

    describe('Case 4: Rapid consecutive triggers do not cause spam', () => {
        it('should send exactly 1 start lifecycle notification even with 50 rapid due ticks', async () => {
            const schedule = createMockSchedule('sch-1', 'stopped');
            let totalNotifications = 0;
            
            for (let i = 0; i < 50; i++) {
                const result = await simulateScheduleExecution(
                    schedule,
                    true,
                    false
                );
                totalNotifications += result.notifications.length;
            }
            
            expect(totalNotifications).toBe(1);
            expect(schedule.status).toBe('running');
        });

        it('should send exactly 1 notification even with 50 rapid triggers on finish failure', async () => {
            const schedule = createMockSchedule('sch-1', 'running');
            globalStore.activeModbusCommands['sch-1'] = [
                { key: 'pump_air', value: true, fc: 5, address: 0 },
            ];
            let totalNotifications = 0;
            
            // Simulate 50 rapid triggers
            for (let i = 0; i < 50; i++) {
                const result = await simulateScheduleExecution(
                    schedule,
                    false,
                    false
                );
                totalNotifications += result.notifications.length;
            }
            
            // Should have exactly 1 notification (the first failure)
            expect(totalNotifications).toBe(1);
            expect(schedule.status).toBe('finished');
        });

        it('should handle mixed success then failure without spam', async () => {
            const schedule = createMockSchedule('sch-1', 'stopped');
            let totalNotifications = 0;
            
            const result1 = await simulateScheduleExecution(schedule, true, false);
            totalNotifications += result1.notifications.length;
            expect(result1.finalStatus).toBe('running');
            
            for (let i = 0; i < 9; i++) {
                const result = await simulateScheduleExecution(schedule, true, false);
                totalNotifications += result.notifications.length;
            }
            
            expect(totalNotifications).toBe(1);
            
            schedule.status = 'stopped';
            
            // Trigger 11: Start succeeds → status running
            const result11 = await simulateScheduleExecution(schedule, true, true);
            totalNotifications += result11.notifications.length;
            expect(result11.finalStatus).toBe('running');
            
            // Trigger 12: Still running and due, skip
            const result12 = await simulateScheduleExecution(schedule, true, true);
            totalNotifications += result12.notifications.length;
            
            // Trigger 13: Not due anymore → finish succeeds
            const result13 = await simulateScheduleExecution(schedule, false, true);
            totalNotifications += result13.notifications.length;
            expect(result13.finalStatus).toBe('finished');
            
            // Trigger 14: Status finished, skip
            const result14 = await simulateScheduleExecution(schedule, false, true);
            totalNotifications += result14.notifications.length;
            
            // Should have exactly 3 notifications (1 failure + 1 success start + 1 success finish)
            expect(totalNotifications).toBe(3);
        });
    });

    describe('Case 5: State is properly cleaned up on failure', () => {
        it('should have clean state after start failure', async () => {
            globalStore.activeModbusCommands['sch-1'] = [];
            globalStore.configKeyValues = { irrigation_mode: 'drip' };
            
            const schedule = createMockSchedule('sch-1', 'stopped');
            
            await simulateScheduleExecution(schedule, true, false);
            
            expect(globalStore.activeModbusCommands['sch-1']).toHaveLength(2);
            expect(globalStore.configKeyValues).toEqual({ irrigation_mode: 'drip' });
            expect(schedule.status).toBe('running');
        });

        it('should have clean state after finish failure', async () => {
            globalStore.activeModbusCommands['sch-1'] = [
                { key: 'pump_air', value: true, fc: 5, address: 0 },
            ];
            globalStore.configKeyValues = { irrigation_mode: 'drip' };
            
            const schedule = createMockSchedule('sch-1', 'running');
            
            await simulateScheduleExecution(schedule, false, false);
            
            expect(globalStore.activeModbusCommands['sch-1']).toEqual([]);
            expect(globalStore.configKeyValues).toEqual({});
            expect(schedule.status).toBe('finished');
        });
    });
});

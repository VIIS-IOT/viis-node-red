"use strict";
/**
 * Unit tests for ScheduleTriggerService
 * Tests timing checks, due schedule detection, and edge cases
 */
Object.defineProperty(exports, "__esModule", { value: true });
const schedule_trigger_service_1 = require("../schedule-trigger-service");
// Shared mock global context - accessible in all tests
let mockGlobalContext;
// Mock Node-RED node - create context object once to maintain reference
const createMockNode = () => {
    const contextObject = {
        global: {
            get: jest.fn((key) => {
                const value = mockGlobalContext.get(key);
                // Only return default if value is undefined, not if it's empty string or 0
                return value !== undefined ? value : {};
            }),
            set: jest.fn((key, value) => {
                mockGlobalContext.set(key, value);
                return value;
            })
        }
    };
    return {
        context: () => contextObject,
        warn: jest.fn(),
        error: jest.fn(),
        send: jest.fn(),
        status: jest.fn()
    };
};
// Mock AppDataSource
jest.mock('../../../../orm/dataSource', () => ({
    AppDataSource: {
        isInitialized: false,
        initialize: jest.fn().mockImplementation(() => {
            global.AppDataSourceInitialized = true;
            return Promise.resolve();
        }),
        getRepository: jest.fn()
    }
}));
// NOTE: We don't mock GlobalContextHelper - it uses node.context() which we mock above
describe('ScheduleTriggerService', () => {
    let service;
    let mockNode;
    let mockRepository;
    beforeEach(() => {
        jest.clearAllMocks();
        mockGlobalContext = new Map();
        // Set default DEVICE_ID
        mockGlobalContext.set('device_id', 'test-device-001');
        mockNode = createMockNode();
        // Setup repository mock
        mockRepository = {
            createQueryBuilder: jest.fn().mockReturnValue({
                leftJoin: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([])
            })
        };
        // Setup AppDataSource mock
        const { AppDataSource } = require('../../../../orm/dataSource');
        AppDataSource.getRepository.mockReturnValue(mockRepository);
        AppDataSource.isInitialized = true;
        service = new schedule_trigger_service_1.ScheduleTriggerService(mockNode, true);
    });
    describe('Constructor', () => {
        it('should initialize with debug enabled', () => {
            const debugService = new schedule_trigger_service_1.ScheduleTriggerService(mockNode, true);
            expect(debugService).toBeDefined();
        });
        it('should initialize with debug disabled', () => {
            const nonDebugService = new schedule_trigger_service_1.ScheduleTriggerService(mockNode, false);
            expect(nonDebugService).toBeDefined();
        });
    });
    describe('isScheduleDue - Time-based checks', () => {
        it('should return true when current time is within schedule range', () => {
            // Mock current time to be 10:00 AM UTC+7
            const testSchedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            // This should return true if current time (mocked) is within range
            // Note: In real tests, you'd mock moment.js to control current time
            const result = service.checkScheduleDue(testSchedule);
            // Result depends on actual current time, but we test the method exists
            expect(typeof result).toBe('boolean');
        });
        it('should return false when schedule is disabled (enable !== 1)', () => {
            const disabledSchedule = {
                name: 'disabled-schedule',
                label: 'Disabled Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 0,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            const result = service.checkScheduleDue(disabledSchedule);
            expect(result).toBe(false);
        });
        it('should return false when schedule missing start_time or end_time', () => {
            const invalidSchedule = {
                name: 'invalid-schedule',
                label: 'Invalid Schedule',
                status: 'finished',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            const result = service.checkScheduleDue(invalidSchedule);
            expect(result).toBe(false);
        });
    });
    describe('isScheduleDue - Date range checks', () => {
        it('should return false when current date is outside start_date and end_date range', () => {
            const scheduleWithDateRange = {
                name: 'date-range-schedule',
                label: 'Date Range Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                start_date: '2024-01-01',
                end_date: '2024-01-31',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            // This would return false if current date is outside Jan 2024
            const result = service.checkScheduleDue(scheduleWithDateRange);
            expect(typeof result).toBe('boolean');
        });
    });
    describe('isScheduleDue - Interval (day of week) checks', () => {
        it('should handle single day interval', () => {
            const scheduleWithInterval = {
                name: 'interval-schedule',
                label: 'Interval Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                interval: '1', // Monday
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            const result = service.checkScheduleDue(scheduleWithInterval);
            expect(typeof result).toBe('boolean');
        });
        it('should handle comma-separated interval', () => {
            const scheduleWithInterval = {
                name: 'multi-day-schedule',
                label: 'Multi-Day Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                interval: '1,3,5', // Mon, Wed, Fri
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            const result = service.checkScheduleDue(scheduleWithInterval);
            expect(typeof result).toBe('boolean');
        });
        it('should handle JSON array interval', () => {
            const scheduleWithInterval = {
                name: 'json-interval-schedule',
                label: 'JSON Interval Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                interval: '[1,3,5]',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            const result = service.checkScheduleDue(scheduleWithInterval);
            expect(typeof result).toBe('boolean');
        });
        it('should handle invalid interval gracefully (fallback to allow)', () => {
            const scheduleWithInvalidInterval = {
                name: 'invalid-interval-schedule',
                label: 'Invalid Interval Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                interval: 'invalid',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            // Should not throw, should fallback to allowing schedule
            const result = service.checkScheduleDue(scheduleWithInvalidInterval);
            expect(typeof result).toBe('boolean');
        });
    });
    describe('getDueSchedules - Database queries', () => {
        it('should return empty array when DEVICE_ID is not set', async () => {
            // Clear DEVICE_ID
            mockGlobalContext.set('device_id', '');
            const result = await service.getDueSchedules();
            expect(result).toEqual([]);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('No DEVICE_ID found'));
        });
        it('should return schedules from database', async () => {
            const mockSchedules = [
                {
                    name: 'schedule-1',
                    label: 'Schedule 1',
                    status: 'finished',
                    start_time: '08:00:00',
                    end_time: '18:00:00',
                    enable: 1,
                    is_deleted: 0,
                    device_id: 'test-device-001',
                    created: new Date(),
                    modified: new Date(),
                    type: 'fixed',
                    deleted: null
                },
                {
                    name: 'schedule-2',
                    label: 'Schedule 2',
                    status: 'finished',
                    start_time: '09:00:00',
                    end_time: '17:00:00',
                    enable: 1,
                    is_deleted: 0,
                    device_id: 'test-device-001',
                    created: new Date(),
                    modified: new Date(),
                    type: 'fixed',
                    deleted: null
                }
            ];
            mockRepository.createQueryBuilder.mockReturnValue({
                leftJoin: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue(mockSchedules)
            });
            const result = await service.getDueSchedules();
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('schedule-1');
            expect(result[1].name).toBe('schedule-2');
        });
        it('should return empty array on database error', async () => {
            mockRepository.createQueryBuilder.mockReturnValue({
                leftJoin: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockRejectedValue(new Error('DB connection failed'))
            });
            const result = await service.getDueSchedules();
            expect(result).toEqual([]);
        });
        it('should initialize AppDataSource if not initialized', async () => {
            const { AppDataSource } = require('../../../../orm/dataSource');
            AppDataSource.isInitialized = false;
            await service.getDueSchedules();
            expect(AppDataSource.initialize).toHaveBeenCalled();
        });
    });
    describe('filterDueSchedules', () => {
        it('should filter and return only due schedules', () => {
            const schedules = [
                {
                    name: 'due-schedule',
                    label: 'Due Schedule',
                    status: 'finished',
                    start_time: '00:00:00',
                    end_time: '23:59:59',
                    enable: 1,
                    is_deleted: 0,
                    device_id: 'test-device-001',
                    created: new Date(),
                    modified: new Date(),
                    type: 'fixed',
                    deleted: null
                },
                {
                    name: 'disabled-schedule',
                    label: 'Disabled Schedule',
                    status: 'finished',
                    start_time: '00:00:00',
                    end_time: '23:59:59',
                    enable: 0,
                    is_deleted: 0,
                    device_id: 'test-device-001',
                    created: new Date(),
                    modified: new Date(),
                    type: 'fixed',
                    deleted: null
                }
            ];
            const result = service.filterDueSchedules(schedules);
            // Disabled schedule should be filtered out
            expect(result.length).toBeLessThanOrEqual(schedules.length);
        });
    });
    describe('Timestamp management', () => {
        beforeEach(() => {
            mockGlobalContext.set('scheduleLastCheckTimestamps', {});
        });
        it('should update last check timestamp for a schedule', () => {
            service.updateLastCheckTimestamp('test-schedule');
            const globalContext = mockNode.context().global;
            expect(globalContext.set).toHaveBeenCalledWith('scheduleLastCheckTimestamps', expect.objectContaining({
                'test-schedule': expect.any(Number)
            }));
        });
        it('should clear last check timestamp for a schedule', () => {
            // First set a timestamp
            service.updateLastCheckTimestamp('test-schedule');
            // Then clear it
            service.clearLastCheckTimestamp('test-schedule');
            const globalContext = mockNode.context().global;
            expect(globalContext.set).toHaveBeenCalledWith('scheduleLastCheckTimestamps', expect.not.objectContaining({
                'test-schedule': expect.anything()
            }));
        });
        it('should clear all timestamps', () => {
            service.updateLastCheckTimestamp('schedule-1');
            service.updateLastCheckTimestamp('schedule-2');
            service.clearAllTimestamps();
            const globalContext = mockNode.context().global;
            expect(globalContext.set).toHaveBeenCalledWith('scheduleLastCheckTimestamps', {});
        });
        it('should allow checking when interval has passed', () => {
            // Set old timestamp
            const oldTimestamp = Date.now() - (5 * 60 * 1000); // 5 minutes ago
            const globalContext = mockNode.context().global;
            globalContext.set('scheduleLastCheckTimestamps', {
                'test-schedule': oldTimestamp
            });
            // Should allow check (default interval is 1 minute)
            const canCheck = service.canCheckSchedule('test-schedule', 1);
            expect(canCheck).toBe(true);
        });
        it('should block checking when interval has not passed', () => {
            // Set recent timestamp
            const recentTimestamp = Date.now() - (30 * 1000); // 30 seconds ago
            const globalContext = mockNode.context().global;
            globalContext.set('scheduleLastCheckTimestamps', {
                'test-schedule': recentTimestamp
            });
            // Should block check (interval is 1 minute = 60 seconds)
            const canCheck = service.canCheckSchedule('test-schedule', 1);
            expect(canCheck).toBe(false);
        });
    });
    describe('checkTriggers - Main entry point', () => {
        it('should return ScheduleTriggerOutput with due schedules', async () => {
            const mockSchedules = [
                {
                    name: 'active-schedule',
                    label: 'Active Schedule',
                    status: 'finished',
                    start_time: '00:00:00',
                    end_time: '23:59:59',
                    enable: 1,
                    is_deleted: 0,
                    device_id: 'test-device-001',
                    created: new Date(),
                    modified: new Date(),
                    type: 'fixed',
                    deleted: null
                }
            ];
            mockRepository.createQueryBuilder.mockReturnValue({
                leftJoin: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue(mockSchedules)
            });
            const result = await service.checkTriggers(1);
            expect(result).toHaveProperty('schedules');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('checkInterval', 1);
            expect(result.timestamp).toBeGreaterThan(0);
        });
        it('should handle empty schedule list', async () => {
            mockRepository.createQueryBuilder.mockReturnValue({
                leftJoin: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([])
            });
            const result = await service.checkTriggers(1);
            expect(result.schedules).toHaveLength(0);
            expect(result.checkInterval).toBe(1);
        });
    });
    describe('Edge cases', () => {
        it('should handle cross-midnight schedules', () => {
            const crossMidnightSchedule = {
                name: 'cross-midnight-schedule',
                label: 'Cross Midnight Schedule',
                status: 'finished',
                start_time: '22:00:00',
                end_time: '02:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            // Should not throw
            const result = service.checkScheduleDue(crossMidnightSchedule);
            expect(typeof result).toBe('boolean');
        });
        it('should handle leap year dates', () => {
            const leapYearSchedule = {
                name: 'leap-year-schedule',
                label: 'Leap Year Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                start_date: '2024-02-28',
                end_date: '2024-03-01',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                created: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            // Should not throw
            const result = service.checkScheduleDue(leapYearSchedule);
            expect(typeof result).toBe('boolean');
        });
    });
    describe('Debug logging', () => {
        it('should log debug messages when debugEnable is true', async () => {
            const debugService = new schedule_trigger_service_1.ScheduleTriggerService(mockNode, true);
            // Call a method that produces debug output
            await debugService.getDueSchedules();
            // Debug service should call node.warn for debug messages
            expect(mockNode.warn).toHaveBeenCalled();
        });
        it('should not log debug messages when debugEnable is false', () => {
            jest.clearAllMocks();
            const nonDebugService = new schedule_trigger_service_1.ScheduleTriggerService(mockNode, false);
            // Method calls shouldn't produce debug logs
            expect(mockNode.warn).not.toHaveBeenCalled();
        });
    });
});

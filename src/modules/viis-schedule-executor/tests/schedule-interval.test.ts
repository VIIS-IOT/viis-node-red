/**
 * Unit tests for schedule interval (day of week) validation
 * Tests the isScheduleDue() method's interval checking logic
 *
 * Interval format: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
 * Supported formats: "3", "1,3,5", "[1,3,5]"
 */

import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';
import moment from 'moment';

// Mock AppDataSource
jest.mock('../../../orm/dataSource', () => ({
    AppDataSource: {
        isInitialized: true,
        initialize: jest.fn(),
        getRepository: jest.fn()
    }
}));

// Mock Node
const mockNode = {
    context: () => ({
        global: {
            get: jest.fn(),
            set: jest.fn()
        }
    }),
    warn: jest.fn(),
    error: jest.fn()
} as unknown as Node;

// Helper to create test schedule
const createTestSchedule = (overrides: Partial<TabiotSchedule> = {}): TabiotSchedule => ({
    name: 'test-schedule-001',
    action: JSON.stringify({ main_pump: "true" }),
    label: 'Test Schedule',
    device_label: 'Test Device',
    status: '',
    start_time: '08:00:00',
    end_time: '18:00:00',
    start_date: '2025-01-01',
    end_date: '2025-12-31',
    enable: 1,
    is_deleted: 0,
    device_id: 'test-device-001',
    created: new Date(),
    modified: new Date(),
    type: 'interval',
    deleted: null,
    interval: undefined, // Will be overridden
    ...overrides
} as TabiotSchedule);

describe('ScheduleService - Interval (Day of Week) Validation', () => {
    let scheduleService: ScheduleService;
    let mockGlobalContext: Map<string, any>;
    let dateNowSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        // Clear any previous Date mocks
        if (dateNowSpy) {
            dateNowSpy.mockRestore();
        }

        // Setup global context mock
        mockGlobalContext = new Map();
        (mockNode.context().global.get as jest.Mock).mockImplementation((key: string) => {
            return mockGlobalContext.get(key) || {};
        });
        (mockNode.context().global.set as jest.Mock).mockImplementation((key: string, value: any) => {
            mockGlobalContext.set(key, value);
        });

        scheduleService = new ScheduleService(mockNode, true, true); // Enable debug

        // Setup environment mocks
        Object.defineProperty(scheduleService, 'globalHelper', {
            value: {
                getJsonEnvVar: jest.fn((key: string, defaultValue: any) => defaultValue),
                getEnvVar: jest.fn((key: string, defaultValue: any) => {
                    if (key === 'DEVICE_ID') return 'test-device-001';
                    return defaultValue;
                }),
                getNumericEnvVar: jest.fn((key: string, defaultValue: number) => defaultValue)
            },
            writable: true,
            configurable: true
        });
    });

    const setSystemTime = (dateString: string) => {
        const mockDate = new Date(dateString);
        const mockTime = mockDate.getTime();

        // Mock Date.now() which moment() uses internally
        dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(mockTime);
    };

    describe('Single Day Interval', () => {
        test('should allow schedule to run on specified single day (Wednesday = 3)', () => {
            // Set system time to Wednesday 10:00 AM (2025-01-08 is Wednesday)
            setSystemTime('2025-01-08T03:00:00.000Z'); // UTC+7 = 10:00 AM

            const schedule = createTestSchedule({
                interval: '3', // Wednesday only
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            const isDue = scheduleService.isScheduleDue(schedule);

            expect(isDue).toBe(true);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('interval check passed: day 3 in [3]')
            );
        });

        test('should block schedule on different day (Thursday when interval is Wednesday)', () => {
            // Set system time to Thursday 10:00 AM (2025-01-09 is Thursday)
            setSystemTime('2025-01-09T03:00:00.000Z'); // UTC+7 = 10:00 AM

            const schedule = createTestSchedule({
                interval: '3', // Wednesday only
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            const isDue = scheduleService.isScheduleDue(schedule);

            expect(isDue).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('skipped: current day 4 not in interval [3]')
            );
        });
    });

    describe('Multiple Days Interval - Comma-separated Format', () => {
        test('should allow schedule on Monday, Wednesday, Friday (1,3,5)', () => {
            const schedule = createTestSchedule({
                interval: '1,3,5', // Mon, Wed, Fri
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            // Test Monday (2025-01-06)
            setSystemTime('2025-01-06T03:00:00.000Z');
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);

            // Test Wednesday (2025-01-08)
            setSystemTime('2025-01-08T03:00:00.000Z');
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);

            // Test Friday (2025-01-10)
            setSystemTime('2025-01-10T03:00:00.000Z');
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });

        test('should block schedule on non-specified days (Tuesday when interval is 1,3,5)', () => {
            setSystemTime('2025-01-07T03:00:00.000Z'); // Tuesday

            const schedule = createTestSchedule({
                interval: '1,3,5', // Mon, Wed, Fri
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(false);
        });
    });

    describe('Multiple Days Interval - JSON Array Format', () => {
        test('should allow schedule on days in JSON array [1,3,5]', () => {
            setSystemTime('2025-01-08T03:00:00.000Z'); // Wednesday

            const schedule = createTestSchedule({
                interval: '[1,3,5]', // JSON array format
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });

        test('should block schedule on non-specified days in JSON array', () => {
            setSystemTime('2025-01-07T03:00:00.000Z'); // Tuesday

            const schedule = createTestSchedule({
                interval: '[1,3,5]',
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(false);
        });
    });

    describe('Weekend Schedule', () => {
        test('should allow schedule on Saturday and Sunday (0,6)', () => {
            const schedule = createTestSchedule({
                interval: '0,6', // Sun, Sat
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            // Test Sunday (2025-01-05)
            setSystemTime('2025-01-05T03:00:00.000Z');
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);

            // Test Saturday (2025-01-11)
            setSystemTime('2025-01-11T03:00:00.000Z');
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });

        test('should block schedule on weekdays when interval is 0,6', () => {
            setSystemTime('2025-01-06T03:00:00.000Z'); // Monday

            const schedule = createTestSchedule({
                interval: '0,6',
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(false);
        });
    });

    describe('Everyday Schedule (All 7 Days)', () => {
        test('should allow schedule every day (0,1,2,3,4,5,6)', () => {
            const schedule = createTestSchedule({
                interval: '0,1,2,3,4,5,6',
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            const allDays = [
                '2025-01-05T03:00:00.000Z', // Sunday
                '2025-01-06T03:00:00.000Z', // Monday
                '2025-01-07T03:00:00.000Z', // Tuesday
                '2025-01-08T03:00:00.000Z', // Wednesday
                '2025-01-09T03:00:00.000Z', // Thursday
                '2025-01-10T03:00:00.000Z', // Friday
                '2025-01-11T03:00:00.000Z'  // Saturday
            ];

            allDays.forEach(day => {
                setSystemTime(day);
                expect(scheduleService.isScheduleDue(schedule)).toBe(true);
            });
        });
    });

    describe('Empty or Missing Interval', () => {
        test('should allow schedule when interval is empty string (no day restriction)', () => {
            setSystemTime('2025-01-08T03:00:00.000Z');

            const schedule = createTestSchedule({
                interval: '',
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });

        test('should allow schedule when interval is undefined (no day restriction)', () => {
            setSystemTime('2025-01-08T03:00:00.000Z');

            const schedule = createTestSchedule({
                interval: undefined,
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });

        test('should allow schedule when interval is null (no day restriction)', () => {
            setSystemTime('2025-01-08T03:00:00.000Z');

            const schedule = createTestSchedule({
                interval: null as any,
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });
    });

    describe('Invalid Interval Format', () => {
        test('should fallback to allowing schedule on invalid JSON format', () => {
            setSystemTime('2025-01-08T03:00:00.000Z');

            // Mock console.error
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            const schedule = createTestSchedule({
                interval: '[1,3,invalid]', // Invalid JSON
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Error parsing interval')
            );

            consoleErrorSpy.mockRestore();
        });

        test('should handle non-numeric values gracefully', () => {
            setSystemTime('2025-01-08T03:00:00.000Z');

            const schedule = createTestSchedule({
                interval: 'abc,def', // Non-numeric
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            // Should fallback to allowing (empty allowedDays array)
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });

        test('should handle whitespace in interval values', () => {
            setSystemTime('2025-01-08T03:00:00.000Z'); // Wednesday

            const schedule = createTestSchedule({
                interval: ' 1 , 3 , 5 ', // With whitespace
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });
    });

    describe('Real-world Use Case from Bug Report', () => {
        test('should only run on Wednesday (3) and not on Thursday (4)', () => {
            const schedule = createTestSchedule({
                name: '69c19f3600882848',
                label: 'sục phân lần 1',
                interval: '3', // Only Wednesday
                start_time: '08:55:00',
                end_time: '08:56:00',
                start_date: '2025-11-04',
                end_date: '2031-11-04',
                enable: 1
            });

            // Test Wednesday (Nov 5, 2025 is actual Wednesday) - should run
            setSystemTime('2025-11-05T01:55:30.000Z'); // UTC+7 = 08:55:30, Nov 5 = Wednesday
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);

            // Test Thursday (Nov 6, 2025 is Thursday) - should NOT run
            setSystemTime('2025-11-06T01:55:30.000Z'); // UTC+7 = 08:55:30, Nov 6 = Thursday
            expect(scheduleService.isScheduleDue(schedule)).toBe(false);

            // Test Tuesday (Nov 4, 2025 is Tuesday) - should NOT run
            setSystemTime('2025-11-04T01:55:30.000Z'); // UTC+7 = 08:55:30, Nov 4 = Tuesday
            expect(scheduleService.isScheduleDue(schedule)).toBe(false);
        });
    });

    describe('Interval + Time Range Combination', () => {
        test('should respect both interval and time range', () => {
            const schedule = createTestSchedule({
                interval: '3', // Wednesday only
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            // Wednesday but before start time - should NOT run
            setSystemTime('2025-01-08T00:59:00.000Z'); // UTC+7 = 07:59
            expect(scheduleService.isScheduleDue(schedule)).toBe(false);

            // Wednesday within time range - should run
            setSystemTime('2025-01-08T05:00:00.000Z'); // UTC+7 = 12:00
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);

            // Wednesday but after end time - should NOT run
            setSystemTime('2025-01-08T11:01:00.000Z'); // UTC+7 = 18:01
            expect(scheduleService.isScheduleDue(schedule)).toBe(false);
        });
    });

    describe('Interval + Date Range Combination', () => {
        test('should respect interval, date range, and time range together', () => {
            const schedule = createTestSchedule({
                interval: '3', // Wednesday only
                start_date: '2025-01-01',
                end_date: '2025-01-31',
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            // Wednesday in February (outside date range) - should NOT run
            setSystemTime('2025-02-05T05:00:00.000Z'); // Wed, Feb 5, UTC+7 = 12:00
            expect(scheduleService.isScheduleDue(schedule)).toBe(false);

            // Wednesday in January (inside date range) - should run
            setSystemTime('2025-01-08T05:00:00.000Z'); // Wed, Jan 8, UTC+7 = 12:00
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        test('should handle interval with single day in array format', () => {
            setSystemTime('2025-01-08T03:00:00.000Z'); // Wednesday

            const schedule = createTestSchedule({
                interval: '[3]', // Single day in array
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });

        test('should handle interval with duplicate days', () => {
            setSystemTime('2025-01-08T03:00:00.000Z'); // Wednesday

            const schedule = createTestSchedule({
                interval: '3,3,3', // Duplicates
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });

        test('should handle interval with out-of-range values (ignored)', () => {
            setSystemTime('2025-01-08T03:00:00.000Z'); // Wednesday

            const schedule = createTestSchedule({
                interval: '3,7,8,9', // 7,8,9 are invalid days
                start_time: '08:00:00',
                end_time: '18:00:00'
            });

            // Should still match day 3 (Wednesday)
            expect(scheduleService.isScheduleDue(schedule)).toBe(true);
        });
    });
});

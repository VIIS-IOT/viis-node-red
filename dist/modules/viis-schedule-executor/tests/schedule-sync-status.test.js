"use strict";
/**
 * Unit tests for Schedule Server Sync Status
 * Tests the server synchronization functionality with success/failure scenarios
 */
Object.defineProperty(exports, "__esModule", { value: true });
// Mock SyncScheduleService BEFORE imports
const mockSyncScheduleService = {
    syncScheduleFromLocalToServer: jest.fn()
};
// Mock repository
const mockRepository = {
    findOne: jest.fn(),
    save: jest.fn().mockResolvedValue({}),
    createQueryBuilder: jest.fn(() => ({
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        printSql: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
    }))
};
// Mock AppDataSource
jest.mock('../../../orm/dataSource', () => ({
    AppDataSource: {
        isInitialized: true,
        initialize: jest.fn().mockResolvedValue(undefined),
        getRepository: jest.fn(() => mockRepository)
    }
}));
// Mock Container for dependency injection
jest.mock('typedi', () => ({
    Container: {
        get: jest.fn(() => mockSyncScheduleService)
    },
    Service: () => (target) => target
}));
// NOW import after mocks are set up
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
// Mock Node
const mockNode = {
    context: () => ({
        global: {
            get: jest.fn(),
            set: jest.fn()
        }
    }),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn()
};
// Create test schedule
const createTestSchedule = (name, status) => ({
    name,
    label: `Test Schedule ${name}`,
    device_label: 'Test Device',
    status,
    start_time: '08:00:00',
    end_time: '18:00:00',
    enable: 1,
    is_deleted: 0,
    device_id: 'test-device-001',
    created: new Date(),
    modified: new Date(),
    type: 'fixed',
    action: '{}',
    deleted: null
});
describe('Schedule Server Sync Status Tests', () => {
    let scheduleService;
    let mockGlobalContext;
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset repository mocks to working state
        mockRepository.save.mockResolvedValue({});
        const AppDataSource = require('../../../orm/dataSource').AppDataSource;
        AppDataSource.getRepository = jest.fn(() => mockRepository);
        // Setup global context
        mockGlobalContext = new Map();
        mockNode.context().global.get.mockImplementation((key) => {
            return mockGlobalContext.get(key) || {};
        });
        mockNode.context().global.set.mockImplementation((key, value) => {
            mockGlobalContext.set(key, value);
        });
        scheduleService = new viis_schedule_executor_service_1.ScheduleService(mockNode, false);
        // Inject mock sync service directly
        Object.defineProperty(scheduleService, 'syncScheduleService', {
            value: mockSyncScheduleService,
            writable: true,
            configurable: true
        });
    });
    describe('updateScheduleStatus - Server Sync', () => {
        it('should log SUCCESS when sync to server succeeds', async () => {
            const testSchedule = createTestSchedule('test-sync-success', '');
            // Mock successful sync
            mockSyncScheduleService.syncScheduleFromLocalToServer.mockResolvedValue(undefined);
            // Execute
            await scheduleService.updateScheduleStatus(testSchedule, 'running');
            // Verify: Should log status change
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('▶️ STATUS CHANGE: test-sync-success'));
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('none → running'));
            // Verify: Should log sync success
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('✅ SERVER SYNC SUCCESS: test-sync-success'));
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('Status: running'));
            // Verify: Sync was called
            expect(mockSyncScheduleService.syncScheduleFromLocalToServer).toHaveBeenCalledWith([testSchedule]);
        });
        it('should log FAILED when sync to server fails', async () => {
            const testSchedule = createTestSchedule('test-sync-fail', 'running');
            // Mock sync failure
            const syncError = new Error('Network timeout');
            mockSyncScheduleService.syncScheduleFromLocalToServer.mockRejectedValue(syncError);
            // Execute - should not throw, just log
            await scheduleService.updateScheduleStatus(testSchedule, 'finished');
            // Verify: Should log status change first
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('⏹️ STATUS CHANGE: test-sync-fail'));
            // Verify: Should log sync failure
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('❌ SERVER SYNC FAILED: test-sync-fail'));
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('Network timeout'));
        });
        it('should log SKIPPED when SyncScheduleService is not available', async () => {
            const testSchedule = createTestSchedule('test-sync-unavailable', '');
            // Create service without sync service
            const serviceWithoutSync = new viis_schedule_executor_service_1.ScheduleService(mockNode, false);
            // Mock syncScheduleService as undefined
            Object.defineProperty(serviceWithoutSync, 'syncScheduleService', {
                value: undefined,
                writable: true,
                configurable: true
            });
            // Execute
            await serviceWithoutSync.updateScheduleStatus(testSchedule, 'running');
            // Verify: Should log status change
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('STATUS CHANGE: test-sync-unavailable'));
            // Verify: Should log sync skipped
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('⚠️ SERVER SYNC SKIPPED: test-sync-unavailable'));
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('SyncScheduleService not available'));
        });
        it('should log correct status transition icons', async () => {
            const testSchedule = createTestSchedule('test-icons', '');
            mockSyncScheduleService.syncScheduleFromLocalToServer.mockResolvedValue(undefined);
            // Test: none → running (should show ▶️)
            await scheduleService.updateScheduleStatus(testSchedule, 'running');
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('▶️ STATUS CHANGE'));
            jest.clearAllMocks();
            // Test: running → finished (should show ⏹️)
            testSchedule.status = 'running';
            await scheduleService.updateScheduleStatus(testSchedule, 'finished');
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('⏹️ STATUS CHANGE'));
        });
        it('should handle database errors gracefully', async () => {
            const testSchedule = createTestSchedule('test-db-error', '');
            // Mock database error by making AppDataSource throw
            const AppDataSource = require('../../../orm/dataSource').AppDataSource;
            AppDataSource.getRepository = jest.fn(() => {
                throw new Error('Database connection failed');
            });
            // Execute
            await scheduleService.updateScheduleStatus(testSchedule, 'running');
            // Verify: Should log database error
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('❌ DATABASE ERROR: test-db-error'));
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('Database connection failed'));
        });
        it('should include schedule label in status change log', async () => {
            const testSchedule = createTestSchedule('test-label', '');
            testSchedule.label = 'Morning Irrigation';
            mockSyncScheduleService.syncScheduleFromLocalToServer.mockResolvedValue(undefined);
            await scheduleService.updateScheduleStatus(testSchedule, 'running');
            // Verify: Label is included in log
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('Label: Morning Irrigation'));
        });
    });
    describe('Server Sync - Multiple Status Transitions', () => {
        it('should handle rapid status changes correctly', async () => {
            const testSchedule = createTestSchedule('test-rapid', '');
            mockSyncScheduleService.syncScheduleFromLocalToServer.mockResolvedValue(undefined);
            // Execute rapid transitions
            await scheduleService.updateScheduleStatus(testSchedule, 'running');
            testSchedule.status = 'running';
            await scheduleService.updateScheduleStatus(testSchedule, 'finished');
            // Verify: Both transitions logged
            const warnCalls = mockNode.warn.mock.calls;
            const statusChangeLogs = warnCalls.filter(call => call[0].includes('STATUS CHANGE: test-rapid'));
            expect(statusChangeLogs.length).toBe(2);
            expect(statusChangeLogs[0][0]).toContain('none → running');
            expect(statusChangeLogs[1][0]).toContain('running → finished');
        });
        it('should sync each status change independently', async () => {
            const testSchedule1 = createTestSchedule('test-independent-1', '');
            const testSchedule2 = createTestSchedule('test-independent-2', 'running');
            mockSyncScheduleService.syncScheduleFromLocalToServer.mockResolvedValue(undefined);
            // Execute multiple transitions with different schedules
            await scheduleService.updateScheduleStatus(testSchedule1, 'running');
            await scheduleService.updateScheduleStatus(testSchedule2, 'finished');
            // Verify: Sync called twice
            expect(mockSyncScheduleService.syncScheduleFromLocalToServer).toHaveBeenCalledTimes(2);
            // Verify: Each call with correct status
            const calls = mockSyncScheduleService.syncScheduleFromLocalToServer.mock.calls;
            expect(calls[0][0][0].status).toBe('running');
            expect(calls[1][0][0].status).toBe('finished');
        });
    });
    describe('Server Sync - Error Recovery', () => {
        it('should continue after sync failure', async () => {
            const testSchedule1 = createTestSchedule('test-fail-1', '');
            const testSchedule2 = createTestSchedule('test-success-1', '');
            // First sync fails, second succeeds
            mockSyncScheduleService.syncScheduleFromLocalToServer
                .mockRejectedValueOnce(new Error('Temporary network error'))
                .mockResolvedValueOnce(undefined);
            // Execute
            await scheduleService.updateScheduleStatus(testSchedule1, 'running');
            await scheduleService.updateScheduleStatus(testSchedule2, 'running');
            // Verify: Both status changes logged
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('STATUS CHANGE: test-fail-1'));
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('STATUS CHANGE: test-success-1'));
            // Verify: Failure and success logged
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('❌ SERVER SYNC FAILED: test-fail-1'));
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('✅ SERVER SYNC SUCCESS: test-success-1'));
        });
    });
});

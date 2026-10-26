const getAllSchedulePlans = jest.fn();

jest.mock('../services/apiService', () => ({
    ApiService: jest.fn().mockImplementation(() => ({ getAllSchedulePlans })),
}));
jest.mock('../services/syncStateService', () => ({
    SyncStateService: jest.fn().mockImplementation(() => ({
        startSync: jest.fn().mockReturnValue(Date.now()),
        recordSyncResult: jest.fn(),
    })),
}));
jest.mock('../utils/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { ScheduleSyncHandler } from '../handlers/scheduleSyncHandler';

// E2E 2026-10-26: a plan deleted on the server stayed on the gateway and its schedule ran every day.
describe('ScheduleSyncHandler deleted plans', () => {
    const kept = { name: 'plan-kept', label: 'Kept', is_deleted: 0, is_from_local: 0, enable: 1 };
    const gone = { name: 'plan-gone', label: 'Gone', is_deleted: 0, is_from_local: 0, enable: 1 };
    const localOnly = { name: 'plan-local', label: 'Local', is_deleted: 0, is_from_local: 1, enable: 1 };

    const planRepo = {
        findOneBy: jest.fn(),
        find: jest.fn(),
        save: jest.fn(async (value: unknown) => value),
    };
    const scheduleRepo = {
        find: jest.fn(),
        findOneBy: jest.fn(),
        save: jest.fn(async (value: unknown) => value),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        getAllSchedulePlans.mockResolvedValue({
            result: { data: [{ name: 'plan-kept', label: 'Kept', is_deleted: 0, enable: 1, schedules: [] }] },
        });
        planRepo.findOneBy.mockResolvedValue({ ...kept });
        planRepo.find.mockResolvedValue([{ ...kept }, { ...gone }, { ...localOnly }]);
        scheduleRepo.find.mockImplementation(async ({ where }: any) =>
            where.schedule_plan_id === 'plan-gone' ? [{ name: 'run-1205', schedule_plan_id: 'plan-gone', is_deleted: 0 }] : []);
    });

    it('marks a plan missing on the server, and its schedules, as deleted', async () => {
        const dbService = { getSchedulePlanRepository: () => planRepo, getScheduleRepository: () => scheduleRepo };
        const handler = new ScheduleSyncHandler(dbService as any, { context: () => ({}) } as any, 'token');

        const result = await handler.syncAll();

        expect(result.success).toBe(true);
        const savedPlans = planRepo.save.mock.calls.map(([plan]: any[]) => [plan.name, plan.is_deleted]);
        expect(savedPlans).toContainEqual(['plan-gone', 1]);
        expect(savedPlans).not.toContainEqual(['plan-local', 1]);
        expect(savedPlans).not.toContainEqual(['plan-kept', 1]);
        expect(scheduleRepo.save.mock.calls.map(([s]: any[]) => [s.name, s.is_deleted])).toEqual([['run-1205', 1]]);
    });
});

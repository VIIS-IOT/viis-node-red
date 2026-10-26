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
// Gateway 115 runs two devices on one MySQL, so only the syncing device's plans may be judged.
describe('ScheduleSyncHandler deleted plans', () => {
    const kept = { name: 'plan-kept', label: 'Kept', device_id: 'dev-1', is_deleted: 0, is_from_local: 0, enable: 1 };
    const gone = { name: 'plan-gone', label: 'Gone', device_id: 'dev-1', is_deleted: 0, is_from_local: 0, enable: 1 };
    const localOnly = { name: 'plan-local', label: 'Local', device_id: 'dev-1', is_deleted: 0, is_from_local: 1, enable: 1 };
    // Deleted by the delete-schedulePlan RPC, which marks only the plan row.
    const deletedByRpc = { name: 'plan-rpc', label: 'Rpc', device_id: 'dev-1', is_deleted: 1, is_from_local: 0, enable: 1 };
    // Another device sharing the gateway DB (nodered2 on gateway 115).
    const otherDevice = { name: 'plan-other', label: 'Other device', device_id: 'dev-2', is_deleted: 0, is_from_local: 0, enable: 1 };

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
    const dbService = { getSchedulePlanRepository: () => planRepo, getScheduleRepository: () => scheduleRepo };
    const handlerFor = (deviceId = '') => new ScheduleSyncHandler(dbService as any, { context: () => ({}) } as any, 'token', deviceId);
    const serverPlan = (schedules: unknown[] = []) => ({ name: 'plan-kept', label: 'Kept', device_id: 'dev-1', is_deleted: 0, enable: 1, schedules });
    const savedPlans = () => planRepo.save.mock.calls.map(([plan]: any[]) => [plan.name, plan.is_deleted]);
    const savedSchedules = () => scheduleRepo.save.mock.calls.map(([s]: any[]) => [s.name, s.is_deleted]);

    beforeEach(() => {
        jest.clearAllMocks();
        getAllSchedulePlans.mockResolvedValue({ result: { data: [serverPlan()] } });
        planRepo.findOneBy.mockResolvedValue({ ...kept });
        const allLocal = [kept, gone, localOnly, deletedByRpc, otherDevice];
        planRepo.find.mockImplementation(async (options?: any) =>
            allLocal.filter(plan => !options?.where?.device_id || plan.device_id === options.where.device_id).map(plan => ({ ...plan })));
        scheduleRepo.find.mockImplementation(async ({ where }: any) => {
            const byPlan: Record<string, string> = { 'plan-gone': 'run-1205', 'plan-rpc': 'run-1003', 'plan-other': 'run-other' };
            const name = byPlan[where.schedule_plan_id];
            return name ? [{ name, schedule_plan_id: where.schedule_plan_id, is_deleted: 0 }] : [];
        });
    });

    it('marks this device\'s plans missing on the server as deleted, sweeps deleted plans, leaves other devices alone', async () => {
        const result = await handlerFor('dev-1').syncAll();

        expect(result.success).toBe(true);
        expect(savedPlans()).toContainEqual(['plan-gone', 1]);
        expect(savedPlans()).not.toContainEqual(['plan-local', 1]);
        expect(savedPlans()).not.toContainEqual(['plan-kept', 1]);
        expect(savedPlans()).not.toContainEqual(['plan-other', 1]);
        expect(savedSchedules()).toEqual([['run-1205', 1], ['run-1003', 1]]);
    });

    it('uses the node DEVICE_ID when the server returns no plans, and marks nothing when the device is unknown', async () => {
        getAllSchedulePlans.mockResolvedValue({ result: { data: [] } });

        await handlerFor('').syncAll();
        expect(planRepo.save).not.toHaveBeenCalled();
        expect(scheduleRepo.save).not.toHaveBeenCalled();

        await handlerFor('dev-1').syncAll();
        expect(savedPlans()).toEqual([['plan-kept', 1], ['plan-gone', 1]]);
        expect(savedPlans()).not.toContainEqual(['plan-other', 1]);
    });

    // The server sends the key as `id` and the label as `name`; keying on `name` deleted every schedule each sync.
    it('keeps a schedule the server still lists under its id', async () => {
        const serverSchedule = {
            id: 'sched-kept', name: 'Ca sáng', status: 'running', enable: true, is_deleted: 0, is_from_local: 0,
            action: '{}', start_time: '08:00:00', end_time: '09:00:00', interval: '0,1,2,3,4,5,6',
        };
        getAllSchedulePlans.mockResolvedValue({ result: { data: [serverPlan([serverSchedule])] } });
        planRepo.find.mockResolvedValue([{ ...kept }]);
        scheduleRepo.find.mockResolvedValue([{ name: 'sched-kept', schedule_plan_id: 'plan-kept', is_deleted: 0 }]);
        scheduleRepo.findOneBy.mockResolvedValue({ name: 'sched-kept', schedule_plan_id: 'plan-kept', is_deleted: 0, is_from_local: 0 });

        await handlerFor('dev-1').syncAll();

        expect(scheduleRepo.save.mock.calls.filter(([s]: any[]) => s.is_deleted === 1)).toEqual([]);
    });
});

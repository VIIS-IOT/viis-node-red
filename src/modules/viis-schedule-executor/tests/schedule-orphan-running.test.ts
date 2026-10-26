import { isOrphanRunningSchedule } from '../schedule-eligibility';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';

// Upgrading a gateway must not write OFF for schedules left "running" long ago (deleted mid-run on an older release):
// their outputs may belong to another schedule now. Only schedules this process started get the normal finish.
describe('isOrphanRunningSchedule', () => {
    const schedule = (overrides: Partial<TabiotSchedule>) => ({
        name: 'sched-1',
        status: 'running',
        enable: 1,
        is_deleted: 0,
        schedulePlan: { enable: 1, is_deleted: 0 },
        ...overrides,
    } as TabiotSchedule);
    const hasOutputs = () => true;

    it('treats a deleted schedule left running and never started here as an orphan', () => {
        expect(isOrphanRunningSchedule(schedule({ is_deleted: 1 }), 0, hasOutputs)).toBe(true);
        expect(isOrphanRunningSchedule(schedule({ schedulePlan: { enable: 1, is_deleted: 1 } as any }), 0, hasOutputs)).toBe(true);
    });

    it('lets a schedule this run started go through the normal finish when its plan is deleted', () => {
        expect(isOrphanRunningSchedule(schedule({ schedulePlan: { enable: 1, is_deleted: 1 } as any }), 3, hasOutputs)).toBe(false);
    });

    it('leaves runnable and config-only schedules to the existing paths', () => {
        expect(isOrphanRunningSchedule(schedule({}), 0, hasOutputs)).toBe(false);
        expect(isOrphanRunningSchedule(schedule({ enable: 0 }), 0, () => false)).toBe(false);
    });
});

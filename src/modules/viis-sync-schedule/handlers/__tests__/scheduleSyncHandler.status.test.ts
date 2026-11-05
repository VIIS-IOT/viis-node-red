jest.mock('../../services/apiService', () => ({ ApiService: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../../services/syncStateService', () => ({ SyncStateService: jest.fn().mockImplementation(() => ({})) }));

import { ScheduleSyncHandler } from '../scheduleSyncHandler';

/**
 * Gateway 156, 2026-11-05: the finish POST of "Tưới ca 11h" was lost to a 2-minute WAN drop, so the
 * server kept `running` (modified = the start sync) while the gateway row was `finished`. The 240-min
 * pull then copied `running` back and the executor ran its finish path a second time.
 */
describe('ScheduleSyncHandler pull keeps the gateway-owned run status', () => {
    function handlerWith(localRows: any[]) {
        const saved: any[] = [];
        const scheduleRepo = {
            findOneBy: jest.fn(async ({ name }: { name: string }) => localRows.find((r) => r.name === name) || null),
            save: jest.fn(async (row: any) => { saved.push({ ...row }); return row; }),
        };
        const dbService: any = {
            getSchedulePlanRepository: () => ({}),
            getScheduleRepository: () => scheduleRepo,
        };
        const node: any = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), status: jest.fn(), context: () => ({}) };
        const handler = new ScheduleSyncHandler(dbService, node, 'token');
        (handler as any).resetSyncStats();
        return { handler, saved };
    }

    const serverRow = {
        id: '66ff106c-2226-4243-b5c1-763a84e55cd2',
        name: 'Tưới ca 11h',
        label: 'Tưới ca 11h',
        device_id: 'dev-1',
        status: 'running',
        action: { valve_2: true },
        enable: 1,
        set_time: '11:10:00',
        start_time: '11:10:00',
        end_time: '11:15:00',
        start_date: '2026-09-19',
        end_date: '2027-09-19',
        interval: '0,1,2,3,4,5,6',
        is_deleted: 0,
        creation: '2026-10-22T04:35:10.000Z',
        modified: '2026-11-05T04:10:06.933Z',
    };

    it('keeps a local finished row finished when the server still says running', async () => {
        const local = {
            name: serverRow.id,
            status: 'finished',
            is_from_local: 0,
            is_synced: 1,
            end_time: '11:14:00',
            modified: new Date('2026-11-05T04:14:13.349Z'),
        };
        const { handler, saved } = handlerWith([local]);

        await (handler as any).syncSchedule(serverRow, 'plan-1');

        expect(saved).toHaveLength(1);
        expect(saved[0].status).toBe('finished');
        expect(saved[0].end_time).toBe('11:15:00'); // configuration still follows the server
    });

    it('keeps a local running row running when the server says finished', async () => {
        const local = { name: serverRow.id, status: 'running', is_from_local: 0, is_synced: 1, modified: new Date('2026-11-05T04:00:00Z') };
        const { handler, saved } = handlerWith([local]);

        await (handler as any).syncSchedule({ ...serverRow, status: 'finished' }, 'plan-1');

        expect(saved[0].status).toBe('running');
    });

    it('creates an unknown schedule as finished even when the server says running', async () => {
        const { handler, saved } = handlerWith([]);

        await (handler as any).syncSchedule(serverRow, 'plan-1');

        expect(saved).toHaveLength(1);
        expect(saved[0].name).toBe(serverRow.id);
        expect(saved[0].status).toBe('finished');
    });

    it('does not end the executor retry of a status the server has not acknowledged', async () => {
        const local = { name: serverRow.id, status: 'finished', is_from_local: 0, is_synced: 0, modified: new Date('2026-11-05T04:14:13.349Z') };
        const { handler, saved } = handlerWith([local]);

        await (handler as any).syncSchedule(serverRow, 'plan-1');

        expect(saved[0].status).toBe('finished');
        expect(saved[0].is_synced).toBe(0);
    });
});

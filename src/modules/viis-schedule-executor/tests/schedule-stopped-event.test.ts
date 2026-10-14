/**
 * ADR-033 D2: a run that is stopped before its window ends is reported as `schedule.stopped` with
 * its reason — never as `completed`, and never silently.
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Node } from 'node-red';
import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { CircuitBreakerManager } from '../resilience-utils';
import { stopRunsNoLongerEnabled, StopCleanupDeps } from '../schedule-stop-cleanup';
import { activeRunId, rememberRunId } from '../schedule-run-identity';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const SCHEDULE_ID = 'eb40f1f3-0778-4859-8448-ea3b4ee005ad';
const PLAN_ID = '43ea1135-a363-4549-bda8-79ac7413a73c';

const schedule = (overrides: Partial<TabiotSchedule> = {}): TabiotSchedule => ({
    name: SCHEDULE_ID,
    label: 'Test 1 phut',
    schedule_plan_id: PLAN_ID,
    status: 'running',
    start_time: '14:25:00',
    end_time: '14:30:00',
    enable: 1,
    is_deleted: 0,
    device_id: 'device-001',
    action: '{}',
    ...overrides,
} as TabiotSchedule);

function memoryStore() {
    const values = new Map<string, unknown>();
    return { get: (k: string) => values.get(k), set: (k: string, v: unknown) => { values.set(k, v); } };
}

describe('sendStoppedNotification', () => {
    let service: ScheduleService;

    beforeEach(() => {
        jest.clearAllMocks();
        const env: Record<string, string> = {
            server_url: 'https://iot.viis.tech', device_access_token: 'test-token-123', device_id: 'device-001',
        };
        const node = {
            context: () => ({ global: { get: jest.fn((k: string) => env[k] || ''), set: jest.fn() } }),
            warn: jest.fn(),
            error: jest.fn(),
        } as unknown as Node;
        service = new ScheduleService(node, true, true);
        mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
    });

    afterEach(() => {
        (CircuitBreakerManager.getInstance() as any).circuits = new Map();
    });

    test('sends the stopped key with its reason and the run identity', async () => {
        await service.sendStoppedNotification(schedule(), 'plan_disabled', 'run-1');
        const payload = mockedAxios.post.mock.calls[0][1] as any;

        expect(payload.message_key).toBe('iot.notification.schedule.stopped');
        expect(payload.severity).toBe('notification');
        expect(payload.alarm_status).toBe('Clear');
        expect(payload.message_params).toEqual({
            scheduleName: 'Test 1 phut', scheduleId: SCHEDULE_ID, planId: PLAN_ID, runId: 'run-1', reason: 'plan_disabled',
        });
        expect(payload.msg).toBe('Lịch trình "Test 1 phut" đã dừng: kế hoạch bị tắt');
    });
});

describe('stopRunsNoLongerEnabled', () => {
    function deps(overrides: Partial<StopCleanupDeps> = {}) {
        const active: Record<string, any[]> = { [SCHEDULE_ID]: [{ fc: 5, address: 5, value: true }] };
        const store = memoryStore();
        rememberRunId(store, SCHEDULE_ID, 'run-1');
        const d: StopCleanupDeps = {
            activeCommands: () => active,
            resetCommands: jest.fn().mockResolvedValue(true),
            clearActiveCommands: jest.fn((name: string) => { delete active[name]; }),
            loadStopped: jest.fn().mockResolvedValue({ schedule: schedule(), reason: 'plan_disabled' }),
            finishSchedule: jest.fn().mockResolvedValue(undefined),
            sendStopped: jest.fn().mockResolvedValue(true),
            runIds: store,
            ...overrides,
        };
        return { d, active, store };
    }

    test('cleanup after plan disable sends stopped/plan_disabled and finishes the schedule', async () => {
        const { d, store } = deps();
        await stopRunsNoLongerEnabled(d, []);

        expect(d.finishSchedule).toHaveBeenCalledWith(expect.objectContaining({ name: SCHEDULE_ID }));
        expect(d.sendStopped).toHaveBeenCalledWith(expect.objectContaining({ name: SCHEDULE_ID }), 'plan_disabled', 'run-1');
        expect(activeRunId(store, SCHEDULE_ID)).toBeNull();
    });

    test('cleanup sends stopped once', async () => {
        const { d } = deps();
        await stopRunsNoLongerEnabled(d, []);
        await stopRunsNoLongerEnabled(d, []);
        expect(d.sendStopped).toHaveBeenCalledTimes(1);
    });

    test('a schedule still enabled is left alone', async () => {
        const { d } = deps();
        await stopRunsNoLongerEnabled(d, [SCHEDULE_ID]);
        expect(d.resetCommands).not.toHaveBeenCalled();
        expect(d.sendStopped).not.toHaveBeenCalled();
    });

    test('failed reset sends nothing and keeps the commands', async () => {
        const { d, active } = deps({ resetCommands: jest.fn().mockResolvedValue(false) });
        await stopRunsNoLongerEnabled(d, []);
        expect(d.sendStopped).not.toHaveBeenCalled();
        expect(active[SCHEDULE_ID]).toBeDefined();
    });

    test('an unknown enabled list (local query failed) stops nothing', async () => {
        const { d, active } = deps();
        await stopRunsNoLongerEnabled(d, null);
        expect(d.resetCommands).not.toHaveBeenCalled();
        expect(d.sendStopped).not.toHaveBeenCalled();
        expect(active[SCHEDULE_ID]).toBeDefined();
    });

    test('a deleted schedule is reported but not written back', async () => {
        const { d } = deps({
            loadStopped: jest.fn().mockResolvedValue({ schedule: schedule({ is_deleted: 1 }), reason: 'deleted' }),
        });
        await stopRunsNoLongerEnabled(d, []);
        expect(d.finishSchedule).not.toHaveBeenCalled();
        expect(d.sendStopped).toHaveBeenCalledWith(expect.anything(), 'deleted', 'run-1');
    });

    test('a schedule row that is gone is reported by its id', async () => {
        const { d } = deps({ loadStopped: jest.fn().mockResolvedValue({ schedule: null, reason: 'deleted' }) });
        await stopRunsNoLongerEnabled(d, []);
        expect(d.sendStopped).toHaveBeenCalledWith(expect.objectContaining({ name: SCHEDULE_ID }), 'deleted', 'run-1');
    });
});

describe('executor wiring', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'viis-schedule-executor.ts'), 'utf8');

    test('RPC disable of a running schedule sends stopped, never completed', () => {
        const rpcStart = src.indexOf('Clear timestamp when schedule is disabled via RPC');
        const rpcEnd = src.indexOf('is not running, only disabling', rpcStart);
        const rpcBlock = src.slice(rpcStart, rpcEnd);
        expect(rpcBlock).toContain("sendStoppedNotification(schedule, 'schedule_disabled'");
        expect(rpcBlock).not.toContain("sendNotificationToBackend(schedule, 'end'");
    });

    test('a failed schedule query is not passed to the cleanup as an empty list', () => {
        expect(src).toContain('getDueSchedulesOrNull()');
        expect(src).toMatch(/stopRunsNoLongerEnabled\([\s\S]*?dueSchedules === null \? null : enabledScheduleIds\)/);
    });

    test('the tick cleanup goes through stopRunsNoLongerEnabled', () => {
        expect(src).toContain('stopRunsNoLongerEnabled(');
        expect(src).not.toContain('Cleaned up stale commands for schedule ${scheduleId} (not in enabled schedules)');
    });
});

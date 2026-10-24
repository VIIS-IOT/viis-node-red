/**
 * Plan Task 8: with the event outbox on (`EVENT_OUTBOX_ENABLED`), the executor's run events are stored in
 * the outbox with the payload they are POSTed with today; with it off they are POSTed as before. A failed
 * OFF also raises the `schedule_off_failed:<schedule>` state alarm, cleared once the OFF passed.
 */
import axios from 'axios';
import { Node } from 'node-red';
import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { CircuitBreakerManager } from '../resilience-utils';
import { KeyOutcome } from '../schedule-execution-types';
import { initEventOutbox, resetEventOutbox } from '../../../services/event-outbox/registry';
import { FakeDataSource } from '../../../services/event-outbox/__tests__/fake-datasource';
import { TabiotEventOutbox } from '../../../orm/entities/event-outbox/TabiotEventOutbox';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const SCHEDULE_ID = 'eb40f1f3-0778-4859-8448-ea3b4ee005ad';
const TOKEN = 'test-token-123';

const schedule = {
    name: SCHEDULE_ID,
    label: 'Test 1 phut',
    schedule_plan_id: '43ea1135-a363-4549-bda8-79ac7413a73c',
    status: 'running',
    start_time: '14:25:00',
    end_time: '14:30:00',
    enable: 1,
    is_deleted: 0,
    device_id: 'device-001',
    action: '{}',
} as TabiotSchedule;

const valveOffFailed: KeyOutcome = {
    key: 'valve_1', phase: 'close_valves', fc: 5, address: 3, expected: false, read: true, status: 'fail', attempts: 3,
};

/** The payload without the fields that differ between two sends of the same event. */
const stable = ({ trigger_time, event_id, occurred_at, ...rest }: Record<string, any>) => rest;

describe('executor events through the outbox', () => {
    let service: ScheduleService;
    let ds: FakeDataSource;
    const env: Record<string, any> = {};
    const outboxRows = () => ds.getRepository(TabiotEventOutbox).rows.map((r: any) => r.payload);

    beforeEach(() => {
        jest.clearAllMocks();
        Object.assign(env, { server_url: 'https://iot.viis.tech', device_access_token: TOKEN, device_id: 'device-001' });
        const node = {
            context: () => ({ global: { get: jest.fn((k: string) => env[k] || ''), set: jest.fn() } }),
            warn: jest.fn(),
            error: jest.fn(),
        } as unknown as Node;
        service = new ScheduleService(node, true, true);
        mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
        ds = new FakeDataSource();
    });

    afterEach(() => {
        resetEventOutbox();
        (CircuitBreakerManager.getInstance() as any).circuits = new Map();
    });

    const enableOutbox = () =>
        initEventOutbox(ds as any, { getEnvVar: (n: string, d?: any) => (n === 'EVENT_OUTBOX_ENABLED' ? true : d) }, { intervalMs: 3600000 });

    test('executor end notification enqueues the same payload', async () => {
        expect(await service.sendNotificationToBackend(schedule, 'end', true, { runId: 'run-1' })).toBe(true);
        const posted = mockedAxios.post.mock.calls[0][1] as Record<string, any>;

        await enableOutbox();
        mockedAxios.post.mockClear();
        expect(await service.sendNotificationToBackend(schedule, 'end', true, { runId: 'run-1' })).toBe(true);

        expect(mockedAxios.post).not.toHaveBeenCalled();
        expect(outboxRows()).toHaveLength(1);
        expect(stable(outboxRows()[0])).toEqual(stable(posted));
        expect(JSON.stringify(outboxRows())).not.toContain(TOKEN);
    });

    test('verify-fail and stopped events enqueue the same payload', async () => {
        await service.sendKeyVerifyFailNotification(schedule, 'end', valveOffFailed, 'run-1');
        await service.sendStoppedNotification(schedule, 'plan_disabled', 'run-1');
        const posted = mockedAxios.post.mock.calls.map(call => call[1] as Record<string, any>);

        await enableOutbox();
        mockedAxios.post.mockClear();
        expect(await service.sendKeyVerifyFailNotification(schedule, 'end', valveOffFailed, 'run-1')).toBe(true);
        expect(await service.sendStoppedNotification(schedule, 'plan_disabled', 'run-1')).toBe(true);

        expect(mockedAxios.post).not.toHaveBeenCalled();
        expect(outboxRows().map(stable)).toEqual(posted.map(stable));
    });

    test('outbox off: the OFF-failed alarm is not raised and nothing is posted for it', async () => {
        expect(await service.raiseOffFailedAlarm(schedule, [valveOffFailed], 'run-1')).toBe(false);
        expect(await service.clearOffFailedAlarm(schedule, 'run-1')).toBe(false);
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    test('failed OFF raises schedule_off_failed once; a passed OFF clears it', async () => {
        await enableOutbox();

        expect(await service.raiseOffFailedAlarm(schedule, [valveOffFailed], 'run-1')).toBe(true);
        expect(await service.raiseOffFailedAlarm(schedule, [valveOffFailed], 'run-1')).toBe(false);
        expect(await service.clearOffFailedAlarm(schedule, 'run-1')).toBe(true);
        expect(await service.clearOffFailedAlarm(schedule, 'run-1')).toBe(false);

        const [raised, cleared] = outboxRows();
        expect(outboxRows()).toHaveLength(2);
        expect(raised).toMatchObject({
            alarm_key: `schedule_off_failed:${SCHEDULE_ID}`,
            alarm_status: 'Pending',
            severity: 'error',
            message_key: 'iot.notification.schedule.verify_failed',
            message_params: { scheduleId: SCHEDULE_ID, runId: 'run-1', key: 'valve_1', keys: ['valve_1'], action: 'end' },
        });
        expect(cleared).toMatchObject({ alarm_key: `schedule_off_failed:${SCHEDULE_ID}`, alarm_status: 'Clear', clear_by: 'Value' });
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });
});

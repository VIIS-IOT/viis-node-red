/**
 * ADR-033: every schedule event names its schedule, plan and run, and one run keeps one runId
 * from start to finish or stop.
 */
import axios from 'axios';
import { Node } from 'node-red';
import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { CircuitBreakerManager } from '../resilience-utils';
import {
    activeRunId,
    forgetRunId,
    rememberRunId,
    scheduleEventParams,
} from '../schedule-run-identity';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const SCHEDULE_ID = 'eb40f1f3-0778-4859-8448-ea3b4ee005ad';
const PLAN_ID = '43ea1135-a363-4549-bda8-79ac7413a73c';

function memoryStore() {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => { values.set(key, value); },
    };
}

const schedule = (overrides: Partial<TabiotSchedule> = {}): TabiotSchedule => ({
    name: SCHEDULE_ID,
    label: 'Test 1 phut',
    schedule_plan_id: PLAN_ID,
    status: '',
    start_time: '14:25:00',
    end_time: '14:30:00',
    enable: 1,
    is_deleted: 0,
    device_id: 'device-001',
    action: JSON.stringify({ fertigation_control_backup_coil: true }),
    ...overrides,
} as TabiotSchedule);

describe('schedule run identity', () => {
    test('one run keeps one runId until it is forgotten', () => {
        const store = memoryStore();
        expect(activeRunId(store, SCHEDULE_ID)).toBeNull();

        rememberRunId(store, SCHEDULE_ID, 'run-1');
        rememberRunId(store, 'other-schedule', 'run-2');
        expect(activeRunId(store, SCHEDULE_ID)).toBe('run-1');

        forgetRunId(store, SCHEDULE_ID);
        expect(activeRunId(store, SCHEDULE_ID)).toBeNull();
        expect(activeRunId(store, 'other-schedule')).toBe('run-2');
    });

    test('event params name the schedule, its plan and the run', () => {
        expect(scheduleEventParams(schedule(), 'run-1')).toEqual({
            scheduleName: 'Test 1 phut',
            scheduleId: SCHEDULE_ID,
            planId: PLAN_ID,
            runId: 'run-1',
        });
        expect(scheduleEventParams(schedule({ label: '', schedule_plan_id: null as any }), null)).toEqual({
            scheduleName: SCHEDULE_ID,
            scheduleId: SCHEDULE_ID,
            planId: null,
            runId: null,
        });
    });
});

describe('schedule notifications carry the run identity', () => {
    let service: ScheduleService;

    beforeEach(() => {
        jest.clearAllMocks();
        const env: Record<string, string> = {
            server_url: 'https://iot.viis.tech',
            device_access_token: 'test-token-123',
            device_id: 'device-001',
        };
        const node = {
            context: () => ({ global: { get: jest.fn((key: string) => env[key] || ''), set: jest.fn() } }),
            warn: jest.fn(),
            error: jest.fn(),
        } as unknown as Node;
        service = new ScheduleService(node, true, true);
        mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
    });

    afterEach(() => {
        (CircuitBreakerManager.getInstance() as any).circuits = new Map();
    });

    const sentPayload = () => mockedAxios.post.mock.calls[0][1] as any;

    test('start and end params carry scheduleId, planId and runId', async () => {
        await service.sendNotificationToBackend(schedule(), 'start', true, { runId: 'run-1' });
        expect(sentPayload().message_params).toEqual({
            scheduleName: 'Test 1 phut', scheduleId: SCHEDULE_ID, planId: PLAN_ID, runId: 'run-1',
        });

        mockedAxios.post.mockClear();
        await service.sendNotificationToBackend(schedule(), 'end', true, { runId: 'run-1' });
        expect(sentPayload().message_params).toMatchObject({ scheduleId: SCHEDULE_ID, runId: 'run-1' });
    });

    test('a start never claims success in its text', async () => {
        await service.sendNotificationToBackend(schedule(), 'start', true, { runId: 'run-1' });
        expect(sentPayload().msg).toBe('Lịch trình "Test 1 phut" đã bắt đầu chạy');
        expect(sentPayload().msg).not.toContain('thành công');
    });

    test('verify-fail params carry the run identity next to the key', async () => {
        await service.sendKeyVerifyFailNotification(
            schedule(),
            'start',
            { key: 'fertigation_control_iri_valve_mode', expected: 1, read: 0, attempts: 3 } as any,
            'run-1',
        );
        expect(sentPayload().message_params).toMatchObject({
            scheduleName: 'Test 1 phut',
            scheduleId: SCHEDULE_ID,
            planId: PLAN_ID,
            runId: 'run-1',
            key: 'fertigation_control_iri_valve_mode',
        });
    });

    test('an event without a run still sends, with runId null', async () => {
        await service.sendNotificationToBackend(schedule(), 'end', true);
        expect(sentPayload().message_params).toMatchObject({ scheduleId: SCHEDULE_ID, runId: null });
    });
});

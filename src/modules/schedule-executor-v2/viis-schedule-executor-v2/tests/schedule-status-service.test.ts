/**
 * Unit tests for ScheduleStatusService (V2) HTTP notification to backend.
 * Schedule failures are always notified; debugEnable only controls logging.
 */

import { Node } from 'node-red';
import axios from 'axios';
import { ScheduleStatusService } from '../schedule-status-service';
import { TabiotSchedule } from '../../../../orm/entities/schedule/TabiotSchedule';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Avoid constructing the real HTTP sync client (needs configs/network); not under test.
jest.mock('../../../../services/syncSchedule/SyncScheduleService', () => ({
    SyncScheduleService: jest.fn().mockImplementation(() => ({
        logSchedule: jest.fn(),
    })),
}));

describe('ScheduleStatusService.sendNotificationToBackend', () => {
    let mockNode: Node;
    let mockGlobalContext: any;

    beforeEach(() => {
        jest.clearAllMocks();

        // GlobalContextHelper maps VIIS_BACKEND -> server_url, DEVICE_* -> device_*
        mockGlobalContext = {
            get: jest.fn((key: string) => {
                const envVars: Record<string, string> = {
                    server_url: 'https://iot.viis.tech',
                    device_access_token: 'test-token-123',
                    device_id: 'device-001',
                };
                return envVars[key] || '';
            }),
            set: jest.fn(),
        };

        mockNode = {
            context: () => ({ global: mockGlobalContext }),
            warn: jest.fn(),
            error: jest.fn(),
        } as unknown as Node;
    });

    const createTestSchedule = (): TabiotSchedule => ({
        name: 'test-schedule-001',
        label: 'Lịch trình tưới sáng',
        device_label: 'Test Device',
        status: '',
        start_time: '08:00:00',
        end_time: '18:00:00',
        enable: 1,
        is_deleted: 0,
        device_id: 'device-001',
        action: JSON.stringify({ pump_1: true }),
        machine_type: 'MAIN_ENGINE',
        created: new Date(),
        modified: new Date(),
        deleted: null,
        type: 'fixed',
    } as TabiotSchedule);

    test('failure notification is sent without debug', async () => {
        const quietService = new ScheduleStatusService(mockNode, false);
        mockedAxios.post.mockResolvedValue({ status: 200, data: { status: 'success' } });

        const result = await quietService.sendNotificationToBackend(createTestSchedule(), 'start', false);

        expect(result).toBe(true);
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            'https://iot.viis.tech/api/v2/alarm/notification-by-token',
            expect.objectContaining({
                severity: 'error',
                message_key: 'iot.notification.schedule.failed',
                alarm_status: 'Pending',
            }),
            expect.objectContaining({
                params: { device_access_token: 'test-token-123' },
            })
        );
    });

    test('end failure notification is sent without debug', async () => {
        const quietService = new ScheduleStatusService(mockNode, false);
        mockedAxios.post.mockResolvedValue({ status: 200, data: { status: 'success' } });

        const result = await quietService.sendNotificationToBackend(createTestSchedule(), 'end', false);

        expect(result).toBe(true);
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            'https://iot.viis.tech/api/v2/alarm/notification-by-token',
            expect.objectContaining({
                severity: 'error',
                message_key: 'iot.notification.schedule.failed',
                alarm_status: 'Clear',
            }),
            expect.any(Object)
        );
    });

    test('success notification keeps severity notification', async () => {
        const service = new ScheduleStatusService(mockNode, false);
        mockedAxios.post.mockResolvedValue({ status: 200, data: { status: 'success' } });

        const result = await service.sendNotificationToBackend(createTestSchedule(), 'start', true);

        expect(result).toBe(true);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                severity: 'notification',
                message_key: 'iot.notification.schedule.started',
            }),
            expect.any(Object)
        );
    });
});

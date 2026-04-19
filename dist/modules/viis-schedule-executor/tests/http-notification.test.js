"use strict";
/**
 * Test suite for HTTP notification to backend
 * Tests sending notifications directly to backend API bypassing MQTT ThingsBoard
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
const axios_1 = __importDefault(require("axios"));
const resilience_utils_1 = require("../resilience-utils");
// Mock axios
jest.mock('axios');
const mockedAxios = axios_1.default;
describe('HTTP Notification to Backend', () => {
    let mockNode;
    let scheduleService;
    let mockGlobalContext;
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock global context to return environment variables properly
        // GlobalContextHelper looks for lowercase_underscore keys
        mockGlobalContext = {
            get: jest.fn((key) => {
                const envVars = {
                    'server_url': 'https://iot.viis.tech',
                    'device_access_token': 'test-token-123',
                    'device_id': 'device-001'
                };
                return envVars[key] || '';
            }),
            set: jest.fn()
        };
        mockNode = {
            context: () => ({ global: mockGlobalContext }),
            warn: jest.fn(),
            error: jest.fn()
        };
        scheduleService = new viis_schedule_executor_service_1.ScheduleService(mockNode, true, true);
    });
    afterEach(() => {
        // Reset circuit breaker state to prevent test interference
        const manager = resilience_utils_1.CircuitBreakerManager.getInstance();
        manager.circuits = new Map();
    });
    const createTestSchedule = () => ({
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
        type: 'fixed'
    });
    describe('sendNotificationToBackend', () => {
        test('should send start notification successfully', async () => {
            mockedAxios.post.mockResolvedValue({
                status: 200,
                data: {
                    status: 'success',
                    message: 'Notification sent successfully'
                }
            });
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'start', true);
            expect(result).toBe(true);
            expect(mockedAxios.post).toHaveBeenCalledWith('https://iot.viis.tech/api/v2/alarm/notification-by-token', expect.objectContaining({
                alarm_name: 'Lịch trình tưới sáng',
                id: 'device-001',
                msg: expect.stringContaining('đã bắt đầu chạy'),
                severity: 'notification',
                alarm_status: 'Pending',
                tb_alarm_id: 'test-schedule-001'
            }), expect.objectContaining({
                params: {
                    device_access_token: 'test-token-123'
                }
            }));
        });
        test('should send end notification successfully', async () => {
            mockedAxios.post.mockResolvedValue({
                status: 200,
                data: { status: 'success' }
            });
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'end', true);
            expect(result).toBe(true);
            expect(mockedAxios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                msg: expect.stringContaining('đã hoàn thành'),
                alarm_status: 'Clear',
                clear_by: 'Value'
            }), expect.any(Object));
        });
        test('should send error notification on end failure', async () => {
            mockedAxios.post.mockResolvedValue({
                status: 200,
                data: { status: 'success' }
            });
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'end', false // failure
            );
            expect(result).toBe(true);
            expect(mockedAxios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                msg: expect.stringContaining('KHÔNG THỂ TẮT'),
                severity: 'error',
                alarm_status: 'Clear'
            }), expect.any(Object));
        });
        test('should send error notification on start failure', async () => {
            mockedAxios.post.mockResolvedValue({
                status: 200,
                data: { status: 'success' }
            });
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'start', false // failure
            );
            expect(result).toBe(true);
            expect(mockedAxios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                msg: expect.stringContaining('không thể bắt đầu'),
                severity: 'error',
                alarm_status: 'Pending'
            }), expect.any(Object));
        });
        test('should retry on network failure', async () => {
            let attemptCount = 0;
            mockedAxios.post.mockImplementation(async () => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new Error('Network timeout');
                }
                return {
                    status: 200,
                    data: { status: 'success' }
                };
            });
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'start', true, { maxRetries: 3, baseDelay: 100 });
            expect(result).toBe(true);
            expect(attemptCount).toBe(3);
        });
        test('should return false when missing VIIS_BACKEND', async () => {
            // Save original value and clear
            const originalBackendUrl = process.env.VIIS_BACKEND;
            process.env.VIIS_BACKEND = '';
            mockGlobalContext.get.mockImplementation((key) => {
                const envVars = {
                    'server_url': '',
                    'device_access_token': 'test-token-123',
                    'device_id': 'device-001'
                };
                return envVars[key] || '';
            });
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'start', true);
            expect(result).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('Missing VIIS_BACKEND'));
            expect(mockedAxios.post).not.toHaveBeenCalled();
            // Restore original value
            process.env.VIIS_BACKEND = originalBackendUrl;
        });
        test('should return false when missing DEVICE_ACCESS_TOKEN', async () => {
            mockGlobalContext.get.mockImplementation((key) => {
                const envVars = {
                    'server_url': 'https://iot.viis.tech',
                    'device_access_token': '',
                    'device_id': 'device-001'
                };
                return envVars[key] || '';
            });
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'start', true);
            expect(result).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('Missing VIIS_BACKEND or DEVICE_ACCESS_TOKEN'));
        });
        test('should handle HTTP 4xx errors gracefully', async () => {
            mockedAxios.post.mockRejectedValue({
                isAxiosError: true,
                response: {
                    status: 401,
                    statusText: 'Unauthorized'
                },
                message: 'Request failed with status code 401'
            });
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'start', true, { maxRetries: 2, baseDelay: 50 });
            expect(result).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP NOTIFICATION FAILED'));
        });
        test('should handle HTTP 5xx errors with retry', async () => {
            let attemptCount = 0;
            mockedAxios.post.mockImplementation(async () => {
                attemptCount++;
                if (attemptCount < 2) {
                    throw {
                        isAxiosError: true,
                        response: { status: 503, statusText: 'Service Unavailable' },
                        message: 'Service temporarily unavailable'
                    };
                }
                return {
                    status: 200,
                    data: { status: 'success' }
                };
            });
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'start', true, { maxRetries: 3, baseDelay: 50 });
            expect(result).toBe(true);
            expect(attemptCount).toBe(2);
        });
        test('should use circuit breaker to prevent overwhelming failed backend', async () => {
            mockedAxios.post.mockRejectedValue(new Error('Backend down'));
            const schedule = createTestSchedule();
            // First 5 attempts to trigger circuit breaker
            for (let i = 0; i < 5; i++) {
                await scheduleService.sendNotificationToBackend(schedule, 'start', true, { maxRetries: 1, baseDelay: 10 });
            }
            // Circuit should be open now, next call should fail fast
            const startTime = Date.now();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'start', true, { maxRetries: 3, baseDelay: 100 });
            const duration = Date.now() - startTime;
            expect(result).toBe(false);
            // Should fail much faster than normal retry (< 500ms vs 300ms+ with retries)
            expect(duration).toBeLessThan(500);
        });
        test('should include proper payload structure', async () => {
            mockedAxios.post.mockResolvedValue({
                status: 200,
                data: { status: 'success' }
            });
            const schedule = createTestSchedule();
            schedule.label = 'Lịch trình tưới chiều';
            await scheduleService.sendNotificationToBackend(schedule, 'start', true);
            expect(mockedAxios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                alarm_name: 'Lịch trình tưới chiều',
                id: 'device-001',
                severity: 'notification',
                trigger_time: expect.any(String),
                tb_alarm_id: 'test-schedule-001',
                alarm_status: 'Pending',
                clear_by: '',
                clear_by_user_id: '',
                entity: 'device-001'
            }), expect.objectContaining({
                params: { device_access_token: 'test-token-123' },
                headers: { 'Content-Type': 'application/json' }
            }));
        });
        test('should handle timeout correctly', async () => {
            mockedAxios.post.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10000)));
            const schedule = createTestSchedule();
            const result = await scheduleService.sendNotificationToBackend(schedule, 'start', true, { maxRetries: 1, baseDelay: 100, timeout: 500 });
            expect(result).toBe(false);
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP NOTIFICATION FAILED'));
        }, 10000);
    });
    describe('sendNotificationDual', () => {
        let mockThingsboardClient;
        let mockEmqxClient;
        beforeEach(() => {
            mockThingsboardClient = {
                publish: jest.fn().mockResolvedValue(true)
            };
            mockEmqxClient = {
                publish: jest.fn().mockResolvedValue(true)
            };
        });
        test('should send HTTP only when preferHttp is true and HTTP succeeds', async () => {
            mockedAxios.post.mockResolvedValue({
                status: 200,
                data: { status: 'success' }
            });
            const schedule = createTestSchedule();
            await scheduleService.sendNotificationDual(mockThingsboardClient, mockEmqxClient, schedule, 'start', true, { preferHttp: true });
            expect(mockedAxios.post).toHaveBeenCalled();
            expect(mockThingsboardClient.publish).not.toHaveBeenCalled();
            expect(mockEmqxClient.publish).not.toHaveBeenCalled();
        });
        test('should fallback to MQTT when HTTP fails', async () => {
            mockedAxios.post.mockRejectedValue(new Error('HTTP failed'));
            const schedule = createTestSchedule();
            await scheduleService.sendNotificationDual(mockThingsboardClient, mockEmqxClient, schedule, 'start', true, { preferHttp: true, maxRetries: 1, baseDelay: 10 });
            expect(mockedAxios.post).toHaveBeenCalled();
            expect(mockThingsboardClient.publish).toHaveBeenCalled();
            expect(mockEmqxClient.publish).toHaveBeenCalled();
        });
        test('should send to both HTTP and MQTT when preferHttp is false', async () => {
            mockedAxios.post.mockResolvedValue({
                status: 200,
                data: { status: 'success' }
            });
            const schedule = createTestSchedule();
            await scheduleService.sendNotificationDual(mockThingsboardClient, mockEmqxClient, schedule, 'start', true, { preferHttp: false });
            expect(mockedAxios.post).toHaveBeenCalled();
            expect(mockThingsboardClient.publish).toHaveBeenCalled();
            expect(mockEmqxClient.publish).toHaveBeenCalled();
        });
    });
});

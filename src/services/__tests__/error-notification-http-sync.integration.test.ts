/**
 * Unit tests for ErrorNotificationService HTTP sync feature
 */

import { ErrorNotificationService } from '../error-notification.service';
import { TabiotNotification } from '../../orm/entities/notification/TabiotNotification';
import { NodeContext } from 'node-red';
import axios from 'axios';

// Mock dependencies
jest.mock('axios');
jest.mock('../../orm/dataSource');
jest.mock('../error-mapping.service');
jest.mock('../../ultils/global-context-helper');

describe('ErrorNotificationService - HTTP Sync', () => {
    let service: ErrorNotificationService;
    let mockNodeContext: NodeContext;
    let mockRepository: any;

    beforeEach(async () => {
        // Clear all mocks
        jest.clearAllMocks();

        // Mock NodeContext
        mockNodeContext = {
            global: {
                get: jest.fn((key: string) => {
                    const mockData: any = {
                        'server_url': 'https://iot.viis.tech',
                        'device_access_token': 'test-token-123',
                        'device_id': 'test-device-001'
                    };
                    return mockData[key];
                })
            }
        } as any;

        // Mock Repository
        mockRepository = {
            metadata: {},
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
        };

        // Mock createDataSource
        const { createDataSource } = require('../../orm/dataSource');
        createDataSource.mockReturnValue({
            isInitialized: true,
            initialize: jest.fn(),
            getRepository: jest.fn().mockReturnValue(mockRepository)
        });

        // Create service instance
        service = new ErrorNotificationService(mockNodeContext);
        
        // Wait for async initialization
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    describe('HTTP Notification Sync', () => {
        test('should send HTTP notification when creating new error', async () => {
            const mockNotification = {
                name: 'notification_test_ERR_TEST_123',
                entity: 'board1',
                type: 'error',
                severity: 'high',
                message: 'Test error message',
                err_code: 'ERR_TEST',
                entity_label: 'Test Board',
                is_read: 0,
                is_sent: 0,
                created_at: new Date(),
                metadata: JSON.stringify({
                    board_id: 'board1',
                    register_type: 'holding',
                    address: 90
                })
            } as TabiotNotification;

            mockRepository.save.mockResolvedValue(mockNotification);
            mockRepository.findOne.mockResolvedValue(null); // No existing notification

            const mockedAxios = axios as jest.Mocked<typeof axios>;
            mockedAxios.post.mockResolvedValue({
                status: 200,
                data: { success: true }
            });

            // Trigger create notification
            const result = await (service as any).createOrUpdateNotification(
                'ERR_TEST',
                'Test error message',
                'high',
                'error',
                'board1',
                'Test Board',
                { board_id: 'board1', register_type: 'holding', address: 90 }
            );

            // Wait for async HTTP call
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify notification saved to DB
            expect(mockRepository.save).toHaveBeenCalled();

            // Verify HTTP POST was called
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://iot.viis.tech/api/v2/alarm/notification-by-token',
                expect.objectContaining({
                    alarm_name: 'ERR_TEST',
                    id: 'test-device-001',
                    severity: 'error',
                    alarm_status: 'Pending'
                }),
                expect.objectContaining({
                    params: { device_access_token: 'test-token-123' },
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 5000
                })
            );
        });

        test('should send resolve notification when error clears', async () => {
            const existingNotification = {
                name: 'notification_test_ERR_TEST_123',
                entity: 'board1',
                err_code: 'ERR_TEST',
                severity: 'high',
                message: 'Test error',
                entity_label: 'Test Board',
                is_read: 0,
                created_at: new Date(),
                metadata: JSON.stringify({
                    board_id: 'board1',
                    register_type: 'holding',
                    address: 90
                })
            } as TabiotNotification;

            const resolvedNotification = {
                ...existingNotification,
                is_read: 1
            };

            mockRepository.findOne
                .mockResolvedValueOnce(existingNotification) // First call: find unresolved
                .mockResolvedValueOnce(resolvedNotification); // Second call: after update

            const mockedAxios = axios as jest.Mocked<typeof axios>;
            mockedAxios.post.mockResolvedValue({
                status: 200,
                data: { success: true }
            });

            // Trigger resolve
            const result = await (service as any).resolveNotification('ERR_TEST', 'board1');

            // Wait for async HTTP call
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify notification marked as read
            expect(mockRepository.update).toHaveBeenCalled();
            expect(result).toBe(true);

            // Verify HTTP POST was called with resolve action
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://iot.viis.tech/api/v2/alarm/notification-by-token',
                expect.objectContaining({
                    alarm_status: 'Clear',
                    clear_by: 'Auto',
                    msg: expect.stringContaining('đã được khắc phục')
                }),
                expect.any(Object)
            );
        });

        test('should skip HTTP sync when VIIS_BACKEND is not configured', async () => {
            // Override global context to return empty backend URL
            (mockNodeContext.global.get as jest.Mock).mockImplementation((key: string) => {
                if (key === 'server_url') return '';
                if (key === 'device_access_token') return 'test-token';
                if (key === 'device_id') return 'test-device';
                return undefined;
            });

            const mockNotification = {
                name: 'notification_test_ERR_TEST_123',
                err_code: 'ERR_TEST',
                severity: 'high',
                message: 'Test error',
                entity: 'board1',
                created_at: new Date(),
                metadata: '{}'
            } as TabiotNotification;

            mockRepository.save.mockResolvedValue(mockNotification);
            mockRepository.findOne.mockResolvedValue(null);

            const mockedAxios = axios as jest.Mocked<typeof axios>;
            mockedAxios.post.mockClear();

            // Trigger create
            await (service as any).createOrUpdateNotification(
                'ERR_TEST',
                'Test error',
                'high',
                'error',
                'board1',
                'Test Board'
            );

            // Wait for async
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify HTTP was NOT called
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        test('should continue even if HTTP sync fails', async () => {
            const mockNotification = {
                name: 'notification_test_ERR_TEST_123',
                err_code: 'ERR_TEST',
                severity: 'high',
                message: 'Test error',
                entity: 'board1',
                created_at: new Date(),
                metadata: '{}'
            } as TabiotNotification;

            mockRepository.save.mockResolvedValue(mockNotification);
            mockRepository.findOne.mockResolvedValue(null);

            const mockedAxios = axios as jest.Mocked<typeof axios>;
            mockedAxios.post.mockRejectedValue(new Error('Network error'));

            // Should not throw error
            const result = await (service as any).createOrUpdateNotification(
                'ERR_TEST',
                'Test error',
                'high',
                'error',
                'board1',
                'Test Board'
            );

            // Wait for async
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify notification was still saved
            expect(result).toBeDefined();
            expect(mockRepository.save).toHaveBeenCalled();
        });

        test('should map severity correctly for HTTP payload', async () => {
            const testCases = [
                { severity: 'critical', expectedAlarmSeverity: 'error' },
                { severity: 'high', expectedAlarmSeverity: 'error' },
                { severity: 'medium', expectedAlarmSeverity: 'notification' },
                { severity: 'low', expectedAlarmSeverity: 'notification' }
            ];

            const mockedAxios = axios as jest.Mocked<typeof axios>;
            mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

            for (const testCase of testCases) {
                mockRepository.save.mockResolvedValue({
                    name: 'test_notification',
                    err_code: 'TEST_ERR',
                    severity: testCase.severity,
                    message: 'Test',
                    entity: 'test',
                    created_at: new Date(),
                    metadata: '{}'
                });
                mockRepository.findOne.mockResolvedValue(null);

                mockedAxios.post.mockClear();

                await (service as any).createOrUpdateNotification(
                    'TEST_ERR',
                    'Test',
                    testCase.severity,
                    'error',
                    'test',
                    'Test'
                );

                await new Promise(resolve => setTimeout(resolve, 100));

                expect(mockedAxios.post).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        severity: testCase.expectedAlarmSeverity
                    }),
                    expect.any(Object)
                );
            }
        });
    });
});

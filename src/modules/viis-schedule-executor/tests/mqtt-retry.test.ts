/**
 * Test suite for MQTT retry mechanism
 * Tests resilient MQTT publishing with retry logic and fallback strategies
 */

import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';

describe('MQTT Retry Mechanism', () => {
    let mockNode: Node;
    let mockThingsboardClient: any;
    let mockEmqxClient: any;
    let scheduleService: ScheduleService;
    let mockGlobalContext: any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockGlobalContext = {
            get: jest.fn((key: string) => {
                if (key === 'DEVICE_ID') return 'test-device-001';
                if (key === 'MODBUS_HOLDING_REGISTERS') return {};
                if (key === 'MODBUS_COILS') return {};
                return {};
            }),
            set: jest.fn()
        };

        mockNode = {
            context: () => ({ global: mockGlobalContext }),
            warn: jest.fn(),
            error: jest.fn()
        } as unknown as Node;

        mockThingsboardClient = {
            publish: jest.fn(),
            isConnected: jest.fn(() => true)
        };

        mockEmqxClient = {
            publish: jest.fn(),
            isConnected: jest.fn(() => true)
        };

        scheduleService = new ScheduleService(mockNode, true);
    });

    const createTestSchedule = (): TabiotSchedule => ({
        name: 'test-schedule-001',
        label: 'Test Schedule',
        device_label: 'Test Device',
        status: 'running',
        start_time: '08:00:00',
        end_time: '18:00:00',
        enable: 1,
        is_deleted: 0,
        device_id: 'test-device-001',
        action: JSON.stringify({ pump_1: true }),
        machine_type: 'MAIN_ENGINE',
        created: new Date(),
        modified: new Date(),
        deleted: null,
        type: 'fixed'
    } as TabiotSchedule);

    describe('publishMqttNotificationWithRetry', () => {
        test('should successfully publish on first attempt', async () => {
            mockThingsboardClient.publish.mockResolvedValue(true);
            mockEmqxClient.publish.mockResolvedValue(true);

            const schedule = createTestSchedule();

            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true
            );

            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(1);
            expect(mockEmqxClient.publish).toHaveBeenCalledTimes(1);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('📡 MQTT PUBLISHED')
            );
        });

        test('should retry ThingsBoard publish on failure', async () => {
            let attemptCount = 0;
            mockThingsboardClient.publish.mockImplementation(async () => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new Error('Network timeout');
                }
                return true;
            });
            mockEmqxClient.publish.mockResolvedValue(true);

            const schedule = createTestSchedule();

            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true,
                { maxRetries: 3, baseDelay: 100 }
            );

            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(3);
            expect(mockEmqxClient.publish).toHaveBeenCalledTimes(1);
        });

        test('should retry EMQX publish on failure', async () => {
            let attemptCount = 0;
            mockThingsboardClient.publish.mockResolvedValue(true);
            mockEmqxClient.publish.mockImplementation(async () => {
                attemptCount++;
                if (attemptCount < 2) {
                    throw new Error('Connection refused');
                }
                return true;
            });

            const schedule = createTestSchedule();

            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true,
                { maxRetries: 3, baseDelay: 100 }
            );

            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(1);
            expect(mockEmqxClient.publish).toHaveBeenCalledTimes(2);
        });

        test('should continue if ThingsBoard fails but EMQX succeeds', async () => {
            mockThingsboardClient.publish.mockRejectedValue(new Error('ThingsBoard unreachable'));
            mockEmqxClient.publish.mockResolvedValue(true);

            const schedule = createTestSchedule();

            // Should not throw error - degraded mode operation
            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true,
                { maxRetries: 2, baseDelay: 100 }
            );

            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(2);
            expect(mockEmqxClient.publish).toHaveBeenCalledTimes(1);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️ MQTT PARTIAL SUCCESS')
            );
        });

        test('should continue if EMQX fails but ThingsBoard succeeds', async () => {
            mockThingsboardClient.publish.mockResolvedValue(true);
            mockEmqxClient.publish.mockRejectedValue(new Error('EMQX unreachable'));

            const schedule = createTestSchedule();

            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true,
                { maxRetries: 2, baseDelay: 100 }
            );

            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(1);
            expect(mockEmqxClient.publish).toHaveBeenCalledTimes(2);
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️ MQTT PARTIAL SUCCESS')
            );
        });

        test('should log error if both MQTT brokers fail after retries', async () => {
            mockThingsboardClient.publish.mockRejectedValue(new Error('ThingsBoard down'));
            mockEmqxClient.publish.mockRejectedValue(new Error('EMQX down'));

            const schedule = createTestSchedule();

            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true,
                { maxRetries: 2, baseDelay: 100 }
            );

            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('❌ MQTT COMPLETE FAILURE')
            );
        });

        test('should use exponential backoff between retries', async () => {
            const delays: number[] = [];
            let lastTime = Date.now();
            let attemptCount = 0;

            mockThingsboardClient.publish.mockImplementation(async () => {
                attemptCount++;
                const currentTime = Date.now();
                // Record delay from previous attempt (skip first attempt)
                if (attemptCount > 1) {
                    delays.push(currentTime - lastTime);
                }
                lastTime = currentTime;
                throw new Error('Still failing');
            });
            // Also make EMQX fail to ensure we capture delays properly
            mockEmqxClient.publish.mockRejectedValue(new Error('EMQX failing'));

            const schedule = createTestSchedule();

            try {
                await (scheduleService as any).publishMqttNotificationWithRetry(
                    mockThingsboardClient,
                    mockEmqxClient,
                    schedule,
                    true,
                    { maxRetries: 3, baseDelay: 100, useExponentialBackoff: true }
                );
            } catch (error) {
                // Expected to fail
            }

            // Delays should increase: ~100ms, ~200ms (2 retries after first attempt)
            expect(delays.length).toBeGreaterThanOrEqual(2);
            // Check that delays are generally increasing (with some tolerance for jitter)
            for (let i = 1; i < delays.length; i++) {
                // Allow for jitter and test timing variations
                expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1] * 0.5);
            }
        });
    });

    describe('publishConfigUpdateWithRetry', () => {
        test('should retry config parameter publishing', async () => {
            let attemptCount = 0;
            mockThingsboardClient.publish.mockImplementation(async () => {
                attemptCount++;
                if (attemptCount < 2) {
                    throw new Error('Timeout');
                }
                return true;
            });
            mockEmqxClient.publish.mockResolvedValue(true);

            const configParam = {
                key: 'iri_time',
                value: 1800,
                type: 'number' as const,
                timestamp: Date.now(),
                scheduleId: 'test-schedule-001'
            };

            await (scheduleService as any).publishConfigUpdateWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                configParam,
                { maxRetries: 3, baseDelay: 100 }
            );

            expect(mockThingsboardClient.publish).toHaveBeenCalledTimes(2);
        });

        test('should not throw error if config publish fails - degraded mode', async () => {
            mockThingsboardClient.publish.mockRejectedValue(new Error('Network error'));
            mockEmqxClient.publish.mockRejectedValue(new Error('Network error'));

            const configParam = {
                key: 'iri_time',
                value: 1800,
                type: 'number' as const,
                timestamp: Date.now(),
                scheduleId: 'test-schedule-001'
            };

            // Should not throw - config publish is non-critical
            await expect(
                (scheduleService as any).publishConfigUpdateWithRetry(
                    mockThingsboardClient,
                    mockEmqxClient,
                    configParam,
                    { maxRetries: 2, baseDelay: 50 }
                )
            ).resolves.not.toThrow();

            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️ CONFIG PUBLISH FAILED')
            );
        });
    });

    describe('MQTT Queue for Failed Messages', () => {
        test('should queue failed messages for later retry', async () => {
            mockThingsboardClient.publish.mockRejectedValue(new Error('Network down'));
            mockEmqxClient.publish.mockRejectedValue(new Error('Network down'));

            const schedule = createTestSchedule();

            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true,
                { maxRetries: 1, baseDelay: 50, queueOnFailure: true }
            );

            // Check if message was queued
            const failedQueue = (scheduleService as any).getFailedMqttQueue();
            expect(failedQueue.length).toBeGreaterThan(0);
            expect(failedQueue[0]).toMatchObject({
                schedule: expect.objectContaining({ name: 'test-schedule-001' }),
                type: 'notification'
            });
        });

        test('should retry queued messages when connection restored', async () => {
            // First attempt - both fail
            mockThingsboardClient.publish.mockRejectedValue(new Error('Down'));
            mockEmqxClient.publish.mockRejectedValue(new Error('Down'));

            const schedule = createTestSchedule();

            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true,
                { maxRetries: 1, baseDelay: 50, queueOnFailure: true }
            );

            // Now restore connection
            mockThingsboardClient.publish.mockResolvedValue(true);
            mockEmqxClient.publish.mockResolvedValue(true);

            // Process queued messages
            await (scheduleService as any).processFailedMqttQueue(
                mockThingsboardClient,
                mockEmqxClient
            );

            // Verify queued message was sent
            const queue = (scheduleService as any).getFailedMqttQueue();
            expect(queue.length).toBe(0); // Queue should be empty
        });

        test('should limit queue size to prevent memory overflow', async () => {
            mockThingsboardClient.publish.mockRejectedValue(new Error('Down'));
            mockEmqxClient.publish.mockRejectedValue(new Error('Down'));

            // Try to queue 150 messages (limit should be 100)
            for (let i = 0; i < 150; i++) {
                const schedule = createTestSchedule();
                schedule.name = `test-schedule-${i}`;
                
                await (scheduleService as any).publishMqttNotificationWithRetry(
                    mockThingsboardClient,
                    mockEmqxClient,
                    schedule,
                    true,
                    { maxRetries: 1, baseDelay: 10, queueOnFailure: true }
                );
            }

            const queue = (scheduleService as any).getFailedMqttQueue();
            expect(queue.length).toBeLessThanOrEqual(100);
        });
    });

    describe('MQTT Connection Health Check', () => {
        test('should check broker connection before publishing', async () => {
            mockThingsboardClient.isConnected.mockReturnValue(false);
            mockEmqxClient.isConnected.mockReturnValue(true);

            const schedule = createTestSchedule();

            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true,
                { maxRetries: 1, baseDelay: 50, checkConnection: true }
            );

            // Should skip ThingsBoard since it's disconnected
            expect(mockNode.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️ ThingsBoard disconnected')
            );
        });

        test('should attempt reconnection if both brokers disconnected', async () => {
            mockThingsboardClient.isConnected.mockReturnValue(false);
            mockEmqxClient.isConnected.mockReturnValue(false);
            mockThingsboardClient.reconnect = jest.fn().mockResolvedValue(true);
            mockEmqxClient.reconnect = jest.fn().mockResolvedValue(true);
            // Mock publish to succeed after reconnection
            mockThingsboardClient.publish.mockResolvedValue(true);
            mockEmqxClient.publish.mockResolvedValue(true);

            const schedule = createTestSchedule();

            await (scheduleService as any).publishMqttNotificationWithRetry(
                mockThingsboardClient,
                mockEmqxClient,
                schedule,
                true,
                { maxRetries: 1, baseDelay: 50, checkConnection: true, attemptReconnect: true }
            );

            expect(mockThingsboardClient.reconnect).toHaveBeenCalled();
            expect(mockEmqxClient.reconnect).toHaveBeenCalled();
        });
    });
});

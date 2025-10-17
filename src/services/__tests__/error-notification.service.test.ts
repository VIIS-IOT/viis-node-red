/**
 * Unit tests for ErrorNotificationService
 */

import { ErrorNotificationService, BusinessLogicError } from '../error-notification.service';
import { ErrorMappingService, ModbusErrorSource } from '../error-mapping.service';
import { TabiotNotification } from '../../orm/entities/notification/TabiotNotification';
import { createDataSource } from '../../orm/dataSource';
import { NodeContext } from 'node-red';
import { Repository } from 'typeorm';

// Mock dependencies
jest.mock('../error-mapping.service');
jest.mock('../../orm/dataSource');

describe('ErrorNotificationService', () => {
    let errorNotificationService: ErrorNotificationService;
    let mockNodeContext: NodeContext;
    let mockErrorMappingService: jest.Mocked<ErrorMappingService>;
    let mockNotificationRepo: jest.Mocked<Repository<TabiotNotification>>;

    beforeEach(async () => {
        // Mock node context
        mockNodeContext = {
            global: {
                get: jest.fn(),
                set: jest.fn()
            }
        } as any;

        // Mock repository
        mockNotificationRepo = {
            findOne: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
            getRepository: jest.fn()
        } as any;

        // Mock dataSource
        (createDataSource as jest.Mock).mockResolvedValue({
            getRepository: jest.fn().mockReturnValue(mockNotificationRepo)
        });

        // Mock ErrorMappingService
        mockErrorMappingService = {
            parseModbusError: jest.fn(),
            shouldAutoResolve: jest.fn(),
            getMappingForDeviceType: jest.fn(),
            getMappingStats: jest.fn().mockReturnValue({
                loaded: true,
                deviceTypeCount: 2
            })
        } as any;

        (ErrorMappingService as jest.Mock).mockImplementation(() => mockErrorMappingService);

        errorNotificationService = new ErrorNotificationService(mockNodeContext);
        
        // Wait for repository initialization
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createFromModbus()', () => {
        it('should create notification from Modbus error', async () => {
            const parsedError = {
                err_code: 'ERR_TEMP_HIGH',
                message: 'Temperature too high',
                severity: 'high' as 'high' | 'critical' | 'medium' | 'low',
                auto_resolve: true,
                metadata: {
                    register_type: 'holding',
                    address: 1000,
                    raw_value: 1,
                    device_type: 'Climate_Controller'
                }
            };

            mockErrorMappingService.parseModbusError.mockReturnValue(parsedError);
            mockNotificationRepo.findOne.mockResolvedValue(null); // No existing notification

            const savedNotification = {
                name: 'notification_device_001_ERR_TEMP_HIGH_123456_abc123',
                err_code: 'ERR_TEMP_HIGH',
                message: 'Temperature too high',
                severity: 'high',
                entity: 'device_001',
                is_read: 0,
                metadata: JSON.stringify({
                    occurrence_count: 1,
                    first_occurred: expect.any(String),
                    last_occurred: expect.any(String),
                    register_type: 'holding',
                    address: 1000,
                    raw_value: 1,
                    device_type: 'Climate_Controller'
                })
            } as TabiotNotification;

            mockNotificationRepo.save.mockResolvedValue(savedNotification);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };

            const result = await errorNotificationService.createFromModbus(
                source,
                'Climate_Controller',
                'device_001'
            );

            expect(result).not.toBeNull();
            expect(result?.err_code).toBe('ERR_TEMP_HIGH');
            expect(mockErrorMappingService.parseModbusError).toHaveBeenCalledWith(
                source,
                'Climate_Controller'
            );
            expect(mockNotificationRepo.save).toHaveBeenCalled();
        });

        it('should return null if no error mapping found', async () => {
            mockErrorMappingService.parseModbusError.mockReturnValue(null);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 0 // No error
            };

            const result = await errorNotificationService.createFromModbus(
                source,
                'Climate_Controller',
                'device_001'
            );

            expect(result).toBeNull();
            expect(mockNotificationRepo.save).not.toHaveBeenCalled();
        });

        it('should update existing notification instead of creating duplicate', async () => {
            const parsedError = {
                err_code: 'ERR_TEMP_HIGH',
                message: 'Temperature too high',
                severity: 'high' as const,
                auto_resolve: true,
                metadata: {
                    register_type: 'holding',
                    address: 1000,
                    raw_value: 1,
                    device_type: 'Climate_Controller'
                }
            };

            mockErrorMappingService.parseModbusError.mockReturnValue(parsedError);

            const existingNotification = {
                name: 'notification_old',
                err_code: 'ERR_TEMP_HIGH',
                entity: 'device_001',
                is_read: 0,
                metadata: JSON.stringify({
                    occurrence_count: 1,
                    first_occurred: '2025-01-17T10:00:00.000Z'
                })
            } as TabiotNotification;

            mockNotificationRepo.findOne.mockResolvedValue(existingNotification);
            mockNotificationRepo.update.mockResolvedValue({} as any);
            mockNotificationRepo.findOne
                .mockResolvedValueOnce(existingNotification) // First call for deduplication
                .mockResolvedValueOnce({
                    ...existingNotification,
                    metadata: JSON.stringify({
                        occurrence_count: 2,
                        first_occurred: '2025-01-17T10:00:00.000Z',
                        last_occurred: '2025-01-17T10:05:00.000Z'
                    })
                } as TabiotNotification); // Second call for fetching updated

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };

            const result = await errorNotificationService.createFromModbus(
                source,
                'Climate_Controller',
                'device_001'
            );

            expect(mockNotificationRepo.update).toHaveBeenCalled();
            expect(mockNotificationRepo.save).not.toHaveBeenCalled();
            
            // Check that occurrence_count was incremented
            const updateCall = mockNotificationRepo.update.mock.calls[0];
            const metadata = JSON.parse(updateCall[1].metadata as string);
            expect(metadata.occurrence_count).toBe(2);
        });
    });

    describe('createFromBusinessLogic()', () => {
        it('should create notification from business logic error', async () => {
            mockNotificationRepo.findOne.mockResolvedValue(null);

            const savedNotification = {
                name: 'notification_greenhouse_1_TEMP_HIGH_123456_abc123',
                err_code: 'TEMP_HIGH',
                message: 'Temperature exceeds threshold',
                severity: 'high',
                entity: 'greenhouse_1',
                type: 'warning',
                is_read: 0
            } as TabiotNotification;

            mockNotificationRepo.save.mockResolvedValue(savedNotification);

            const errorData: BusinessLogicError = {
                err_code: 'TEMP_HIGH',
                message: 'Temperature exceeds threshold',
                severity: 'high',
                type: 'warning',
                entity: 'greenhouse_1',
                metadata: {
                    current_value: 38,
                    threshold: 35
                }
            };

            const result = await errorNotificationService.createFromBusinessLogic(errorData);

            expect(result).not.toBeNull();
            expect(result.err_code).toBe('TEMP_HIGH');
            expect(mockNotificationRepo.save).toHaveBeenCalled();
        });
    });

    describe('autoResolveIfClear()', () => {
        it('should auto-resolve when error clears for holding register', async () => {
            const mapping = {
                device_type: 'Climate_Controller',
                mappings: [
                    {
                        register_type: 'holding' as const,
                        address: 1000,
                        error_codes: [
                            {
                                code: 1,
                                err_code: 'ERR_TEMP_HIGH',
                                message: 'Temperature too high',
                                severity: 'high' as const,
                                auto_resolve: true
                            }
                        ]
                    }
                ]
            };

            mockErrorMappingService.getMappingForDeviceType.mockReturnValue(mapping);

            const existingNotification = {
                name: 'notification_old',
                err_code: 'ERR_TEMP_HIGH',
                entity: 'device_001',
                is_read: 0,
                metadata: '{}'
            } as TabiotNotification;

            mockNotificationRepo.findOne.mockResolvedValue(existingNotification);
            mockNotificationRepo.update.mockResolvedValue({} as any);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 0 // Cleared
            };

            const result = await errorNotificationService.autoResolveIfClear(
                source,
                'Climate_Controller',
                'device_001'
            );

            expect(result).toBe(true);
            expect(mockNotificationRepo.update).toHaveBeenCalled();
            
            const updateCall = mockNotificationRepo.update.mock.calls[0];
            expect(updateCall[1].is_read).toBe(1);
            
            const metadata = JSON.parse(updateCall[1].metadata as string);
            expect(metadata.resolved_by).toBe('auto');
        });

        it('should auto-resolve when coil error clears', async () => {
            const mapping = {
                device_type: 'Climate_Controller',
                mappings: [
                    {
                        register_type: 'coil' as const,
                        address: 500,
                        error_codes: [
                            {
                                code: true,
                                err_code: 'ERR_FAN_OVERRUN',
                                message: 'Fan overrun detected',
                                severity: 'high' as const,
                                auto_resolve: true
                            }
                        ]
                    }
                ]
            };

            mockErrorMappingService.getMappingForDeviceType.mockReturnValue(mapping);

            const existingNotification = {
                name: 'notification_old',
                err_code: 'ERR_FAN_OVERRUN',
                entity: 'device_001',
                is_read: 0,
                metadata: '{}'
            } as TabiotNotification;

            mockNotificationRepo.findOne.mockResolvedValue(existingNotification);
            mockNotificationRepo.update.mockResolvedValue({} as any);

            const source: ModbusErrorSource = {
                register_type: 'coil',
                address: 500,
                value: false // Cleared
            };

            const result = await errorNotificationService.autoResolveIfClear(
                source,
                'Climate_Controller',
                'device_001'
            );

            expect(result).toBe(true);
        });

        it('should not resolve if value still indicates error', async () => {
            const mapping = {
                device_type: 'Climate_Controller',
                mappings: [
                    {
                        register_type: 'holding' as const,
                        address: 1000,
                        error_codes: [
                            {
                                code: 1,
                                err_code: 'ERR_TEMP_HIGH',
                                message: 'Temperature too high',
                                severity: 'high' as const,
                                auto_resolve: true
                            }
                        ]
                    }
                ]
            };

            mockErrorMappingService.getMappingForDeviceType.mockReturnValue(mapping);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 1 // Still error
            };

            const result = await errorNotificationService.autoResolveIfClear(
                source,
                'Climate_Controller',
                'device_001'
            );

            expect(result).toBe(false);
            expect(mockNotificationRepo.update).not.toHaveBeenCalled();
        });

        it('should not resolve if auto_resolve is false', async () => {
            const mapping = {
                device_type: 'Climate_Controller',
                mappings: [
                    {
                        register_type: 'holding' as const,
                        address: 1000,
                        error_codes: [
                            {
                                code: 1,
                                err_code: 'ERR_SENSOR_FAULT',
                                message: 'Sensor fault detected',
                                severity: 'critical' as const,
                                auto_resolve: false // Manual resolve required
                            }
                        ]
                    }
                ]
            };

            mockErrorMappingService.getMappingForDeviceType.mockReturnValue(mapping);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 0 // Cleared
            };

            const result = await errorNotificationService.autoResolveIfClear(
                source,
                'Climate_Controller',
                'device_001'
            );

            // Should not call update for non-auto-resolve errors
            expect(mockNotificationRepo.update).not.toHaveBeenCalled();
        });
    });

    describe('getStats()', () => {
        it('should return service statistics', () => {
            const stats = errorNotificationService.getStats();

            expect(stats).toHaveProperty('mappingService');
            expect(stats).toHaveProperty('repositoryInitialized');
            expect(stats.mappingService.loaded).toBe(true);
            expect(stats.repositoryInitialized).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        it('should handle malformed metadata gracefully', async () => {
            const parsedError = {
                err_code: 'ERR_TEST',
                message: 'Test error',
                severity: 'high' as const,
                auto_resolve: true,
                metadata: {
                    register_type: 'holding',
                    address: 1000,
                    raw_value: 1,
                    device_type: 'Test'
                }
            };

            mockErrorMappingService.parseModbusError.mockReturnValue(parsedError);

            const existingNotification = {
                name: 'notification_old',
                err_code: 'ERR_TEST',
                entity: 'device_001',
                is_read: 0,
                metadata: 'invalid json{{{' // Malformed JSON
            } as TabiotNotification;

            mockNotificationRepo.findOne.mockResolvedValue(existingNotification);
            mockNotificationRepo.update.mockResolvedValue({} as any);
            mockNotificationRepo.findOne
                .mockResolvedValueOnce(existingNotification)
                .mockResolvedValueOnce(existingNotification);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };

            // Should not throw error
            await expect(
                errorNotificationService.createFromModbus(source, 'Test', 'device_001')
            ).resolves.not.toThrow();
        });

        it('should handle null metadata', async () => {
            const parsedError = {
                err_code: 'ERR_TEST',
                message: 'Test error',
                severity: 'high' as const,
                auto_resolve: true,
                metadata: {
                    register_type: 'holding',
                    address: 1000,
                    raw_value: 1,
                    device_type: 'Test'
                }
            };

            mockErrorMappingService.parseModbusError.mockReturnValue(parsedError);

            const existingNotification = {
                name: 'notification_old',
                err_code: 'ERR_TEST',
                entity: 'device_001',
                is_read: 0,
                metadata: null // Null metadata
            } as any;

            mockNotificationRepo.findOne.mockResolvedValue(existingNotification);
            mockNotificationRepo.update.mockResolvedValue({} as any);
            mockNotificationRepo.findOne
                .mockResolvedValueOnce(existingNotification)
                .mockResolvedValueOnce(existingNotification);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };

            await expect(
                errorNotificationService.createFromModbus(source, 'Test', 'device_001')
            ).resolves.not.toThrow();
        });
    });
});

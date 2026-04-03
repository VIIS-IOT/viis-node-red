/**
 * Unit tests for ErrorNotificationApiService
 */

import 'reflect-metadata';
import { ErrorNotificationApiService } from '../../services/error-notification-api.service';
import { TabiotNotification } from '../../../../orm/entities/notification/TabiotNotification';
import { Repository } from 'typeorm';
import { testNotificationData } from './test.config';
import { BadRequestError, NotFoundError } from 'routing-controllers';

// Mock TypeORM and dependencies
jest.mock('../../../../orm/dataSource', () => ({
    createDataSource: jest.fn(() => ({
        isInitialized: false,
        initialize: jest.fn().mockResolvedValue(true),
        getRepository: jest.fn()
    }))
}));

describe('ErrorNotificationApiService - Unit Tests', () => {
    let service: ErrorNotificationApiService;
    let mockRepository: jest.Mocked<Repository<TabiotNotification>>;

    beforeEach(async () => {
        // Create mock repository
        mockRepository = {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            remove: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            metadata: {} // Add metadata to pass checks
        } as any;

        // Initialize service
        service = new ErrorNotificationApiService();
        
        // Wait a bit for async initialization
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Inject mock repository
        (service as any).notificationRepo = mockRepository;
        (service as any).initialized = true;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createNotification', () => {
        it('should create a notification successfully', async () => {
            const testData = testNotificationData.valid;
            const mockNotification = {
                name: 'notification_test_001',
                ...testData,
                is_read: 0,
                created_at: new Date()
            } as any;

            mockRepository.create.mockReturnValue(mockNotification);
            mockRepository.save.mockResolvedValue(mockNotification);

            const result = await service.createNotification(testData);

            expect(mockRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    err_code: testData.err_code,
                    message: testData.message,
                    severity: testData.severity,
                    type: testData.type,
                    entity: testData.entity,
                    is_read: 0
                })
            );
            expect(mockRepository.save).toHaveBeenCalledWith(mockNotification);
            expect(result).toEqual(mockNotification);
        });

        it('should throw error when repository not initialized', async () => {
            (service as any).notificationRepo = null;

            await expect(
                service.createNotification(testNotificationData.valid)
            ).rejects.toThrow(BadRequestError);
        });

        it('should generate unique notification name', async () => {
            const testData = testNotificationData.valid;
            mockRepository.create.mockReturnValue({} as any);
            mockRepository.save.mockResolvedValue({} as any);

            await service.createNotification(testData);

            const createCall = mockRepository.create.mock.calls[0][0];
            expect(createCall.name).toMatch(/^notification_test_entity_001_TEST_ERR_001_\d+_[a-z0-9]+$/);
        });

        it('should stringify metadata', async () => {
            const testData = testNotificationData.valid;
            mockRepository.create.mockReturnValue({} as any);
            mockRepository.save.mockResolvedValue({} as any);

            await service.createNotification(testData);

            const createCall = mockRepository.create.mock.calls[0][0];
            expect(typeof createCall.metadata).toBe('string');
            expect(JSON.parse(createCall.metadata)).toEqual(testData.metadata);
        });
    });

    describe('getNotificationByName', () => {
        it('should return notification when found', async () => {
            const mockNotification = {
                name: 'test_notification',
                err_code: 'TEST_ERR'
            } as TabiotNotification;

            mockRepository.findOne.mockResolvedValue(mockNotification);

            const result = await service.getNotificationByName('test_notification');

            expect(mockRepository.findOne).toHaveBeenCalledWith({
                where: { name: 'test_notification' }
            });
            expect(result).toEqual(mockNotification);
        });

        it('should throw NotFoundError when notification not found', async () => {
            mockRepository.findOne.mockResolvedValue(null);

            await expect(
                service.getNotificationByName('non_existent')
            ).rejects.toThrow(NotFoundError);
        });
    });

    describe('getAllNotifications', () => {
        it('should return paginated notifications', async () => {
            const mockNotifications = [
                { name: 'notif_1', err_code: 'ERR_1' },
                { name: 'notif_2', err_code: 'ERR_2' }
            ] as TabiotNotification[];

            mockRepository.findAndCount.mockResolvedValue([mockNotifications, 10]);

            const result = await service.getAllNotifications({
                page: 1,
                size: 20
            });

            expect(result).toEqual({
                data: mockNotifications,
                total: 10,
                page: 1,
                size: 20,
                totalPages: 1
            });
        });

        it('should filter by err_code', async () => {
            mockRepository.findAndCount.mockResolvedValue([[], 0]);

            await service.getAllNotifications({
                err_code: 'TEST_ERR',
                page: 1,
                size: 20
            });

            const whereClause = mockRepository.findAndCount.mock.calls[0][0].where as any;
            expect(whereClause.err_code).toBeDefined();
        });

        it('should filter by severity', async () => {
            mockRepository.findAndCount.mockResolvedValue([[], 0]);

            await service.getAllNotifications({
                severity: 'critical',
                page: 1,
                size: 20
            });

            const whereClause = mockRepository.findAndCount.mock.calls[0][0].where as any;
            expect(whereClause.severity).toBe('critical');
        });

        it('should filter by is_read status', async () => {
            mockRepository.findAndCount.mockResolvedValue([[], 0]);

            await service.getAllNotifications({
                is_read: true,
                page: 1,
                size: 20
            });

            const whereClause = mockRepository.findAndCount.mock.calls[0][0].where as any;
            expect(whereClause.is_read).toBe(1);
        });

        it('should calculate total pages correctly', async () => {
            mockRepository.findAndCount.mockResolvedValue([[], 47]);

            const result = await service.getAllNotifications({
                page: 1,
                size: 20
            });

            expect(result.totalPages).toBe(3); // ceil(47/20)
        });
    });

    describe('updateNotification', () => {
        it('should update notification message', async () => {
            const mockNotification = {
                name: 'test_notif',
                message: 'Old message',
                metadata: '{}'
            } as TabiotNotification;

            mockRepository.findOne.mockResolvedValue(mockNotification);
            mockRepository.save.mockResolvedValue({
                ...mockNotification,
                message: 'New message'
            } as any);

            const result = await service.updateNotification('test_notif', {
                message: 'New message'
            });

            expect(mockNotification.message).toBe('New message');
            expect(mockRepository.save).toHaveBeenCalledWith(mockNotification);
        });

        it('should mark notification as read', async () => {
            const mockNotification = {
                name: 'test_notif',
                is_read: 0,
                metadata: '{}'
            } as TabiotNotification;

            mockRepository.findOne.mockResolvedValue(mockNotification);
            mockRepository.save.mockResolvedValue(mockNotification);

            await service.updateNotification('test_notif', {
                is_read: true
            });

            expect(mockNotification.is_read).toBe(1);
            
            // Check metadata was updated with resolve info
            const metadata = JSON.parse(mockNotification.metadata as string);
            expect(metadata.resolved_at).toBeDefined();
            expect(metadata.resolved_by).toBe('manual');
        });

        it('should merge metadata when updating', async () => {
            const mockNotification = {
                name: 'test_notif',
                metadata: JSON.stringify({ existing: 'value' })
            } as TabiotNotification;

            mockRepository.findOne.mockResolvedValue(mockNotification);
            mockRepository.save.mockResolvedValue(mockNotification);

            await service.updateNotification('test_notif', {
                metadata: { new: 'data' }
            });

            const updatedMetadata = JSON.parse(mockNotification.metadata as string);
            expect(updatedMetadata).toEqual({
                existing: 'value',
                new: 'data'
            });
        });
    });

    describe('deleteNotification', () => {
        it('should delete notification successfully', async () => {
            const mockNotification = {
                name: 'test_notif'
            } as TabiotNotification;

            mockRepository.findOne.mockResolvedValue(mockNotification);
            mockRepository.remove.mockResolvedValue(mockNotification);

            const result = await service.deleteNotification('test_notif');

            expect(mockRepository.remove).toHaveBeenCalledWith(mockNotification);
            expect(result).toEqual({
                message: 'Notification "test_notif" deleted successfully'
            });
        });

        it('should throw NotFoundError when deleting non-existent notification', async () => {
            mockRepository.findOne.mockResolvedValue(null);

            await expect(
                service.deleteNotification('non_existent')
            ).rejects.toThrow(NotFoundError);
        });
    });

    describe('bulkResolve', () => {
        it('should resolve multiple notifications', async () => {
            const mockNotifications = [
                { name: 'notif_1', is_read: 0, metadata: '{}' },
                { name: 'notif_2', is_read: 0, metadata: '{}' }
            ] as TabiotNotification[];

            mockRepository.find.mockResolvedValue(mockNotifications);
            mockRepository.save.mockResolvedValue(mockNotifications as any);

            const result = await service.bulkResolve({});

            expect(result.resolved).toBe(2);
            expect(mockNotifications[0].is_read).toBe(1);
            expect(mockNotifications[1].is_read).toBe(1);
        });

        it('should filter by err_code when bulk resolving', async () => {
            mockRepository.find.mockResolvedValue([]);

            await service.bulkResolve({ err_code: 'TEST_ERR' });

            const findOptions = mockRepository.find.mock.calls[0][0];
            expect((findOptions.where as any).err_code).toBe('TEST_ERR');
        });

        it('should only resolve unread notifications', async () => {
            mockRepository.find.mockResolvedValue([]);

            await service.bulkResolve({});

            const findOptions = mockRepository.find.mock.calls[0][0];
            expect((findOptions.where as any).is_read).toBe(0);
        });

        it('should update metadata with resolve info', async () => {
            const mockNotification = {
                name: 'notif_1',
                is_read: 0,
                metadata: JSON.stringify({ board_id: 'board1' })
            } as TabiotNotification;

            mockRepository.find.mockResolvedValue([mockNotification]);
            mockRepository.save.mockResolvedValue([mockNotification] as any);

            await service.bulkResolve({});

            const metadata = JSON.parse(mockNotification.metadata as string);
            expect(metadata.resolved_at).toBeDefined();
            expect(metadata.resolved_by).toBe('bulk_manual');
            expect(metadata.board_id).toBe('board1'); // Original data preserved
        });
    });

    describe('getStatistics', () => {
        it('should return notification statistics', async () => {
            mockRepository.count
                .mockResolvedValueOnce(100) // total
                .mockResolvedValueOnce(25);  // unread

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                groupBy: jest.fn().mockReturnThis(),
                getRawMany: jest.fn().mockResolvedValue([
                    { severity: 'low', count: '5' },
                    { severity: 'high', count: '15' },
                    { severity: 'critical', count: '5' }
                ])
            };

            mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

            const result = await service.getStatistics();

            expect(result).toEqual({
                total: 100,
                unread: 25,
                resolved: 75,
                bySeverity: {
                    low: 5,
                    high: 15,
                    critical: 5
                }
            });
        });

        it('should handle empty statistics', async () => {
            mockRepository.count.mockResolvedValue(0);
            
            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                groupBy: jest.fn().mockReturnThis(),
                getRawMany: jest.fn().mockResolvedValue([])
            };

            mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

            const result = await service.getStatistics();

            expect(result).toEqual({
                total: 0,
                unread: 0,
                resolved: 0,
                bySeverity: {}
            });
        });
    });
});

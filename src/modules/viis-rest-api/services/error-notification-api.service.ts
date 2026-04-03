/**
 * @fileoverview Service for error notification management (API layer)
 */

import 'reflect-metadata';
import { Service, Inject } from 'typedi';
import { Repository, FindManyOptions, Like, Between } from 'typeorm';
import { TabiotNotification } from '../../../orm/entities/notification/TabiotNotification';
import { createDataSource } from '../../../orm/dataSource';
import { NodeContext } from 'node-red';
import {
    ErrorNotificationQueryDto,
    CreateErrorNotificationDto,
    UpdateErrorNotificationDto,
    BulkResolveDto
} from '../dto/error-notification.dto';
import { BadRequestError, NotFoundError } from 'routing-controllers';

@Service()
export class ErrorNotificationApiService {
    private notificationRepo: Repository<TabiotNotification> | null = null;
    private initialized: boolean = false;

    constructor(
        private nodeContext?: NodeContext
    ) {
        this.initializeRepository();
    }

    /**
     * Initialize notification repository
     */
    private async initializeRepository(): Promise<void> {
        try {
            const dataSource = createDataSource(this.nodeContext);

            if (!dataSource.isInitialized) {
                await dataSource.initialize();
            }

            this.notificationRepo = dataSource.getRepository(TabiotNotification);
            this.initialized = true;
        } catch (error) {
            console.error('[ErrorNotificationApiService] Failed to initialize repository:', error);
            this.initialized = false;
        }
    }

    /**
     * Get all notifications with filtering and pagination
     */
    async getAllNotifications(queryParams: ErrorNotificationQueryDto): Promise<any> {
        if (!this.notificationRepo) {
            throw new BadRequestError('Repository not initialized');
        }

        const {
            err_code,
            severity,
            type,
            entity,
            is_read,
            board_id,
            page = 1,
            size = 20,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = queryParams;

        // Build where clause
        const where: any = {};
        if (err_code) where.err_code = Like(`%${err_code}%`);
        if (severity) where.severity = severity;
        if (type) where.type = type;
        if (entity) where.entity = Like(`%${entity}%`);
        if (is_read !== undefined) where.is_read = is_read ? 1 : 0;

        // Handle board_id filter from metadata
        const options: FindManyOptions<TabiotNotification> = {
            where,
            take: size,
            skip: (page - 1) * size,
            order: {
                [sortBy]: sortOrder.toUpperCase() as 'ASC' | 'DESC'
            }
        };

        const [data, total] = await this.notificationRepo.findAndCount(options);

        // Filter by board_id if specified (from metadata)
        let filteredData = data;
        if (board_id) {
            filteredData = data.filter(n => {
                try {
                    const metadata = typeof n.metadata === 'string' 
                        ? JSON.parse(n.metadata) 
                        : n.metadata;
                    return metadata?.board_id === board_id;
                } catch {
                    return false;
                }
            });
        }

        return {
            data: filteredData,
            total,
            page,
            size,
            totalPages: Math.ceil(total / size)
        };
    }

    /**
     * Get notification by name
     */
    async getNotificationByName(name: string): Promise<TabiotNotification> {
        if (!this.notificationRepo) {
            throw new BadRequestError('Repository not initialized');
        }

        const notification = await this.notificationRepo.findOne({
            where: { name }
        });

        if (!notification) {
            throw new NotFoundError(`Notification with name "${name}" not found`);
        }

        return notification;
    }

    /**
     * Create notification manually
     */
    async createNotification(data: CreateErrorNotificationDto): Promise<TabiotNotification> {
        if (!this.notificationRepo) {
            throw new BadRequestError('Repository not initialized');
        }

        const notification = this.notificationRepo.create({
            name: `notification_${data.entity}_${data.err_code}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            err_code: data.err_code,
            message: data.message,
            severity: data.severity,
            type: data.type,
            entity: data.entity,
            entity_label: data.entity_label || data.entity,
            is_read: 0,
            metadata: JSON.stringify(data.metadata || {}),
            created_at: new Date()
        });

        return await this.notificationRepo.save(notification);
    }

    /**
     * Update notification
     */
    async updateNotification(name: string, data: UpdateErrorNotificationDto): Promise<TabiotNotification> {
        if (!this.notificationRepo) {
            throw new BadRequestError('Repository not initialized');
        }

        const notification = await this.getNotificationByName(name);

        if (data.message !== undefined) {
            notification.message = data.message;
        }

        if (data.is_read !== undefined) {
            notification.is_read = data.is_read ? 1 : 0;
            
            // Update metadata with resolve info
            if (data.is_read) {
                const metadata = typeof notification.metadata === 'string'
                    ? JSON.parse(notification.metadata)
                    : notification.metadata || {};
                
                metadata.resolved_at = new Date().toISOString();
                metadata.resolved_by = 'manual';
                
                notification.metadata = JSON.stringify(metadata);
            }
        }

        if (data.metadata !== undefined) {
            const existingMetadata = typeof notification.metadata === 'string'
                ? JSON.parse(notification.metadata)
                : notification.metadata || {};
            
            notification.metadata = JSON.stringify({
                ...existingMetadata,
                ...data.metadata
            });
        }

        return await this.notificationRepo.save(notification);
    }

    /**
     * Delete notification
     */
    async deleteNotification(name: string): Promise<{ message: string }> {
        if (!this.notificationRepo) {
            throw new BadRequestError('Repository not initialized');
        }

        const notification = await this.getNotificationByName(name);
        await this.notificationRepo.remove(notification);

        return { message: `Notification "${name}" deleted successfully` };
    }

    /**
     * Bulk resolve notifications
     */
    async bulkResolve(filters: BulkResolveDto): Promise<{ resolved: number }> {
        if (!this.notificationRepo) {
            throw new BadRequestError('Repository not initialized');
        }

        const where: any = { is_read: 0 };
        if (filters.err_code) where.err_code = filters.err_code;
        if (filters.entity) where.entity = Like(`%${filters.entity}%`);

        const notifications = await this.notificationRepo.find({ where });

        // Filter by board_id if specified
        let toResolve = notifications;
        if (filters.board_id) {
            toResolve = notifications.filter(n => {
                try {
                    const metadata = typeof n.metadata === 'string' 
                        ? JSON.parse(n.metadata) 
                        : n.metadata;
                    return metadata?.board_id === filters.board_id;
                } catch {
                    return false;
                }
            });
        }

        // Update all to resolved
        const resolvedCount = toResolve.length;
        for (const notification of toResolve) {
            notification.is_read = 1;
            const metadata = typeof notification.metadata === 'string'
                ? JSON.parse(notification.metadata)
                : notification.metadata || {};
            
            metadata.resolved_at = new Date().toISOString();
            metadata.resolved_by = 'bulk_manual';
            
            notification.metadata = JSON.stringify(metadata);
        }

        if (toResolve.length > 0) {
            await this.notificationRepo.save(toResolve);
        }

        return { resolved: resolvedCount };
    }

    /**
     * Get statistics
     */
    async getStatistics(): Promise<any> {
        if (!this.notificationRepo) {
            throw new BadRequestError('Repository not initialized');
        }

        const [total, unread, bySeverity] = await Promise.all([
            this.notificationRepo.count(),
            this.notificationRepo.count({ where: { is_read: 0 } }),
            this.notificationRepo
                .createQueryBuilder('n')
                .select('n.severity', 'severity')
                .addSelect('COUNT(*)', 'count')
                .where('n.is_read = 0')
                .groupBy('n.severity')
                .getRawMany()
        ]);

        return {
            total,
            unread,
            resolved: total - unread,
            bySeverity: bySeverity.reduce((acc, item) => {
                acc[item.severity] = parseInt(item.count);
                return acc;
            }, {} as Record<string, number>)
        };
    }
}

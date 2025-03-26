import { Node } from 'node-red';
import { Repository } from 'typeorm';
import { DatabaseService } from '../services/databaseService';
import { ExtendedNodeMessage, Pagination } from '../interfaces/types';
import { parseUrl } from '../utils/urlParser';
import { logger } from '../utils/logger';
import { API_PATHS } from '../constants';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { convertObjectArray } from '../utils/scheduleValidator';
import { generateHashKey } from '../../../ultils/helper';
// ... (previous imports remain the same)

export class ScheduleHandler {
    private scheduleRepo: Repository<TabiotSchedule>;
    private node: Node;
    private dbService: DatabaseService;

    constructor(dbService: DatabaseService, node: Node) {
        this.dbService = dbService;
        this.scheduleRepo = dbService.getScheduleRepository();
        this.node = node;
    }

    // Utility function to adjust UTC time by +7 hours
    private adjustToUTC7(date: Date | string): Date {
        const utcDate = new Date(date);
        utcDate.setHours(utcDate.getHours() + 7);
        return utcDate;
    }

    async handleRequest(msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        try {
            const { method, url, query, payload } = msg.req || {};
            const path = parseUrl(url || '');

            logger.info(this.node, `Handling schedule request: ${method} ${path}`);

            if (!this.dbService.isInitialized()) {
                logger.info(this.node, 'Database not initialized, initializing now...');
                await this.dbService.initialize();
                logger.info(this.node, 'Database initialized successfully');
            }

            switch (method) {
                case 'GET': return await this.handleGet(path, query, msg);
                case 'POST': return await this.handlePost(path, msg);
                case 'PUT': return await this.handlePut(path, msg);
                case 'DELETE': return await this.handleDelete(path, msg);
                default: throw new Error(`Unsupported HTTP method: ${method}`);
            }
        } catch (error) {
            logger.error(this.node, `Request handling failed: ${(error as Error).message}`);
            msg.payload = { error: (error as Error).message };
            // Only set statusCode if it exists in the type
            if ('statusCode' in msg) (msg as any).statusCode = 500;
            return msg;
        }
    }

    private async handleGet(path: string, query: any, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path !== API_PATHS.SCHEDULE) {
            throw new Error('Invalid GET endpoint');
        }

        const page = parseInt(query?.page) || 1;
        const size = parseInt(query?.size) || 10;
        const orderBy = query?.order_by || 'name ASC';
        const [field, direction] = orderBy.split(' ');

        try {
            const [schedules, total] = await this.scheduleRepo.findAndCount({
                where: { is_deleted: 0 },
                take: size,
                skip: (page - 1) * size,
                order: { [field]: direction.toUpperCase() },
                relations: ['schedulePlan'],
            });

            const pagination: Pagination = {
                totalElements: total,
                totalPages: Math.ceil(total / size),
                pageSize: size,
                pageNumber: page,
                order_by: orderBy,
            };

            msg.payload = { result: { data: convertObjectArray(schedules), pagination } };
            return msg;
        } catch (error) {
            throw new Error(`GET request failed: ${(error as Error).message}`);
        }
    }

    private async handlePost(path: string, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path !== API_PATHS.SCHEDULE) {
            throw new Error('Invalid POST endpoint');
        }

        const payload = msg.payload as any;
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid payload: Payload must be an object');
        }

        try {
            const enable = typeof payload.enable === 'string'
                ? payload.enable === 'true' ? 1 : 0
                : payload.enable ? 1 : 0;

            const actionString = JSON.stringify(payload.action || {});
            const name = generateHashKey(
                payload.device_id || '',
                actionString,
                enable,
                payload.name || '',
                payload.time || '',
                payload.start_date || '',
                payload.end_date || '',
                payload.type || '',
                payload.interval || '',
                payload.start_time || '',
                payload.end_time || '',
                0,
                payload.schedule_plan_id || ''
            );

            const scheduleData: Partial<TabiotSchedule> = {
                name,
                label: payload.name,
                action: actionString,
                enable,
                device_id: payload.device_id,
                set_time: payload.time,
                start_date: payload.start_date,
                end_date: payload.end_date,
                type: payload.type || '',
                interval: payload.interval,
                start_time: payload.start_time,
                end_time: payload.end_time,
                status: payload.status || '',
                schedule_plan_id: payload.schedule_plan_id,
                is_deleted: 0,
                is_synced: 0,
                creation: this.adjustToUTC7(new Date()), // Override TypeORM default
                modified: this.adjustToUTC7(new Date()), // Override TypeORM default
            };

            const schedule = this.scheduleRepo.create(scheduleData);
            const savedSchedule = await this.scheduleRepo.save(schedule);

            const responseData = {
                ...savedSchedule,
                id: savedSchedule.name,
                name: savedSchedule.label,
                action: JSON.parse(savedSchedule.action || '{}'),
            };
            delete responseData.label;

            msg.payload = { result: { data: responseData } };
            if ('statusCode' in msg) (msg as any).statusCode = 201; // Conditional statusCode
            return msg;
        } catch (error) {
            logger.error(this.node, `POST failed: ${(error as Error).message}`);
            throw new Error(`Failed to create schedule: ${(error as Error).message}`);
        }
    }

    private async handlePut(path: string, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (!path.startsWith(`${API_PATHS.SCHEDULE}/`)) {
            throw new Error('Invalid PUT endpoint');
        }

        const name = path.split('/').pop();
        const payload = msg.payload as any;

        try {
            const updateData: Partial<TabiotSchedule> = {
                label: payload.name,
                action: payload.action ? JSON.stringify(payload.action) : undefined,
                enable: typeof payload.enable === 'string'
                    ? payload.enable === 'true' ? 1 : 0
                    : payload.enable ? 1 : 0,
                device_id: payload.device_id,
                set_time: payload.time,
                start_date: payload.start_date,
                end_date: payload.end_date,
                type: payload.type,
                interval: payload.interval,
                start_time: payload.start_time,
                end_time: payload.end_time,
                status: payload.status,
                schedule_plan_id: payload.schedule_plan_id,
                modified: this.adjustToUTC7(new Date()), // Override TypeORM default
            };

            const result = await this.scheduleRepo.update({ name }, updateData);
            if (result.affected === 0) {
                throw new Error(`Schedule with name ${name} not found`);
            }

            const updated = await this.scheduleRepo.findOneBy({ name });
            if (!updated) {
                throw new Error(`Failed to retrieve updated schedule`);
            }

            const responseData = {
                ...updated,
                id: updated.name,
                name: updated.label,
                action: JSON.parse(updated.action || '{}'),
            };
            delete responseData.label;

            msg.payload = { result: { data: responseData } };
            if ('statusCode' in msg) (msg as any).statusCode = 200; // Conditional statusCode
            return msg;
        } catch (error) {
            throw new Error(`PUT request failed: ${(error as Error).message}`);
        }
    }

    private async handleDelete(path: string, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (!path.startsWith(`${API_PATHS.SCHEDULE}`)) {
            throw new Error('Invalid DELETE endpoint');
        }

        const name = path.split('/').pop();
        try {
            const result = await this.scheduleRepo.update(
                { name },
                {
                    is_deleted: 1,
                    modified: this.adjustToUTC7(new Date()), // Override TypeORM default
                }
            );

            if (result.affected === 0) {
                throw new Error(`Schedule with name ${name} not found`);
            }

            msg.payload = { result: { message: 'Schedule marked as deleted' } };
            if ('statusCode' in msg) (msg as any).statusCode = 200; // Conditional statusCode
            return msg;
        } catch (error) {
            throw new Error(`DELETE request failed: ${(error as Error).message}`);
        }
    }
}
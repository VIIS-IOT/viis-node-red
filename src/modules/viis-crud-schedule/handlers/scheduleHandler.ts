import { Node } from 'node-red';
import { Repository } from 'typeorm';
import { DatabaseService } from '../services/databaseService';
import { ExtendedNodeMessage, Pagination } from '../interfaces/types';
import { parseUrl } from '../utils/urlParser';
import { logger } from '../utils/logger';
import { API_PATHS } from '../constants';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { convertObjectArray } from '../utils/scheduleValidator';

export class ScheduleHandler {
    private scheduleRepo: Repository<TabiotSchedule>;
    private node: Node;
    private dbService: DatabaseService; // Thêm biến để truy cập DatabaseService

    constructor(dbService: DatabaseService, node: Node) {
        this.dbService = dbService; // Lưu dbService để kiểm tra trạng thái
        this.scheduleRepo = dbService.getScheduleRepository();
        this.node = node;
    }

    async handleRequest(msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        const { method, url, query, payload } = msg.req || {};
        const path = parseUrl(url || '');

        logger.info(this.node, `Handling schedule request: ${method} ${path}`);

        // Kiểm tra và khởi tạo database nếu cần
        if (!this.dbService.isInitialized()) {
            logger.info(this.node, 'Database not initialized, initializing now...');
            try {
                await this.dbService.initialize();
                logger.info(this.node, 'Database initialized successfully');
            } catch (error) {
                logger.error(this.node, `Failed to initialize database: ${(error as Error).message}`);
                throw new Error('Database initialization failed');
            }
        }

        switch (method) {
            case 'GET':
                return await this.handleGet(path, query, msg);
            case 'POST':
                return await this.handlePost(path, payload, msg);
            case 'PUT':
                return await this.handlePut(path, payload, msg);
            case 'DELETE':
                return await this.handleDelete(path, msg);
            default:
                throw new Error(`Unsupported method: ${method}`);
        }
    }

    private async handleGet(path: string, query: any, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path === API_PATHS.SCHEDULE) {
            const page = parseInt(query?.page) || 1;
            const size = parseInt(query?.size) || 10;
            const orderBy = query?.order_by || 'name ASC';
            const [field, direction] = orderBy.split(' ');

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

            msg.payload = { result: { data: schedules, pagination } };
            msg.payload = { result: convertObjectArray(schedules) };
            return msg;
        }
        throw new Error('Invalid GET endpoint');
    }

    private async handlePost(path: string, payload: any, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path === API_PATHS.SCHEDULE) {
            const schedule = this.scheduleRepo.create(payload);
            const result = await this.scheduleRepo.save(schedule);
            msg.payload = { result: { data: result } };
            return msg;
        }
        throw new Error('Invalid POST endpoint');
    }

    private async handlePut(path: string, payload: any, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path.startsWith(`${API_PATHS.SCHEDULE}/`)) {
            const name = path.split('/').pop();
            await this.scheduleRepo.update({ name }, payload);
            const updated = await this.scheduleRepo.findOneBy({ name });
            msg.payload = { result: { data: updated || null } };
            return msg;
        }
        throw new Error('Invalid PUT endpoint');
    }

    private async handleDelete(path: string, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path.startsWith(`${API_PATHS.SCHEDULE}/`)) {
            const name = path.split('/').pop();
            await this.scheduleRepo.update({ name }, { is_deleted: 1 });
            msg.payload = { result: { message: 'Schedule marked as deleted' } };
            return msg;
        }
        throw new Error('Invalid DELETE endpoint');
    }
}
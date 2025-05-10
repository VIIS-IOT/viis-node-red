// src/handlers/scheduleHandler.ts
import { Node } from 'node-red';
import { Repository } from 'typeorm';
import { DatabaseService } from '../services/databaseService';
import { ExtendedNodeMessage, Pagination } from '../interfaces/types';
import { parseUrl } from '../utils/urlParser';
import { logger } from '../utils/logger';
import { API_PATHS } from '../constants';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { convertObjectArray } from '../utils/scheduleValidator';
import { adjustToUTC7, generateHashKey } from '../../../ultils/helper';
import { plainToInstance } from 'class-transformer';
import { TabiotScheduleDto } from '../dto/schedule.dto';
import { validateDto } from '../utils/validation';
import { SyncScheduleService } from '../../../services/syncSchedule/SyncScheduleService';
import { log } from 'console';
import Container from 'typedi';

export class ScheduleHandler {
    private scheduleRepo: Repository<TabiotSchedule>;
    private node: Node;
    private dbService: DatabaseService;
    private syncScheduleService: SyncScheduleService;

    constructor(dbService: DatabaseService, node: Node) {
        this.syncScheduleService = Container.get(SyncScheduleService);
        this.dbService = dbService;
        this.scheduleRepo = dbService.getScheduleRepository();
        this.node = node;
    }



    async handleRequest(msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        try {
            const { method, url, query, payload } = msg.req || {};
            const path = parseUrl(url || '');

            logger.info(this.node, `Handling schedule request: ${method} ${path}`);
            logger.info(this.node, `Request details: ${JSON.stringify({
                method,
                path,
                query,
                payload: method !== 'DELETE' ? payload : '[REDACTED]' // Redact payload for DELETE for security
            }, null, 2)}`);

            if (!this.dbService.isInitialized()) {
                logger.info(this.node, 'Database not initialized, initializing now...');
                await this.dbService.initialize();
                logger.info(this.node, 'Database initialized successfully');
            } else {
                logger.info(this.node, 'Database already initialized');
            }

            switch (method) {
                case 'GET':
                    return await this.handleGet(path, query, msg);
                case 'POST':
                    return await this.handlePost(path, msg);
                case 'PUT':
                    return await this.handlePut(path, msg);
                case 'DELETE':
                    return await this.handleDelete(path, msg);
                default:
                    throw new Error(`Unsupported HTTP method: ${method}`);
            }
        } catch (error) {
            logger.error(this.node, `Request handling failed: ${(error as Error).message}`);
            msg.payload = { error: (error as Error).message };
            if ('statusCode' in msg) (msg as any).statusCode = error instanceof Error && error.message.includes('Validation failed') ? 400 : 500;
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
            // Parse filters if provided
            let whereClause = { is_deleted: 0 };
            if (query?.filters) {
                try {
                    const filters = JSON.parse(query.filters);
                    for (const filter of filters) {
                        if (filter[0] === 'iot_schedule' && filter[1] === 'schedule_plan_id' && filter[2] === 'like') {
                            whereClause['schedule_plan_id'] = filter[3];
                        }
                    }
                } catch (error) {
                    logger.info(this.node, 'Failed to parse filters, using default query');
                }
            }

            logger.info(this.node, `Querying schedules with pagination: page=${page}, size=${size}, order_by=${orderBy}`);
            const [schedules, total] = await this.scheduleRepo.findAndCount({
                where: whereClause,
                take: size,
                skip: (page - 1) * size,
                order: { [field]: direction.toUpperCase() },
                relations: { schedulePlan: true },
            });
            logger.info(this.node, `Found ${schedules.length} schedules (total: ${total})`);

            // const scheduleDtos = plainToInstance(TabiotScheduleDto, schedules.map(s => ({
            //     ...s,
            //     name: s.label, // Map label to name
            //     action: JSON.parse(s.action || '{}'), // Parse action
            //     enable: s.enable === 1, // Map to boolean
            // })), { excludeExtraneousValues: true });

            const pagination: Pagination = {
                totalElements: total,
                totalPages: Math.ceil(total / size),
                pageSize: size,
                pageNumber: page,
                order_by: orderBy,
            };

            // msg.payload = { result: { data: convertObjectArray(schedules), pagination } };
            msg.payload = { result: convertObjectArray(schedules) };
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
            // Validate payload against DTO
            const dto = await validateDto(TabiotScheduleDto, payload);

            // Map DTO to entity
            const actionString = JSON.stringify(dto.action || {});
            const enable = dto.enable ? 1 : 0;
            const name = generateHashKey(
                dto.device_id || '',
                actionString,
                enable,
                dto.name || '',
                dto.start_date || '',
                dto.end_date || '',
                dto.type || '',
                dto.interval || '',
                dto.start_time || '',
                dto.end_time || '',
                0,
                dto.schedule_plan_id || ''
            );

            const scheduleData: Partial<TabiotSchedule> = {
                name,
                label: dto.name,
                action: actionString,
                enable,
                device_id: dto.device_id,
                start_date: dto.start_date,
                end_date: dto.end_date,
                type: dto.type || '',
                interval: dto.interval,
                start_time: dto.start_time,
                end_time: dto.end_time,
                status: dto.status || '',
                schedule_plan_id: dto.schedule_plan_id,
                is_deleted: 0,
                is_synced: 0,
                is_from_local: 1,
                deleted: null,
                creation: adjustToUTC7(new Date()),
                modified: adjustToUTC7(new Date()),
            };

            logger.info(this.node, `Creating new schedule: ${JSON.stringify(scheduleData)}`);
            const schedule = this.scheduleRepo.create(scheduleData);
            const savedSchedule = await this.scheduleRepo.save(schedule);
            logger.info(this.node, `Schedule saved successfully`);

            // Sync to server
            try {
                logger.info(this.node, 'Starting schedule sync to server');
                const syncRes = await this.syncScheduleService.syncScheduleFromLocalToServer([savedSchedule]);
                logger.info(this.node, 'Schedule sync completed successfully');
                // Assuming syncRes indicates success if no error is thrown or specific success condition
                // If sync is successful, update is_synced to 1
                await this.scheduleRepo.update(
                    { name: savedSchedule.name },
                    { is_synced: 1, modified: adjustToUTC7(new Date()) }
                );
                // Refresh savedSchedule with updated is_synced value
                const updatedSchedule = await this.scheduleRepo.findOneBy({ name: savedSchedule.name });
                if (updatedSchedule) {
                    Object.assign(savedSchedule, updatedSchedule);
                }
            } catch (syncError) {
                logger.info(this.node, `Sync to server failed: ${(syncError as Error).message}`);
                // If sync fails (HTTP error or timeout), keep is_synced as 0, no update needed
            }

            const responseDto = plainToInstance(TabiotScheduleDto, {
                ...savedSchedule,
                name: savedSchedule.label,
                action: JSON.parse(savedSchedule.action || '{}'),
                enable: savedSchedule.enable === 1,
            }, { excludeExtraneousValues: true });

            msg.payload = { result: { data: responseDto } };
            if ('statusCode' in msg) (msg as any).statusCode = 201;
            return msg;
        } catch (error) {
            throw error; // Let handleRequest catch and handle it
        }
    }

    private async handlePut(path: string, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (!path.startsWith(`${API_PATHS.SCHEDULE}`)) {
            throw new Error('Invalid PUT endpoint');
        }

        const payload: any = msg.payload;
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid payload: Payload must be an object');
        }

        const name = payload.id;
        if (!name || typeof name !== 'string') {
            throw new Error('No valid schedule name provided in payload');
        }

        try {
            // Validate payload against DTO
            const dto = await validateDto(TabiotScheduleDto, payload);

            // Map DTO to entity
            const updateData: Partial<TabiotSchedule> = {
                label: dto.name,
                action: dto.action ? JSON.stringify(dto.action) : undefined,
                enable: dto.enable ? 1 : 0,
                device_id: dto.device_id,
                start_date: dto.start_date,
                end_date: dto.end_date,
                type: dto.type,
                interval: dto.interval,
                start_time: dto.start_time,
                end_time: dto.end_time,
                status: dto.status,
                schedule_plan_id: dto.schedule_plan_id,
                is_from_local: 1,
                is_synced: 0,
                is_deleted: 0,
                deleted: null,
                modified: adjustToUTC7(new Date()),
            };

            logger.info(this.node, `Updating schedule: { name, updateData }`);
            const result = await this.scheduleRepo.update({ name }, updateData);
            logger.info(this.node, `Update result: affected=${result.affected}`);
            if (result.affected === 0) {
                throw new Error(`Schedule with name ${name} not found`);
            }

            const updated = await this.scheduleRepo.findOneBy({ name });
            if (!updated) {
                throw new Error(`Failed to retrieve updated schedule`);
            }

            // Sync to server
            try {
                logger.info(this.node, 'Starting schedule sync to server');
                const syncRes = await this.syncScheduleService.syncScheduleFromLocalToServer([updated]);
                logger.info(this.node, 'Schedule sync completed successfully');
                // If sync is successful, update is_synced to 1
                await this.scheduleRepo.update(
                    { name: updated.name },
                    { is_synced: 1, modified: adjustToUTC7(new Date()) }
                );
                // Refresh updated with the latest is_synced value
                const refreshedUpdated = await this.scheduleRepo.findOneBy({ name: updated.name });
                if (refreshedUpdated) {
                    Object.assign(updated, refreshedUpdated);
                }
            } catch (syncError) {
                logger.info(this.node, `Sync to server failed: ${(syncError as Error).message}`);
                // If sync fails (HTTP error or timeout), keep is_synced as 0, no update needed
            }

            const responseDto = plainToInstance(TabiotScheduleDto, {
                ...updated,
                name: updated.label,
                action: JSON.parse(updated.action || '{}'),
                enable: updated.enable === 1,
            }, { excludeExtraneousValues: true });

            msg.payload = { result: { data: responseDto } };
            if ('statusCode' in msg) (msg as any).statusCode = 200;
            return msg;
        } catch (error) {
            throw error; // Let handleRequest catch and handle it
        }
    }

    private async handleDelete(path: string, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (!path.startsWith(`${API_PATHS.SCHEDULE}`)) {
            throw new Error('Invalid DELETE endpoint');
        }

        // Extract name from either path or query parameter
        let name: string | undefined;
        const pathParts = path.split('/').filter(Boolean); // Split and remove empty parts
        const lastPathPart = pathParts[pathParts.length - 1];

        // Check if the last part of the path is a valid name (not just "schedule")
        if (lastPathPart && lastPathPart !== 'schedule') {
            name = lastPathPart;
        } else {
            // Fallback to query parameter
            const query = msg.req?.query || {};
            name = query.name as string | undefined;
        }

        if (!name) {
            throw new Error('No schedule name provided in path or query');
        }

        try {
            logger.info(this.node, `Marking schedule as deleted: ${name}`);
            const result = await this.scheduleRepo.update(
                { name },
                {
                    is_deleted: 1,
                    is_from_local: 1,
                    is_synced: 0,
                    modified: adjustToUTC7(new Date()),
                }
            );
            logger.info(this.node, `Delete result: affected=${result.affected}`);

            if (result.affected === 0) {
                throw new Error(`Schedule with name ${name} not found`);
            }

            // Retrieve the updated schedule for syncing
            const updatedSchedule = await this.scheduleRepo.findOneBy({ name });
            if (!updatedSchedule) {
                throw new Error(`Failed to retrieve updated schedule for syncing`);
            }

            // Sync to server
            try {
                logger.info(this.node, 'Starting schedule sync to server');
                const syncRes = await this.syncScheduleService.syncScheduleFromLocalToServer([updatedSchedule]);
                logger.info(this.node, 'Schedule sync completed successfully');
                // If sync is successful, update is_synced to 1
                await this.scheduleRepo.update(
                    { name: updatedSchedule.name },
                    { is_synced: 1, modified: adjustToUTC7(new Date()) }
                );
            } catch (syncError) {
                logger.info(this.node, `Sync to server failed: ${(syncError as Error).message}`);
                // If sync fails (HTTP error or timeout), keep is_synced as 0, no update needed
            }

            msg.payload = { result: { message: 'Schedule marked as deleted' } };
            if ('statusCode' in msg) (msg as any).statusCode = 200;
            return msg;
        } catch (error) {
            throw new Error(`DELETE request failed: ${(error as Error).message}`);
        }
    }
}
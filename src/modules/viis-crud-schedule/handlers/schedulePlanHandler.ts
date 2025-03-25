import { Node } from 'node-red';
import { Repository } from 'typeorm';
import { DatabaseService } from '../services/databaseService';
import { ExtendedNodeMessage, Pagination } from '../interfaces/types';
import { parseUrl } from '../utils/urlParser';
import { logger } from '../utils/logger';
import { API_PATHS } from '../constants';
import { TabiotSchedulePlan } from '../../../orm/entities/schedulePlan/TabiotSchedulePlan';
import { parseFilterParams } from '../../../ultils/helper';

export class SchedulePlanHandler {
    private planRepo: Repository<TabiotSchedulePlan>;
    private node: Node;

    constructor(dbService: DatabaseService, node: Node) {
        this.planRepo = dbService.getSchedulePlanRepository();
        this.node = node;
    }

    async handleRequest(msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        const { method, url, query, payload } = msg.req || {};
        const path = parseUrl(url || '');

        logger.info(this.node, `Handling schedule plan request: ${method} ${path}`);

        switch (method) {
            case 'GET':
                return await this.handleGetRaw(path, query, msg);
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

    private async handleGetRaw(path: string, query: any, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path === API_PATHS.SCHEDULE_PLAN) {
            const page = parseInt(query?.page) || 1;
            const size = parseInt(query?.size) || 10;
            const orderBy = query?.order_by || 'tabiot_schedule_plan.name';
            const offset = (page - 1) * size;

            // Prepare filters
            let filters: any[] = [];
            if (query.filters) {
                let paramsFilters = JSON.parse(query.filters);
                paramsFilters.forEach((element: any) => {
                    if (element[0] === 'iot_schedule') {
                        element[0] = 'iot_schedule_plan';
                    }
                    filters.push(element);
                });
            }

            // Construct SQL condition string (assuming parseFilterParams is MySQL-compatible)
            const sqlConditionStr = parseFilterParams(filters);

            // Query to get schedule plans
            const dataQuery = `
                SELECT 
                    tabiot_schedule_plan.name,
                    tabiot_schedule_plan.creation,
                    tabiot_schedule_plan.modified,
                    tabiot_schedule_plan.label,
                    tabiot_schedule_plan.schedule_count,
                    tabiot_schedule_plan.status,
                    tabiot_schedule_plan.is_deleted,
                    tabiot_schedule_plan.enable,
                    tabiot_schedule_plan.is_synced,
                    tabiot_schedule_plan.is_from_local,
                    tabiot_schedule_plan.device_id,
                    DATE_FORMAT(tabiot_schedule_plan.start_date, '%Y-%m-%d') AS start_date,
                    DATE_FORMAT(tabiot_schedule_plan.end_date, '%Y-%m-%d') AS end_date,
                    IFNULL(
                        (
                            SELECT 
                                JSON_ARRAYAGG(
                                    JSON_OBJECT(
                                        'name', tabiot_schedule.label,
                                        'id', tabiot_schedule.name,
                                        'device_id', tabiot_schedule.device_id,
                                        'status', tabiot_schedule.status,
                                        'action', IF(tabiot_schedule.action = '"{}"', JSON_OBJECT(), JSON_EXTRACT(tabiot_schedule.action, '$')),
                                        'enable', IF(tabiot_schedule.enable = 1, TRUE, FALSE),
                                        'set_time', tabiot_schedule.set_time,
                                        'start_date', tabiot_schedule.start_date,
                                        'end_date', tabiot_schedule.end_date,
                                        'type', tabiot_schedule.type,
                                        'interval', tabiot_schedule.interval,
                                        'start_time', tabiot_schedule.start_time,
                                        'end_time', tabiot_schedule.end_time,
                                        'is_from_local', tabiot_schedule.is_from_local,
                                        'is_synced', tabiot_schedule.is_synced,
                                        'schedule_plan_id', tabiot_schedule.schedule_plan_id,
                                        'is_deleted', tabiot_schedule.is_deleted,
                                        'creation', tabiot_schedule.creation,
                                        'modified', tabiot_schedule.modified
                                    )
                                )
                            FROM 
                                tabiot_schedule
                            WHERE 
                                tabiot_schedule.schedule_plan_id = tabiot_schedule_plan.name
                                AND tabiot_schedule.is_deleted = 0
                                AND tabiot_schedule.name IS NOT NULL
                        ),
                        '[]'
                    ) AS schedules
                FROM 
                    tabiot_schedule_plan
                WHERE TRUE
                    ${sqlConditionStr}
                    AND tabiot_schedule_plan.is_deleted = 0
                ORDER BY 
                    ${orderBy}
                LIMIT ? OFFSET ?
            `;
            const plans = await this.planRepo.query(dataQuery, [size, offset]);

            // Parse the schedules JSON string into an array
            const parsedPlans = plans.map((plan: any) => ({
                ...plan,
                schedules: JSON.parse(plan.schedules),
            }));

            // Query to get total count
            const countQuery = `
                SELECT 
                    COUNT(DISTINCT tabiot_schedule_plan.name) AS count
                FROM 
                    tabiot_schedule_plan
                LEFT JOIN 
                    tabiot_schedule ON tabiot_schedule_plan.name = tabiot_schedule.schedule_plan_id
                WHERE TRUE
                    ${sqlConditionStr}
                    AND tabiot_schedule_plan.is_deleted = 0
            `;
            const countResult = await this.planRepo.query(countQuery);
            const total = parseInt(countResult[0].count, 10);

            const pagination: Pagination = {
                totalElements: total,
                totalPages: Math.ceil(total / size),
                pageSize: size,
                pageNumber: page,
                order_by: orderBy,
            };

            msg.payload = { result: { data: parsedPlans, pagination } };
            return msg;
        }
        throw new Error('Invalid GET endpoint');
    }


    private async handleGet(path: string, query: any, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path === API_PATHS.SCHEDULE_PLAN) {
            const page = parseInt(query?.page) || 1;
            const size = parseInt(query?.size) || 10;
            const orderBy = query?.order_by || 'label ASC';
            const [field, direction] = orderBy.split(' ');

            const [plans, total] = await this.planRepo.findAndCount({
                where: { is_deleted: 0 },
                take: size,
                skip: (page - 1) * size,
                order: { [field]: direction.toUpperCase() },
                relations: ['schedules'],
            });

            const pagination: Pagination = {
                totalElements: total,
                totalPages: Math.ceil(total / size),
                pageSize: size,
                pageNumber: page,
                order_by: orderBy,
            };

            msg.payload = { result: { data: plans, pagination } };
            return msg;
        }
        throw new Error('Invalid GET endpoint');
    }

    private async handlePost(path: string, payload: any, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path === API_PATHS.SCHEDULE_PLAN) {
            const plan = this.planRepo.create(payload);
            const result = await this.planRepo.save(plan);
            msg.payload = { result: { data: result } };
            return msg;
        }
        throw new Error('Invalid POST endpoint');
    }

    private async handlePut(path: string, payload: any, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path.startsWith(`${API_PATHS.SCHEDULE_PLAN}/`)) {
            const name = path.split('/').pop();
            await this.planRepo.update({ name }, payload);
            const updated = await this.planRepo.findOneBy({ name });
            msg.payload = { result: { data: updated || null } };
            return msg;
        }
        throw new Error('Invalid PUT endpoint');
    }

    private async handleDelete(path: string, msg: ExtendedNodeMessage): Promise<ExtendedNodeMessage> {
        if (path.startsWith(`${API_PATHS.SCHEDULE_PLAN}/`)) {
            const name = path.split('/').pop();
            await this.planRepo.update({ name }, { is_deleted: 1 });
            msg.payload = { result: { message: 'Schedule plan marked as deleted' } };
            return msg;
        }
        throw new Error('Invalid DELETE endpoint');
    }
}
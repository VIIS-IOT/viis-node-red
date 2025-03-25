"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulePlanHandler = void 0;
const urlParser_1 = require("../utils/urlParser");
const logger_1 = require("../utils/logger");
const constants_1 = require("../constants");
const helper_1 = require("../../../ultils/helper");
class SchedulePlanHandler {
    constructor(dbService, node) {
        this.planRepo = dbService.getSchedulePlanRepository();
        this.node = node;
    }
    handleRequest(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            const { method, url, query, payload } = msg.req || {};
            const path = (0, urlParser_1.parseUrl)(url || '');
            logger_1.logger.info(this.node, `Handling schedule plan request: ${method} ${path}`);
            switch (method) {
                case 'GET':
                    return yield this.handleGetRaw(path, query, msg);
                case 'POST':
                    return yield this.handlePost(path, payload, msg);
                case 'PUT':
                    return yield this.handlePut(path, payload, msg);
                case 'DELETE':
                    return yield this.handleDelete(path, msg);
                default:
                    throw new Error(`Unsupported method: ${method}`);
            }
        });
    }
    handleGetRaw(path, query, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path === constants_1.API_PATHS.SCHEDULE_PLAN) {
                const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
                const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10;
                const orderBy = (query === null || query === void 0 ? void 0 : query.order_by) || 'tabiot_schedule_plan.name';
                const offset = (page - 1) * size;
                // Prepare filters
                let filters = [];
                if (query.filters) {
                    let paramsFilters = JSON.parse(query.filters);
                    paramsFilters.forEach((element) => {
                        if (element[0] === 'iot_schedule') {
                            element[0] = 'iot_schedule_plan';
                        }
                        filters.push(element);
                    });
                }
                // Construct SQL condition string (assuming parseFilterParams is MySQL-compatible)
                const sqlConditionStr = (0, helper_1.parseFilterParams)(filters);
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
                const plans = yield this.planRepo.query(dataQuery, [size, offset]);
                // Parse the schedules JSON string into an array
                const parsedPlans = plans.map((plan) => (Object.assign(Object.assign({}, plan), { schedules: JSON.parse(plan.schedules) })));
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
                const countResult = yield this.planRepo.query(countQuery);
                const total = parseInt(countResult[0].count, 10);
                const pagination = {
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
        });
    }
    handleGet(path, query, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path === constants_1.API_PATHS.SCHEDULE_PLAN) {
                const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
                const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10;
                const orderBy = (query === null || query === void 0 ? void 0 : query.order_by) || 'label ASC';
                const [field, direction] = orderBy.split(' ');
                const [plans, total] = yield this.planRepo.findAndCount({
                    where: { is_deleted: 0 },
                    take: size,
                    skip: (page - 1) * size,
                    order: { [field]: direction.toUpperCase() },
                    relations: ['schedules'],
                });
                const pagination = {
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
        });
    }
    handlePost(path, payload, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path === constants_1.API_PATHS.SCHEDULE_PLAN) {
                const plan = this.planRepo.create(payload);
                const result = yield this.planRepo.save(plan);
                msg.payload = { result: { data: result } };
                return msg;
            }
            throw new Error('Invalid POST endpoint');
        });
    }
    handlePut(path, payload, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path.startsWith(`${constants_1.API_PATHS.SCHEDULE_PLAN}/`)) {
                const name = path.split('/').pop();
                yield this.planRepo.update({ name }, payload);
                const updated = yield this.planRepo.findOneBy({ name });
                msg.payload = { result: { data: updated || null } };
                return msg;
            }
            throw new Error('Invalid PUT endpoint');
        });
    }
    handleDelete(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path.startsWith(`${constants_1.API_PATHS.SCHEDULE_PLAN}/`)) {
                const name = path.split('/').pop();
                yield this.planRepo.update({ name }, { is_deleted: 1 });
                msg.payload = { result: { message: 'Schedule plan marked as deleted' } };
                return msg;
            }
            throw new Error('Invalid DELETE endpoint');
        });
    }
}
exports.SchedulePlanHandler = SchedulePlanHandler;

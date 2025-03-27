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
const class_transformer_1 = require("class-transformer");
const validation_1 = require("../utils/validation");
const schedule_dto_1 = require("../dto/schedule.dto");
const schedulePlan_dto_1 = require("../dto/schedulePlan.dto");
class SchedulePlanHandler {
    constructor(dbService, node) {
        this.planRepo = dbService.getSchedulePlanRepository();
        this.node = node;
    }
    handleRequest(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { method, url, query, payload } = msg.req || {};
                const path = (0, urlParser_1.parseUrl)(url || '');
                logger_1.logger.info(this.node, `Handling schedule plan request: ${method} ${path}`);
                switch (method) {
                    case 'GET':
                        return yield this.handleGetRaw(path, query, msg); // Use handleGetRaw for now, can switch to handleGet later
                    case 'POST':
                        return yield this.handlePost(path, msg);
                    case 'PUT':
                        return yield this.handlePut(path, msg);
                    case 'DELETE':
                        return yield this.handleDelete(path, msg);
                    default:
                        throw new Error(`Unsupported method: ${method}`);
                }
            }
            catch (error) {
                logger_1.logger.error(this.node, `Request handling failed: ${error.message}`);
                msg.payload = { error: error.message };
                if ('statusCode' in msg) {
                    msg.statusCode = error instanceof Error && error.message.includes('Validation failed') ? 400 : 500;
                }
                return msg;
            }
        });
    }
    handleGetRaw(path, query, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path !== constants_1.API_PATHS.SCHEDULE_PLAN) {
                throw new Error('Invalid GET endpoint');
            }
            const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
            const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10;
            const orderBy = (query === null || query === void 0 ? void 0 : query.order_by) || 'tabiot_schedule_plan.name';
            const offset = (page - 1) * size;
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
            const sqlConditionStr = (0, helper_1.parseFilterParams)(filters);
            try {
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
                const parsedPlans = plans.map((plan) => (Object.assign(Object.assign({}, plan), { schedules: JSON.parse(plan.schedules) })));
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
            catch (error) {
                throw new Error(`GET request failed: ${error.message}`);
            }
        });
    }
    handlePost(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            let payload = msg.payload;
            if (path !== constants_1.API_PATHS.SCHEDULE_PLAN) {
                throw new Error('Invalid POST endpoint');
            }
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid payload: Payload must be an object');
            }
            try {
                // Validate payload against DTO
                const dto = yield (0, validation_1.validateDto)(schedulePlan_dto_1.TabiotSchedulePlanDto, payload);
                // Generate unique name based on provided fields
                let name = (0, helper_1.generateHashKey)(dto.label, (_a = dto.schedule_count) !== null && _a !== void 0 ? _a : 0, dto.status, 0, 1, dto.device_id, dto.start_date, dto.end_date);
                // Map DTO to entity
                const planData = {
                    name,
                    label: dto.label,
                    schedule_count: dto.schedule_count || 0,
                    status: dto.status || 'active',
                    enable: dto.enable ? 1 : 0,
                    device_id: dto.device_id,
                    start_date: dto.start_date,
                    end_date: dto.end_date,
                    is_deleted: 0,
                    is_synced: 0,
                    is_from_local: 1,
                };
                const plan = this.planRepo.create(planData);
                const savedPlan = yield this.planRepo.save(plan);
                // Transform to DTO for response
                const responseDto = (0, class_transformer_1.plainToInstance)(schedulePlan_dto_1.TabiotSchedulePlanDto, Object.assign(Object.assign({}, savedPlan), { enable: savedPlan.enable === 1, schedules: [] }), { excludeExtraneousValues: true });
                msg.payload = { result: { data: responseDto } };
                if ('statusCode' in msg)
                    msg.statusCode = 201;
                return msg;
            }
            catch (error) {
                throw error;
            }
        });
    }
    handlePut(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            let payload = msg.payload;
            if (!path.startsWith(`${constants_1.API_PATHS.SCHEDULE_PLAN}/`)) {
                throw new Error('Invalid PUT endpoint');
            }
            const name = path.split('/').pop();
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid payload: Payload must be an object');
            }
            try {
                // Validate payload against DTO
                const dto = yield (0, validation_1.validateDto)(schedulePlan_dto_1.TabiotSchedulePlanDto, payload);
                // Map DTO to entity
                const updateData = {
                    label: dto.label,
                    schedule_count: dto.schedule_count,
                    status: dto.status || 'active',
                    enable: dto.enable !== undefined ? (dto.enable ? 1 : 0) : undefined,
                    device_id: dto.device_id,
                    start_date: dto.start_date || '1998-01-22',
                    end_date: dto.end_date || '2030-01-08',
                };
                const result = yield this.planRepo.update({ name }, updateData);
                if (result.affected === 0) {
                    throw new Error(`Schedule plan with name ${name} not found`);
                }
                const updated = yield this.planRepo.findOne({
                    where: { name },
                    relations: ['schedules'],
                });
                if (!updated) {
                    throw new Error(`Failed to retrieve updated schedule plan`);
                }
                // Transform to DTO for response
                const responseDto = (0, class_transformer_1.plainToInstance)(schedulePlan_dto_1.TabiotSchedulePlanDto, Object.assign(Object.assign({}, updated), { enable: updated.enable === 1, schedules: (0, class_transformer_1.plainToInstance)(schedule_dto_1.TabiotScheduleDto, updated.schedules, { excludeExtraneousValues: true }) }), { excludeExtraneousValues: true });
                msg.payload = { result: { data: responseDto } };
                if ('statusCode' in msg)
                    msg.statusCode = 200;
                return msg;
            }
            catch (error) {
                throw error;
            }
        });
    }
    handleDelete(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!path.startsWith(`${constants_1.API_PATHS.SCHEDULE_PLAN}`)) {
                throw new Error('Invalid DELETE endpoint');
            }
            let name;
            const pathParts = path.split('/').filter(Boolean);
            const lastPathPart = pathParts[pathParts.length - 1];
            if (lastPathPart && lastPathPart !== 'schedulePlan') {
                name = lastPathPart;
            }
            else {
                const query = ((_a = msg.req) === null || _a === void 0 ? void 0 : _a.query) || {};
                name = query.name;
            }
            if (!name) {
                throw new Error('No schedule plan name provided in path or query');
            }
            try {
                const result = yield this.planRepo.update({ name }, { is_deleted: 1 });
                if (result.affected === 0) {
                    throw new Error(`Schedule plan with name ${name} not found`);
                }
                msg.payload = { result: { message: 'Schedule plan marked as deleted' } };
                if ('statusCode' in msg)
                    msg.statusCode = 200;
                return msg;
            }
            catch (error) {
                throw new Error(`DELETE request failed: ${error.message}`);
            }
        });
    }
}
exports.SchedulePlanHandler = SchedulePlanHandler;

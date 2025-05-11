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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulePlanHandler = void 0;
const urlParser_1 = require("../utils/urlParser");
const logger_1 = require("../utils/logger");
const constants_1 = require("../constants");
const helper_1 = require("../../../ultils/helper");
const class_transformer_1 = require("class-transformer");
const validation_1 = require("../utils/validation");
const schedulePlan_dto_1 = require("../dto/schedulePlan.dto");
const SyncScheduleService_1 = require("../../../services/syncSchedule/SyncScheduleService");
const typedi_1 = __importDefault(require("typedi"));
const helper_2 = require("../../../ultils/helper");
class SchedulePlanHandler {
    constructor(dbService, node) {
        console.log('Initializing SchedulePlanHandler', { dbService, node });
        this.syncScheduleService = typedi_1.default.get(SyncScheduleService_1.SyncScheduleService);
        console.log('SyncScheduleService initialized', { syncScheduleService: !!this.syncScheduleService });
        this.planRepo = dbService.getSchedulePlanRepository();
        console.log('Plan repository initialized', { planRepo: !!this.planRepo });
        this.node = node;
        console.log('Node assigned', { node });
    }
    handleRequest(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Starting handleRequest', { msg });
            try {
                const { method, url, query, payload } = msg.req || {};
                console.log('Request details', { method, url, query, payload });
                const path = (0, urlParser_1.parseUrl)(url || '');
                console.log('Parsed path', { path });
                logger_1.logger.info(this.node, `Handling schedule plan request: ${method} ${path}`);
                console.log('Logged request info', { method, path });
                switch (method) {
                    case 'GET':
                        console.log('Routing to handleGetRaw');
                        return yield this.handleGetRaw(path, query, msg);
                    case 'POST':
                        console.log('Routing to handlePost');
                        return yield this.handlePost(path, msg);
                    case 'PUT':
                        console.log('Routing to handlePut');
                        return yield this.handlePut(path, msg);
                    case 'DELETE':
                        console.log('Routing to handleDelete');
                        return yield this.handleDelete(path, msg);
                    default:
                        console.error('Unsupported method', { method });
                        throw new Error(`Unsupported method: ${method}`);
                }
            }
            catch (error) {
                console.error('Error in handleRequest', { error: error.message, stack: error.stack });
                logger_1.logger.error(this.node, `Request handling failed: ${error.message}`);
                msg.payload = { error: error.message };
                if ('statusCode' in msg) {
                    msg.statusCode = error instanceof Error && error.message.includes('Validation failed') ? 400 : 500;
                    console.log('Set statusCode', { statusCode: msg.statusCode });
                }
                console.log('Returning error response', { msg });
                return msg;
            }
        });
    }
    handleGetRaw(path, query, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Starting handleGetRaw', { path, query });
            if (path !== constants_1.API_PATHS.SCHEDULE_PLAN) {
                console.error('Invalid GET endpoint', { path });
                throw new Error('Invalid GET endpoint');
            }
            const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
            const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10;
            const orderBy = (query === null || query === void 0 ? void 0 : query.order_by) || 'tabiot_schedule_plan.name';
            const offset = (page - 1) * size;
            console.log('Parsed query parameters', { page, size, orderBy, offset });
            let filters = [];
            if (query.filters) {
                console.log('Raw filters from query', query.filters);
                let paramsFilters = JSON.parse(query.filters);
                console.log('Parsed filters JSON', paramsFilters);
                paramsFilters.forEach((element) => {
                    if (element[0] === 'iot_schedule') {
                        element[0] = 'iot_schedule_plan';
                    }
                    filters.push(element);
                });
                console.log('Processed filters', filters);
            }
            const sqlConditionStr = (0, helper_1.parseFilterParams)(filters);
            console.log('Generated SQL condition string', sqlConditionStr);
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
                  tabiot_schedule_plan.deleted,
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
                  AND tabiot_schedule_plan.is_deleted = 0
                  AND tabiot_schedule_plan.deleted IS NULL
                ORDER BY 
                  ${orderBy}
                LIMIT ? OFFSET ?
            `;
                console.log('Executing data query', { dataQuery, params: [size, offset] });
                const plans = yield this.planRepo.query(dataQuery, [size, offset]);
                console.log('Raw query results', plans);
                const parsedPlans = plans.map((plan) => (Object.assign(Object.assign({}, plan), { schedules: JSON.parse(plan.schedules) })));
                console.log('Parsed plans', parsedPlans);
                const countQuery = `
                SELECT 
                  COUNT(DISTINCT tabiot_schedule_plan.name) AS count
                FROM 
                  tabiot_schedule_plan
                LEFT JOIN 
                  tabiot_schedule ON tabiot_schedule_plan.name = tabiot_schedule.schedule_plan_id
                WHERE TRUE
                  AND tabiot_schedule_plan.is_deleted = 0
            `;
                console.log('Executing count query', { countQuery });
                const countResult = yield this.planRepo.query(countQuery);
                console.log('Count query result', countResult);
                const total = parseInt(countResult[0].count, 10);
                console.log('Total count', total);
                const pagination = {
                    totalElements: total,
                    totalPages: Math.ceil(total / size),
                    pageSize: size,
                    pageNumber: page,
                    order_by: orderBy,
                };
                console.log('Pagination info', pagination);
                msg.payload = { result: { data: parsedPlans, pagination } };
                console.log('Final response payload', msg.payload);
                return msg;
            }
            catch (error) {
                console.error('Error in handleGetRaw', { error: error.message, stack: error.stack });
                throw new Error(`GET request failed: ${error.message}`);
            }
        });
    }
    handlePost(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            console.log('Starting handlePost', { path, payload: msg.payload });
            let payload = msg.payload;
            if (path !== `${constants_1.API_PATHS.SCHEDULE_PLAN}/ver2`) {
                console.error('Invalid POST endpoint', { path });
                throw new Error('Invalid POST endpoint');
            }
            if (!payload || typeof payload !== 'object') {
                console.error('Invalid payload', { payload });
                throw new Error('Invalid payload: Payload must be an object');
            }
            try {
                console.log('Validating payload', { payload });
                const dto = yield (0, validation_1.validateDto)(schedulePlan_dto_1.TabiotSchedulePlanDto, payload);
                console.log('Validated DTO', { dto });
                let name = (0, helper_1.generateHashKey)(dto.label, (_a = dto.schedule_count) !== null && _a !== void 0 ? _a : 0, dto.status, 0, 1, dto.device_id, dto.start_date, dto.end_date);
                console.log('Generated name', { name });
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
                    deleted: null,
                    creation: new Date(Date.now() + 7 * 60 * 60 * 1000),
                    modified: new Date(Date.now() + 7 * 60 * 60 * 1000),
                };
                console.log('Prepared plan data', { planData });
                const plan = this.planRepo.create(planData);
                console.log('Created plan entity', { plan });
                const savedPlan = yield this.planRepo.save(plan);
                console.log('Saved plan', { savedPlan });
                try {
                    console.log('Attempting to sync plan to server', { planName: savedPlan.name });
                    const syncRes = yield this.syncScheduleService.syncSchedulePlanFromLocalToServer([savedPlan]);
                    console.log('Sync response', { syncRes });
                    yield this.planRepo.update({ name: savedPlan.name }, { is_synced: 1, modified: (0, helper_2.adjustToUTC7)(new Date()) });
                    console.log('Updated is_synced for plan', { planName: savedPlan.name });
                    const refreshedUpdated = yield this.planRepo.findOneBy({ name: savedPlan.name });
                    console.log('Refreshed plan after sync', { refreshedUpdated });
                    if (refreshedUpdated) {
                        Object.assign(savedPlan, refreshedUpdated);
                        console.log('Updated savedPlan with refreshed data', { savedPlan });
                    }
                }
                catch (syncError) {
                    console.error('Sync to server failed', { error: syncError.message, stack: syncError.stack });
                    logger_1.logger.info(this.node, `Sync to server failed: ${syncError.message}`);
                }
                const responseDto = (0, class_transformer_1.plainToInstance)(schedulePlan_dto_1.TabiotSchedulePlanDto, Object.assign(Object.assign({}, savedPlan), { enable: savedPlan.enable === 1, schedules: [] }), { excludeExtraneousValues: true });
                console.log('Transformed response DTO', { responseDto });
                msg.payload = { result: { data: responseDto } };
                if ('statusCode' in msg)
                    msg.statusCode = 201;
                console.log('Final response payload', { payload: msg.payload, statusCode: msg.statusCode });
                return msg;
            }
            catch (error) {
                console.error('Error in handlePost', { error: error.message, stack: error.stack });
                throw error;
            }
        });
    }
    handlePut(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Starting handlePut', { path, payload: msg.payload });
            if (!path.startsWith(`${constants_1.API_PATHS.SCHEDULE_PLAN}/ver2`)) {
                console.error('Invalid PUT endpoint', { path });
                console.error(`correct path: ${constants_1.API_PATHS.SCHEDULE_PLAN}/ver2`);
                throw new Error('Invalid PUT endpoint');
            }
            const payload = msg.payload;
            if (!payload || typeof payload !== 'object') {
                console.error('Invalid payload', { payload });
                throw new Error('Invalid payload: Payload must be an object');
            }
            const name = payload.name;
            if (!name || typeof name !== 'string') {
                console.error('Invalid schedule plan name', { name });
                throw new Error('No valid schedule plan name provided in payload');
            }
            try {
                console.log('Validating payload', { payload });
                const dto = yield (0, validation_1.validateDto)(schedulePlan_dto_1.TabiotSchedulePlanDto, payload);
                console.log('Validated DTO', { dto });
                logger_1.logger.info(this.node, `Validated DTO: ${JSON.stringify(dto)}`);
                console.log('Checking for existing plan', { name });
                const existingPlan = yield this.planRepo.findOne({
                    where: { name: name },
                });
                console.log('Existing plan result', { existingPlan });
                if (!existingPlan) {
                    console.error('Schedule plan not found', { name });
                    throw new Error(`Schedule plan with name ${name} not found`);
                }
                // Check if there are any running schedules in this plan
                const runningSchedules = yield this.planRepo.createQueryBuilder('plan')
                    .leftJoinAndSelect('plan.schedules', 'schedule')
                    .where('plan.name = :planName', { planName: name })
                    .andWhere('schedule.status = :status', { status: 'running' })
                    .getCount();
                // Prevent disabling if there are running schedules
                if (dto.enable === 0 && runningSchedules > 0) {
                    throw new Error('Cannot disable schedule plan while it has running schedules');
                }
                const updateData = {
                    label: dto.label,
                    schedule_count: dto.schedule_count,
                    status: dto.status || 'active',
                    enable: dto.enable !== undefined ? (dto.enable ? 1 : 0) : undefined,
                    device_id: dto.device_id,
                    start_date: dto.start_date || '1998-01-22',
                    end_date: dto.end_date || '2030-01-08',
                    is_deleted: 0,
                    is_synced: 0,
                    is_from_local: 1,
                    deleted: null,
                    modified: (0, helper_2.adjustToUTC7)(new Date()),
                };
                console.log('Prepared update data', { updateData });
                logger_1.logger.info(this.node, `Updating schedule plan ${name} with data: ${JSON.stringify(updateData)}`);
                const result = yield this.planRepo.update(name, updateData);
                console.log('Update result', { result });
                logger_1.logger.info(this.node, `Update result: ${JSON.stringify(result)}`);
                if (result.affected === 0) {
                    console.error('Update affected 0 rows', { name });
                    logger_1.logger.info(this.node, `Update affected 0 rows for existing plan ${name}`);
                    throw new Error(`Failed to update schedule plan ${name}`);
                }
                console.log('Retrieving updated plan', { name });
                const updated = yield this.planRepo.findOneBy({ name });
                console.log('Retrieved updated plan', { updated });
                if (!updated) {
                    console.error('Failed to retrieve updated plan', { name });
                    logger_1.logger.error(this.node, `Failed to retrieve updated schedule plan ${name} after successful update`);
                    throw new Error(`Failed to retrieve updated schedule plan ${name}`);
                }
                try {
                    console.log('Attempting to sync updated plan to server', { planName: updated.name });
                    const syncRes = yield this.syncScheduleService.syncSchedulePlanFromLocalToServer([updated]);
                    console.log('Sync response', { syncRes });
                    yield this.planRepo.update({ name: updated.name }, { is_synced: 1, modified: (0, helper_2.adjustToUTC7)(new Date()) });
                    console.log('Updated is_synced for plan', { planName: updated.name });
                    const refreshedUpdated = yield this.planRepo.findOneBy({ name: updated.name });
                    console.log('Refreshed plan after sync', { refreshedUpdated });
                    if (refreshedUpdated) {
                        Object.assign(updated, refreshedUpdated);
                        console.log('Updated plan with refreshed data', { updated });
                    }
                }
                catch (syncError) {
                    console.error('Sync to server failed', { error: syncError.message, stack: syncError.stack });
                    logger_1.logger.info(this.node, `Sync to server failed: ${syncError.message}`);
                }
                const responseDto = (0, class_transformer_1.plainToInstance)(schedulePlan_dto_1.TabiotSchedulePlanDto, Object.assign(Object.assign({}, updated), { enable: updated.enable === 1, schedules: [] }), { excludeExtraneousValues: true });
                console.log('Transformed response DTO', { responseDto });
                msg.payload = { result: { data: responseDto } };
                if ('statusCode' in msg)
                    msg.statusCode = 200;
                console.log('Final response payload', { payload: msg.payload, statusCode: msg.statusCode });
                return msg;
            }
            catch (error) {
                console.error('Error in handlePut', { error: error.message, stack: error.stack });
                logger_1.logger.error(this.node, `PUT error: ${error.message}`);
                throw new Error(`PUT request failed: ${error.message}`);
            }
        });
    }
    handleDelete(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            console.log('Starting handleDelete', { path });
            if (!path.startsWith(`${constants_1.API_PATHS.SCHEDULE_PLAN}`)) {
                console.error('Invalid DELETE endpoint', { path });
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
            console.log('Parsed name for deletion', { name });
            if (!name) {
                console.error('No schedule plan name provided', { path, query: (_b = msg.req) === null || _b === void 0 ? void 0 : _b.query });
                throw new Error('No schedule plan name provided in path or query');
            }
            try {
                console.log('Attempting to mark plan as deleted', { name });
                const result = yield this.planRepo.update({ name }, { is_deleted: 1 });
                console.log('Delete update result', { result });
                if (result.affected === 0) {
                    console.error('Schedule plan not found for deletion', { name });
                    throw new Error(`Schedule plan with name ${name} not found`);
                }
                msg.payload = { result: { message: 'Schedule plan marked as deleted' } };
                if ('statusCode' in msg)
                    msg.statusCode = 200;
                console.log('Final response payload', { payload: msg.payload, statusCode: msg.statusCode });
                return msg;
            }
            catch (error) {
                console.error('Error in handleDelete', { error: error.message, stack: error.stack });
                throw new Error(`DELETE request failed: ${error.message}`);
            }
        });
    }
}
exports.SchedulePlanHandler = SchedulePlanHandler;

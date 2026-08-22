"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulePlanHandler = void 0;
const urlParser_1 = require("../utils/urlParser");
const logger_1 = require("../utils/logger");
const constants_1 = require("../constants");
const helper_1 = require("../../../ultils/helper");
const validation_1 = require("../utils/validation");
const schedulePlan_dto_1 = require("../dto/schedulePlan.dto");
const SyncScheduleService_1 = require("../../../services/syncSchedule/SyncScheduleService");
class SchedulePlanHandler {
    constructor(dbService, node) {
        this.node = node;
        this.syncScheduleService = new SyncScheduleService_1.SyncScheduleService(node.context());
        this.planRepo = dbService.getSchedulePlanRepository();
        this.scheduleRepo = dbService.getScheduleRepository();
    }
    async handleRequest(msg) {
        try {
            const { method, url, query, payload } = msg.req || {};
            const path = (0, urlParser_1.parseUrl)(url || '');
            logger_1.logger.info(this.node, `Handling schedule plan request: ${method} ${path}`);
            switch (method) {
                case 'GET':
                    return await this.handleGetRaw(path, query, msg);
                case 'POST':
                    return await this.handlePost(path, msg);
                case 'PUT':
                    return await this.handlePut(path, msg);
                case 'DELETE':
                    return await this.handleDelete(path, msg);
                default:
                    throw new Error(`Unsupported method: ${method}`);
            }
        }
        catch (error) {
            logger_1.logger.error(this.node, `Request handling failed: ${error.message}`);
            msg.payload = { error: error.message };
            // Set appropriate status code
            const errorMsg = error.message;
            // Business logic errors should return 400
            const isBadRequest = errorMsg.includes('Validation failed') ||
                errorMsg.includes('Cannot disable') ||
                errorMsg.includes('not found') ||
                errorMsg.includes('Invalid');
            msg.statusCode = isBadRequest ? 400 : 500;
            return msg;
        }
    }
    async handleGetRaw(path, query, msg) {
        if (path !== constants_1.API_PATHS.SCHEDULE_PLAN) {
            throw new Error('Invalid GET endpoint');
        }
        const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
        const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 1000;
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
                  ${sqlConditionStr}
                ORDER BY 
                  ${orderBy}
                LIMIT ? OFFSET ?
            `;
            const plans = await this.planRepo.query(dataQuery, [size, offset]);
            const parsedPlans = plans.map((plan) => (Object.assign(Object.assign({}, plan), { schedules: JSON.parse(plan.schedules) })));
            const countQuery = `
                SELECT 
                  COUNT(DISTINCT tabiot_schedule_plan.name) AS count
                FROM 
                  tabiot_schedule_plan
                LEFT JOIN 
                  tabiot_schedule ON tabiot_schedule_plan.name = tabiot_schedule.schedule_plan_id
                WHERE TRUE
                  AND tabiot_schedule_plan.is_deleted = 0
                  ${sqlConditionStr}
            `;
            const countResult = await this.planRepo.query(countQuery);
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
    }
    async handlePost(path, msg) {
        var _a;
        let payload = msg.payload;
        if (path !== `${constants_1.API_PATHS.SCHEDULE_PLAN}`) {
            throw new Error('Invalid POST endpoint');
        }
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid payload: Payload must be an object');
        }
        try {
            const dto = await (0, validation_1.validateDto)(schedulePlan_dto_1.TabiotSchedulePlanDto, payload);
            let name = (0, helper_1.generateHashKey)(dto.label, (_a = dto.schedule_count) !== null && _a !== void 0 ? _a : 0, dto.status, 0, 1, dto.device_id, dto.start_date, dto.end_date);
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
                creation: new Date(),
                modified: new Date(),
            };
            const plan = this.planRepo.create(planData);
            const savedPlan = await this.planRepo.save(plan);
            this.node.warn(`✓ CREATE LOCAL: Schedule Plan "${dto.label}" created successfully in local database`);
            try {
                const syncRes = await this.syncScheduleService.syncSchedulePlanFromLocalToServer([savedPlan]);
                await this.planRepo.update({ name: savedPlan.name }, { is_synced: 1 });
                const refreshedUpdated = await this.planRepo.findOneBy({ name: savedPlan.name });
                if (refreshedUpdated) {
                    Object.assign(savedPlan, refreshedUpdated);
                }
                this.node.warn(`✓ SYNC TO SERVER: Schedule Plan "${dto.label}" synced successfully to server`);
            }
            catch (syncError) {
                logger_1.logger.info(this.node, `Sync to server failed: ${syncError.message}`);
                this.node.warn(`✗ SYNC TO SERVER FAILED: Schedule Plan "${dto.label}" - ${syncError.message}`);
            }
            // Create a response object with all necessary fields
            const responseData = {
                name: savedPlan.name,
                label: savedPlan.label,
                schedule_count: savedPlan.schedule_count,
                status: savedPlan.status,
                enable: savedPlan.enable === 1,
                device_id: savedPlan.device_id,
                start_date: savedPlan.start_date,
                end_date: savedPlan.end_date,
                is_deleted: savedPlan.is_deleted,
                is_synced: savedPlan.is_synced,
                is_from_local: savedPlan.is_from_local,
                creation: savedPlan.creation,
                modified: savedPlan.modified,
                schedules: []
            };
            msg.payload = { result: { data: responseData } };
            if ('statusCode' in msg)
                msg.statusCode = 201;
            return msg;
        }
        catch (error) {
            this.node.warn(`✗ CREATE LOCAL FAILED: ${error.message}`);
            throw error;
        }
    }
    async handlePut(path, msg) {
        if (!path.startsWith(`${constants_1.API_PATHS.SCHEDULE_PLAN}/ver2`)) {
            throw new Error('Invalid PUT endpoint');
        }
        const payload = msg.payload;
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid payload: Payload must be an object');
        }
        const name = payload.name;
        if (!name || typeof name !== 'string') {
            throw new Error('No valid schedule plan name provided in payload');
        }
        try {
            const dto = await (0, validation_1.validateDto)(schedulePlan_dto_1.TabiotSchedulePlanDto, payload);
            logger_1.logger.info(this.node, `Validated DTO: ${JSON.stringify(dto)}`);
            const existingPlan = await this.planRepo.findOne({
                where: { name: name },
            });
            if (!existingPlan) {
                throw new Error(`Schedule plan with name ${name} not found`);
            }
            // Check if trying to disable a schedule plan with running schedules
            const isDisabling = dto.enable === 0;
            if (isDisabling) {
                const runningSchedules = await this.scheduleRepo.count({
                    where: {
                        schedule_plan_id: name,
                        status: 'running',
                        is_deleted: 0
                    }
                });
                if (runningSchedules > 0) {
                    const errorMsg = `Cannot disable schedule plan "${dto.label || name}": ${runningSchedules} schedule(s) are currently running. Please finish or disable all running schedules first.`;
                    this.node.warn(`❌ DISABLE BLOCKED: ${errorMsg}`);
                    throw new Error(errorMsg);
                }
                this.node.warn(`✓ VALIDATION PASSED: No running schedules found for plan "${dto.label || name}", proceeding with disable`);
            }
            const updateData = {
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
                modified: new Date(),
            };
            logger_1.logger.info(this.node, `Updating schedule plan ${name}`);
            const result = await this.planRepo.update(name, updateData);
            if (result.affected === 0) {
                throw new Error(`Failed to update schedule plan ${name}`);
            }
            const updated = await this.planRepo.findOneBy({ name });
            if (!updated) {
                throw new Error(`Failed to retrieve updated schedule plan ${name}`);
            }
            this.node.warn(`✓ UPDATE LOCAL: Schedule Plan "${dto.label}" updated successfully in local database`);
            try {
                const syncRes = await this.syncScheduleService.syncSchedulePlanFromLocalToServer([updated]);
                await this.planRepo.update({ name: updated.name }, { is_synced: 1 });
                const refreshedUpdated = await this.planRepo.findOneBy({ name: updated.name });
                if (refreshedUpdated) {
                    Object.assign(updated, refreshedUpdated);
                }
                this.node.warn(`✓ SYNC TO SERVER: Schedule Plan "${dto.label}" synced successfully to server`);
            }
            catch (syncError) {
                logger_1.logger.info(this.node, `Sync to server failed: ${syncError.message}`);
                this.node.warn(`✗ SYNC TO SERVER FAILED: Schedule Plan "${dto.label}" - ${syncError.message}`);
            }
            // Create a response object with all necessary fields
            const responseData = {
                name: updated.name,
                label: updated.label,
                schedule_count: updated.schedule_count,
                status: updated.status,
                enable: updated.enable === 1,
                device_id: updated.device_id,
                start_date: updated.start_date,
                end_date: updated.end_date,
                is_deleted: updated.is_deleted,
                is_synced: updated.is_synced,
                is_from_local: updated.is_from_local,
                creation: updated.creation,
                modified: updated.modified,
                schedules: []
            };
            msg.payload = { result: { data: responseData } };
            if ('statusCode' in msg)
                msg.statusCode = 200;
            return msg;
        }
        catch (error) {
            logger_1.logger.error(this.node, `PUT error: ${error.message}`);
            this.node.warn(`✗ UPDATE LOCAL FAILED: ${error.message}`);
            throw new Error(`PUT request failed: ${error.message}`);
        }
    }
    async handleDelete(path, msg) {
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
            const result = await this.planRepo.update({ name }, {
                is_deleted: 1,
                is_from_local: 1,
                is_synced: 0,
                modified: new Date(),
            });
            if (result.affected === 0) {
                throw new Error(`Schedule plan with name ${name} not found`);
            }
            // Retrieve the updated schedule plan for syncing
            const updatedPlan = await this.planRepo.findOneBy({ name });
            if (!updatedPlan) {
                throw new Error(`Failed to retrieve updated schedule plan for syncing`);
            }
            this.node.warn(`✓ DELETE LOCAL: Schedule Plan "${name}" marked as deleted in local database`);
            // Sync to server
            try {
                logger_1.logger.info(this.node, 'Starting schedule plan sync to server');
                const syncRes = await this.syncScheduleService.syncSchedulePlanFromLocalToServer([updatedPlan]);
                logger_1.logger.info(this.node, 'Schedule plan sync completed successfully');
                // If sync is successful, update is_synced to 1
                await this.planRepo.update({ name: updatedPlan.name }, { is_synced: 1 });
                this.node.warn(`✓ SYNC TO SERVER: Schedule Plan "${name}" deletion synced successfully to server`);
            }
            catch (syncError) {
                logger_1.logger.info(this.node, `Sync to server failed: ${syncError.message}`);
                this.node.warn(`✗ SYNC TO SERVER FAILED: Schedule Plan "${name}" - ${syncError.message}`);
                // If sync fails (HTTP error or timeout), keep is_synced as 0, no update needed
            }
            msg.payload = { result: { message: 'Schedule plan marked as deleted' } };
            if ('statusCode' in msg)
                msg.statusCode = 200;
            return msg;
        }
        catch (error) {
            this.node.warn(`✗ DELETE LOCAL FAILED: Schedule Plan "${name}" - ${error.message}`);
            throw new Error(`DELETE request failed: ${error.message}`);
        }
    }
}
exports.SchedulePlanHandler = SchedulePlanHandler;

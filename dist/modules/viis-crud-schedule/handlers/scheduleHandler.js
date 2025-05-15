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
exports.ScheduleHandler = void 0;
const urlParser_1 = require("../utils/urlParser");
const logger_1 = require("../utils/logger");
const constants_1 = require("../constants");
const scheduleValidator_1 = require("../utils/scheduleValidator");
const helper_1 = require("../../../ultils/helper");
const class_transformer_1 = require("class-transformer");
const schedule_dto_1 = require("../dto/schedule.dto");
const SyncScheduleService_1 = require("../../../services/syncSchedule/SyncScheduleService");
const typedi_1 = __importDefault(require("typedi"));
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const typeorm_1 = require("typeorm");
class ScheduleHandler {
    constructor(dbService, node) {
        this.syncScheduleService = typedi_1.default.get(SyncScheduleService_1.SyncScheduleService);
        this.dbService = dbService;
        this.scheduleRepo = dbService.getScheduleRepository();
        this.node = node;
    }
    handleRequest(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { method, url, query, payload } = msg.req || {};
                const path = (0, urlParser_1.parseUrl)(url || '');
                logger_1.logger.info(this.node, `Handling schedule request: ${method} ${path}`);
                logger_1.logger.info(this.node, `Request details: ${JSON.stringify({
                    method,
                    path,
                    query,
                    payload: method !== 'DELETE' ? payload : '[REDACTED]' // Redact payload for DELETE for security
                }, null, 2)}`);
                if (!this.dbService.isInitialized()) {
                    logger_1.logger.info(this.node, 'Database not initialized, initializing now...');
                    yield this.dbService.initialize();
                    logger_1.logger.info(this.node, 'Database initialized successfully');
                }
                else {
                    logger_1.logger.info(this.node, 'Database already initialized');
                }
                switch (method) {
                    case 'GET':
                        return yield this.handleGet(path, query, msg);
                    case 'POST':
                        return yield this.handlePost(path, msg);
                    case 'PUT':
                        return yield this.handlePut(path, msg);
                    case 'DELETE':
                        return yield this.handleDelete(path, msg);
                    default:
                        throw new Error(`Unsupported HTTP method: ${method}`);
                }
            }
            catch (error) {
                logger_1.logger.error(this.node, `Request handling failed: ${error.message}`);
                msg.payload = { error: error.message };
                if ('statusCode' in msg)
                    msg.statusCode = error instanceof Error && error.message.includes('Validation failed') ? 400 : 500;
                return msg;
            }
        });
    }
    handleGet(path, query, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path === constants_1.API_PATHS.SCHEDULE_RUNNING) {
                return yield this.handleGetRunningSchedules(query, msg);
            }
            else if (path !== constants_1.API_PATHS.SCHEDULE) {
                throw new Error('Invalid GET endpoint');
            }
            const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
            const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10;
            const orderBy = (query === null || query === void 0 ? void 0 : query.order_by) || 'name ASC';
            const [field, direction] = orderBy.split(' ');
            try {
                // Parse filters if provided
                let whereClause = { is_deleted: 0 };
                if (query === null || query === void 0 ? void 0 : query.filters) {
                    try {
                        const filters = JSON.parse(query.filters);
                        for (const filter of filters) {
                            if (filter[0] === 'iot_schedule' && filter[1] === 'schedule_plan_id' && filter[2] === 'like') {
                                whereClause['schedule_plan_id'] = filter[3];
                            }
                        }
                    }
                    catch (error) {
                        logger_1.logger.info(this.node, 'Failed to parse filters, using default query');
                    }
                }
                // logger.info(this.node, `Querying schedules with pagination: page=${page}, size=${size}, order_by=${orderBy}`);
                // logger.info(this.node,`whereClause: ${JSON.stringify(whereClause)}`);
                const [schedules, total] = yield this.scheduleRepo.findAndCount({
                    where: whereClause,
                    take: size,
                    skip: (page - 1) * size,
                    order: { [field]: direction.toUpperCase() },
                    relations: { schedulePlan: true },
                });
                // logger.info(this.node, `Found ${schedules.length} schedules (total: ${total})`);
                // const scheduleDtos = plainToInstance(TabiotScheduleDto, schedules.map(s => ({
                //     ...s,
                //     name: s.label, // Map label to name
                //     action: JSON.parse(s.action || '{}'), // Parse action
                //     enable: s.enable === 1, // Map to boolean
                // })), { excludeExtraneousValues: true });
                const pagination = {
                    totalElements: total,
                    totalPages: Math.ceil(total / size),
                    pageSize: size,
                    pageNumber: page,
                    order_by: orderBy,
                };
                const result = (0, scheduleValidator_1.convertObjectArray)(schedules);
                // console.log(result);
                // msg.payload = { result: { data: convertObjectArray(schedules), pagination } };
                msg.payload = { result };
                return msg;
            }
            catch (error) {
                throw new Error(`GET request failed: ${error.message}`);
            }
        });
    }
    handlePost(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path !== `${constants_1.API_PATHS.SCHEDULE}/ver2`) {
                throw new Error('Invalid POST endpoint');
            }
            const payload = msg.payload;
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid payload: Payload must be an object');
            }
            try {
                // Validate payload against DTO
                console.log("request post body", payload);
                // const dto = await validateDto(TabiotScheduleDto, payload);
                const dto = payload;
                // Map DTO to entity
                const actionString = JSON.stringify(dto.action || {});
                const enable = dto.enable ? 1 : 0;
                const name = (0, helper_1.generateHashKey)(dto.device_id || '', actionString, enable, dto.name || '', dto.start_date || '', dto.end_date || '', dto.type || '', dto.interval || '', dto.start_time || '', dto.end_time || '', 0, dto.schedule_plan_id || '');
                const scheduleData = {
                    name,
                    label: dto.name,
                    action: actionString,
                    enable: Number(dto.enable) || 1,
                    device_id: dto.device_id,
                    start_date: dto.start_date,
                    end_date: dto.end_date,
                    type: dto.type || '',
                    interval: dto.interval,
                    start_time: dto.start_time,
                    end_time: dto.end_time,
                    status: dto.status || 'finished',
                    schedule_plan_id: dto.schedule_plan_id,
                    is_deleted: 0,
                    is_synced: 0,
                    is_from_local: 1,
                    deleted: null,
                    creation: (0, helper_1.adjustToUTC7)(new Date()),
                    modified: (0, helper_1.adjustToUTC7)(new Date()),
                };
                logger_1.logger.info(this.node, `Creating new schedule: ${JSON.stringify(scheduleData)}`);
                const schedule = this.scheduleRepo.create(scheduleData);
                const savedSchedule = yield this.scheduleRepo.save(schedule);
                logger_1.logger.info(this.node, `Schedule saved successfully`);
                // Sync to server
                try {
                    logger_1.logger.info(this.node, 'Starting schedule sync to server');
                    const syncRes = yield this.syncScheduleService.syncScheduleFromLocalToServer([savedSchedule]);
                    logger_1.logger.info(this.node, 'Schedule sync completed successfully');
                    // Assuming syncRes indicates success if no error is thrown or specific success condition
                    // If sync is successful, update is_synced to 1
                    yield this.scheduleRepo.update({ name: savedSchedule.name }, { is_synced: 1, modified: (0, helper_1.adjustToUTC7)(new Date()) });
                    // Refresh savedSchedule with updated is_synced value
                    const updatedSchedule = yield this.scheduleRepo.findOneBy({ name: savedSchedule.name });
                    if (updatedSchedule) {
                        Object.assign(savedSchedule, updatedSchedule);
                    }
                }
                catch (syncError) {
                    logger_1.logger.info(this.node, `Sync to server failed: ${syncError.message}`);
                    // If sync fails (HTTP error or timeout), keep is_synced as 0, no update needed
                }
                const responseDto = (0, class_transformer_1.plainToInstance)(schedule_dto_1.TabiotScheduleDto, Object.assign(Object.assign({}, savedSchedule), { name: savedSchedule.label, action: JSON.parse(savedSchedule.action || '{}'), enable: savedSchedule.enable === 1 }), { excludeExtraneousValues: true });
                msg.payload = { result: { data: responseDto } };
                if ('statusCode' in msg)
                    msg.statusCode = 201;
                return msg;
            }
            catch (error) {
                logger_1.logger.error(this.node, `POST request failed: ${error.message}`);
                throw error; // Let handleRequest catch and handle it
            }
        });
    }
    handlePut(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!path.startsWith(`${constants_1.API_PATHS.SCHEDULE}/ver2`)) {
                throw new Error('Invalid PUT endpoint');
            }
            const payload = msg.payload;
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid payload: Payload must be an object');
            }
            const name = payload.id;
            if (!name || typeof name !== 'string') {
                throw new Error('No valid schedule name provided in payload');
            }
            // Get existing schedule to check current status
            const existingSchedule = yield this.scheduleRepo.findOne({
                where: { name },
                select: ['status']
            });
            if (!existingSchedule) {
                throw new Error(`Schedule with name ${name} not found`);
            }
            // Validate payload against DTO
            const dto = payload;
            // Prevent changing status from running to finished
            if (existingSchedule.status === 'running' && dto.status === 'finished') {
                throw new Error('Cannot change schedule status from running to finished directly');
            }
            // Prevent changing status from running to finished
            if (existingSchedule.status === 'running' && dto.status === 'finished') {
                throw new Error('Cannot change schedule status from running to finished directly');
            }
            try {
                // Validate payload against DTO
                // const dto = await validateDto(TabiotScheduleDto, payload);
                const dto = payload;
                // Map DTO to entity
                const updateData = {
                    label: dto.name,
                    action: dto.action ? JSON.stringify(dto.action) : undefined,
                    enable: dto.enable ? 1 : 0,
                    device_id: dto.device_id,
                    start_date: dto.start_date,
                    end_date: dto.end_date,
                    type: dto.type || '',
                    interval: dto.interval,
                    start_time: dto.start_time,
                    end_time: dto.end_time,
                    status: dto.status,
                    schedule_plan_id: dto.schedule_plan_id,
                    is_from_local: 1,
                    is_synced: 0,
                    is_deleted: 0,
                    deleted: null,
                    modified: (0, helper_1.adjustToUTC7)(new Date()),
                };
                logger_1.logger.info(this.node, `Updating schedule: { name, updateData }`);
                const result = yield this.scheduleRepo.update({ name }, updateData);
                logger_1.logger.info(this.node, `Update result: affected=${result.affected}`);
                if (result.affected === 0) {
                    throw new Error(`Schedule with name ${name} not found`);
                }
                const updated = yield this.scheduleRepo.findOneBy({ name });
                if (!updated) {
                    throw new Error(`Failed to retrieve updated schedule`);
                }
                // Sync to server
                try {
                    logger_1.logger.info(this.node, 'Starting schedule sync to server');
                    const syncRes = yield this.syncScheduleService.syncScheduleFromLocalToServer([updated]);
                    logger_1.logger.info(this.node, 'Schedule sync completed successfully');
                    // If sync is successful, update is_synced to 1
                    yield this.scheduleRepo.update({ name: updated.name }, { is_synced: 1, modified: (0, helper_1.adjustToUTC7)(new Date()) });
                    // Refresh updated with the latest is_synced value
                    const refreshedUpdated = yield this.scheduleRepo.findOneBy({ name: updated.name });
                    if (refreshedUpdated) {
                        Object.assign(updated, refreshedUpdated);
                    }
                }
                catch (syncError) {
                    logger_1.logger.info(this.node, `Sync to server failed: ${syncError.message}`);
                    // If sync fails (HTTP error or timeout), keep is_synced as 0, no update needed
                }
                const responseDto = (0, class_transformer_1.plainToInstance)(schedule_dto_1.TabiotScheduleDto, Object.assign(Object.assign({}, updated), { name: updated.label, action: JSON.parse(updated.action || '{}'), enable: updated.enable === 1 }), { excludeExtraneousValues: true });
                msg.payload = { result: { data: responseDto } };
                if ('statusCode' in msg)
                    msg.statusCode = 200;
                return msg;
            }
            catch (error) {
                logger_1.logger.error(this.node, `PUT request failed: ${error.message}`);
                throw error; // Let handleRequest catch and handle it
            }
        });
    }
    handleGetRunningSchedules(query, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Parse pagination parameters
                const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
                const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10000;
                const skip = (page - 1) * size;
                // Parse filters if provided
                let whereOptions = {
                    is_deleted: 0,
                    enable: 1,
                    status: 'running'
                };
                if (query === null || query === void 0 ? void 0 : query.filters) {
                    try {
                        const filters = JSON.parse(query.filters);
                        for (const filter of filters) {
                            if (filter[0] === 'iot_schedule') {
                                const field = filter[1];
                                const operator = filter[2];
                                const value = filter[3];
                                if (operator === 'like') {
                                    whereOptions[field] = (0, typeorm_1.ILike)(`%${value}%`);
                                }
                                else if (operator === '=') {
                                    whereOptions[field] = value;
                                }
                                // Add more operators as needed
                            }
                        }
                    }
                    catch (filterError) {
                        logger_1.logger.error(this.node, `Error parsing filters: ${filterError.message}`);
                    }
                }
                // Get device list for current user
                // In a real implementation, this would need to be adapted to use your actual device management system
                // For this implementation, I'll retrieve all devices from schedules instead
                // First, get distinct device_ids from the schedule table
                const deviceQuery = yield this.scheduleRepo.createQueryBuilder('schedule')
                    .select('DISTINCT schedule.device_id', 'device_id')
                    .where('schedule.is_deleted = 0')
                    .getRawMany();
                const deviceIds = deviceQuery.map(item => item.device_id).filter(Boolean);
                // Apply device filter
                if (deviceIds.length > 0) {
                    whereOptions.device_id = deviceIds;
                }
                // Query for schedules
                const [schedules, totalCount] = yield this.scheduleRepo.findAndCount({
                    where: whereOptions,
                    relations: ['schedulePlan'],
                    order: { creation: 'DESC' },
                    skip,
                    take: size
                });
                // Process schedules to include required data
                const enrichedData = schedules.map(schedule => {
                    var _a, _b, _c, _d;
                    // Format date to string using moment to avoid Date.split() error
                    const modifiedDate = schedule.modified ?
                        (0, moment_timezone_1.default)(schedule.modified).format('YYYY-MM-DD') :
                        (0, moment_timezone_1.default)().format('YYYY-MM-DD');
                    const startTime = schedule.start_time ?
                        moment_timezone_1.default.tz(`${modifiedDate} ${schedule.start_time}`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Ho_Chi_Minh')
                            .utc().valueOf() : null;
                    const endTime = schedule.end_time ?
                        moment_timezone_1.default.tz(`${modifiedDate} ${schedule.end_time}`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Ho_Chi_Minh')
                            .utc().valueOf() : null;
                    return {
                        id: schedule.name,
                        device_id: schedule.device_id,
                        device_name: schedule.device_label || schedule.device_id,
                        action: JSON.parse(schedule.action || '{}'),
                        enable: schedule.enable === 1,
                        name: schedule.label,
                        interval: schedule.interval,
                        set_time: schedule.set_time,
                        start_time: schedule.start_time,
                        end_time: schedule.end_time,
                        start_date: schedule.start_date ?
                            (0, moment_timezone_1.default)(schedule.start_date).format('YYYY-MM-DD') : undefined,
                        end_date: schedule.end_date ?
                            (0, moment_timezone_1.default)(schedule.end_date).format('YYYY-MM-DD') : undefined,
                        type: schedule.type,
                        schedule_plan_id: (_a = schedule.schedulePlan) === null || _a === void 0 ? void 0 : _a.name,
                        sp_start_date: ((_b = schedule.schedulePlan) === null || _b === void 0 ? void 0 : _b.start_date) ?
                            (0, moment_timezone_1.default)(schedule.schedulePlan.start_date).format('YYYY-MM-DD') : undefined,
                        sp_end_date: ((_c = schedule.schedulePlan) === null || _c === void 0 ? void 0 : _c.end_date) ?
                            (0, moment_timezone_1.default)(schedule.schedulePlan.end_date).format('YYYY-MM-DD') : undefined,
                        sp_label: (_d = schedule.schedulePlan) === null || _d === void 0 ? void 0 : _d.label,
                        creation: schedule.creation,
                        modified: schedule.modified,
                        errors: [], // Not implementing notifications as requested
                        warnings: [] // Not implementing notifications as requested
                    };
                });
                // Prepare pagination info
                const pagination = {
                    totalElements: totalCount,
                    totalPages: Math.ceil(totalCount / size),
                    pageSize: size,
                    pageNumber: page,
                    order_by: (query === null || query === void 0 ? void 0 : query.order_by) || null
                };
                // Prepare response
                msg.payload = {
                    data: enrichedData,
                    pagination: pagination
                };
                if ('statusCode' in msg)
                    msg.statusCode = 200;
                return msg;
            }
            catch (error) {
                logger_1.logger.error(this.node, `Error fetching running schedules: ${error.message}`);
                msg.payload = { error: error.message };
                if ('statusCode' in msg)
                    msg.statusCode = 500;
                return msg;
            }
        });
    }
    handleDelete(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!path.startsWith(`${constants_1.API_PATHS.SCHEDULE}`)) {
                throw new Error('Invalid DELETE endpoint');
            }
            // Extract name from either path or query parameter
            let name;
            const pathParts = path.split('/').filter(Boolean); // Split and remove empty parts
            const lastPathPart = pathParts[pathParts.length - 1];
            // Check if the last part of the path is a valid name (not just "schedule")
            if (lastPathPart && lastPathPart !== 'schedule') {
                name = lastPathPart;
            }
            else {
                // Fallback to query parameter
                const query = ((_a = msg.req) === null || _a === void 0 ? void 0 : _a.query) || {};
                name = query.name;
            }
            if (!name) {
                throw new Error('No schedule name provided in path or query');
            }
            try {
                logger_1.logger.info(this.node, `Marking schedule as deleted: ${name}`);
                const result = yield this.scheduleRepo.update({ name }, {
                    is_deleted: 1,
                    is_from_local: 1,
                    is_synced: 0,
                    modified: (0, helper_1.adjustToUTC7)(new Date()),
                });
                logger_1.logger.info(this.node, `Delete result: affected=${result.affected}`);
                if (result.affected === 0) {
                    throw new Error(`Schedule with name ${name} not found`);
                }
                // Retrieve the updated schedule for syncing
                const updatedSchedule = yield this.scheduleRepo.findOneBy({ name });
                if (!updatedSchedule) {
                    throw new Error(`Failed to retrieve updated schedule for syncing`);
                }
                // Sync to server
                try {
                    logger_1.logger.info(this.node, 'Starting schedule sync to server');
                    const syncRes = yield this.syncScheduleService.syncScheduleFromLocalToServer([updatedSchedule]);
                    logger_1.logger.info(this.node, 'Schedule sync completed successfully');
                    // If sync is successful, update is_synced to 1
                    yield this.scheduleRepo.update({ name: updatedSchedule.name }, { is_synced: 1, modified: (0, helper_1.adjustToUTC7)(new Date()) });
                }
                catch (syncError) {
                    logger_1.logger.info(this.node, `Sync to server failed: ${syncError.message}`);
                    // If sync fails (HTTP error or timeout), keep is_synced as 0, no update needed
                }
                msg.payload = { result: { message: 'Schedule marked as deleted' } };
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
exports.ScheduleHandler = ScheduleHandler;

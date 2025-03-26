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
exports.ScheduleHandler = void 0;
const urlParser_1 = require("../utils/urlParser");
const logger_1 = require("../utils/logger");
const constants_1 = require("../constants");
const scheduleValidator_1 = require("../utils/scheduleValidator");
const helper_1 = require("../../../ultils/helper");
// ... (previous imports remain the same)
class ScheduleHandler {
    constructor(dbService, node) {
        this.dbService = dbService;
        this.scheduleRepo = dbService.getScheduleRepository();
        this.node = node;
    }
    // Utility function to adjust UTC time by +7 hours
    adjustToUTC7(date) {
        const utcDate = new Date(date);
        utcDate.setHours(utcDate.getHours() + 7);
        return utcDate;
    }
    handleRequest(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { method, url, query, payload } = msg.req || {};
                const path = (0, urlParser_1.parseUrl)(url || '');
                logger_1.logger.info(this.node, `Handling schedule request: ${method} ${path}`);
                if (!this.dbService.isInitialized()) {
                    logger_1.logger.info(this.node, 'Database not initialized, initializing now...');
                    yield this.dbService.initialize();
                    logger_1.logger.info(this.node, 'Database initialized successfully');
                }
                switch (method) {
                    case 'GET': return yield this.handleGet(path, query, msg);
                    case 'POST': return yield this.handlePost(path, msg);
                    case 'PUT': return yield this.handlePut(path, msg);
                    case 'DELETE': return yield this.handleDelete(path, msg);
                    default: throw new Error(`Unsupported HTTP method: ${method}`);
                }
            }
            catch (error) {
                logger_1.logger.error(this.node, `Request handling failed: ${error.message}`);
                msg.payload = { error: error.message };
                // Only set statusCode if it exists in the type
                if ('statusCode' in msg)
                    msg.statusCode = 500;
                return msg;
            }
        });
    }
    handleGet(path, query, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path !== constants_1.API_PATHS.SCHEDULE) {
                throw new Error('Invalid GET endpoint');
            }
            const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
            const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10;
            const orderBy = (query === null || query === void 0 ? void 0 : query.order_by) || 'name ASC';
            const [field, direction] = orderBy.split(' ');
            try {
                const [schedules, total] = yield this.scheduleRepo.findAndCount({
                    where: { is_deleted: 0 },
                    take: size,
                    skip: (page - 1) * size,
                    order: { [field]: direction.toUpperCase() },
                    relations: ['schedulePlan'],
                });
                const pagination = {
                    totalElements: total,
                    totalPages: Math.ceil(total / size),
                    pageSize: size,
                    pageNumber: page,
                    order_by: orderBy,
                };
                msg.payload = { result: { data: (0, scheduleValidator_1.convertObjectArray)(schedules), pagination } };
                return msg;
            }
            catch (error) {
                throw new Error(`GET request failed: ${error.message}`);
            }
        });
    }
    handlePost(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path !== constants_1.API_PATHS.SCHEDULE) {
                throw new Error('Invalid POST endpoint');
            }
            const payload = msg.payload;
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid payload: Payload must be an object');
            }
            try {
                const enable = typeof payload.enable === 'string'
                    ? payload.enable === 'true' ? 1 : 0
                    : payload.enable ? 1 : 0;
                const actionString = JSON.stringify(payload.action || {});
                const name = (0, helper_1.generateHashKey)(payload.device_id || '', actionString, enable, payload.name || '', payload.time || '', payload.start_date || '', payload.end_date || '', payload.type || '', payload.interval || '', payload.start_time || '', payload.end_time || '', 0, payload.schedule_plan_id || '');
                const scheduleData = {
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
                    creation: this.adjustToUTC7(new Date()), // Override TypeORM default
                    modified: this.adjustToUTC7(new Date()), // Override TypeORM default
                };
                const schedule = this.scheduleRepo.create(scheduleData);
                const savedSchedule = yield this.scheduleRepo.save(schedule);
                const responseData = Object.assign(Object.assign({}, savedSchedule), { id: savedSchedule.name, name: savedSchedule.label, action: JSON.parse(savedSchedule.action || '{}') });
                delete responseData.label;
                msg.payload = { result: { data: responseData } };
                if ('statusCode' in msg)
                    msg.statusCode = 201; // Conditional statusCode
                return msg;
            }
            catch (error) {
                logger_1.logger.error(this.node, `POST failed: ${error.message}`);
                throw new Error(`Failed to create schedule: ${error.message}`);
            }
        });
    }
    handlePut(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!path.startsWith(`${constants_1.API_PATHS.SCHEDULE}/`)) {
                throw new Error('Invalid PUT endpoint');
            }
            const name = path.split('/').pop();
            const payload = msg.payload;
            try {
                const updateData = {
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
                const result = yield this.scheduleRepo.update({ name }, updateData);
                if (result.affected === 0) {
                    throw new Error(`Schedule with name ${name} not found`);
                }
                const updated = yield this.scheduleRepo.findOneBy({ name });
                if (!updated) {
                    throw new Error(`Failed to retrieve updated schedule`);
                }
                const responseData = Object.assign(Object.assign({}, updated), { id: updated.name, name: updated.label, action: JSON.parse(updated.action || '{}') });
                delete responseData.label;
                msg.payload = { result: { data: responseData } };
                if ('statusCode' in msg)
                    msg.statusCode = 200; // Conditional statusCode
                return msg;
            }
            catch (error) {
                throw new Error(`PUT request failed: ${error.message}`);
            }
        });
    }
    handleDelete(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!path.startsWith(`${constants_1.API_PATHS.SCHEDULE}`)) {
                throw new Error('Invalid DELETE endpoint');
            }
            const name = path.split('/').pop();
            try {
                const result = yield this.scheduleRepo.update({ name }, {
                    is_deleted: 1,
                    modified: this.adjustToUTC7(new Date()), // Override TypeORM default
                });
                if (result.affected === 0) {
                    throw new Error(`Schedule with name ${name} not found`);
                }
                msg.payload = { result: { message: 'Schedule marked as deleted' } };
                if ('statusCode' in msg)
                    msg.statusCode = 200; // Conditional statusCode
                return msg;
            }
            catch (error) {
                throw new Error(`DELETE request failed: ${error.message}`);
            }
        });
    }
}
exports.ScheduleHandler = ScheduleHandler;

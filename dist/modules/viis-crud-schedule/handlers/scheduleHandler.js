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
class ScheduleHandler {
    constructor(dbService, node) {
        this.dbService = dbService; // Lưu dbService để kiểm tra trạng thái
        this.scheduleRepo = dbService.getScheduleRepository();
        this.node = node;
    }
    handleRequest(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            const { method, url, query, payload } = msg.req || {};
            const path = (0, urlParser_1.parseUrl)(url || '');
            logger_1.logger.info(this.node, `Handling schedule request: ${method} ${path}`);
            // Kiểm tra và khởi tạo database nếu cần
            if (!this.dbService.isInitialized()) {
                logger_1.logger.info(this.node, 'Database not initialized, initializing now...');
                try {
                    yield this.dbService.initialize();
                    logger_1.logger.info(this.node, 'Database initialized successfully');
                }
                catch (error) {
                    logger_1.logger.error(this.node, `Failed to initialize database: ${error.message}`);
                    throw new Error('Database initialization failed');
                }
            }
            switch (method) {
                case 'GET':
                    return yield this.handleGet(path, query, msg);
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
    handleGet(path, query, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path === constants_1.API_PATHS.SCHEDULE) {
                const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
                const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10;
                const orderBy = (query === null || query === void 0 ? void 0 : query.order_by) || 'name ASC';
                const [field, direction] = orderBy.split(' ');
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
                msg.payload = { result: { data: schedules, pagination } };
                msg.payload = { result: (0, scheduleValidator_1.convertObjectArray)(schedules) };
                return msg;
            }
            throw new Error('Invalid GET endpoint');
        });
    }
    handlePost(path, payload, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path === constants_1.API_PATHS.SCHEDULE) {
                const schedule = this.scheduleRepo.create(payload);
                const result = yield this.scheduleRepo.save(schedule);
                msg.payload = { result: { data: result } };
                return msg;
            }
            throw new Error('Invalid POST endpoint');
        });
    }
    handlePut(path, payload, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path.startsWith(`${constants_1.API_PATHS.SCHEDULE}/`)) {
                const name = path.split('/').pop();
                yield this.scheduleRepo.update({ name }, payload);
                const updated = yield this.scheduleRepo.findOneBy({ name });
                msg.payload = { result: { data: updated || null } };
                return msg;
            }
            throw new Error('Invalid PUT endpoint');
        });
    }
    handleDelete(path, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (path.startsWith(`${constants_1.API_PATHS.SCHEDULE}/`)) {
                const name = path.split('/').pop();
                yield this.scheduleRepo.update({ name }, { is_deleted: 1 });
                msg.payload = { result: { message: 'Schedule marked as deleted' } };
                return msg;
            }
            throw new Error('Invalid DELETE endpoint');
        });
    }
}
exports.ScheduleHandler = ScheduleHandler;

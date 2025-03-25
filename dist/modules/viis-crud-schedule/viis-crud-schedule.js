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
const TabiotSchedule_1 = require("../../orm/entities/schedule/TabiotSchedule");
const TabiotSchedulePlan_1 = require("../../orm/entities/schedulePlan/TabiotSchedulePlan");
const dataSource_1 = require("../../orm/dataSource");
module.exports = function (RED) {
    function ViisCrudScheduleNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNode = RED.nodes.getNode(config.config);
        let scheduleRepo;
        let planRepo;
        // Function to extract path without query parameters
        function getPathWithoutQuery(url) {
            const path = url.split('?')[0];
            node.warn(`Original URL: ${url} -> Extracted path: ${path}`);
            return path;
        }
        // Initialize DataSource only if not already initialized
        const initializeDataSource = () => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!dataSource_1.AppDataSource.isInitialized) {
                    node.warn('DataSource not initialized. Initializing...');
                    yield dataSource_1.AppDataSource.initialize();
                    node.warn('DataSource initialization successful');
                }
                scheduleRepo = dataSource_1.AppDataSource.getRepository(TabiotSchedule_1.TabiotSchedule);
                planRepo = dataSource_1.AppDataSource.getRepository(TabiotSchedulePlan_1.TabiotSchedulePlan);
                node.status({ fill: "green", shape: "dot", text: "connected" });
            }
            catch (error) {
                node.error('Failed to initialize database: ' + error);
                node.status({ fill: "red", shape: "ring", text: "disconnected" });
            }
        });
        initializeDataSource();
        // Schedule CRUD handlers
        function handleScheduleCRUD(msg) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!scheduleRepo) {
                    throw new Error('Database not initialized');
                }
                const { method, url, query, payload } = msg.req || {};
                const path = getPathWithoutQuery(url || '');
                node.warn(`Schedule CRUD: ${method} ${path}`);
                try {
                    switch (method) {
                        case 'GET':
                            if (path === '/api/v2/schedule') {
                                node.warn(`Processing GET request for schedules with query: ${JSON.stringify(query)}`);
                                const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
                                const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10;
                                const orderBy = (query === null || query === void 0 ? void 0 : query.order_by) || 'name ASC';
                                const [field, direction] = orderBy.split(' ');
                                const [schedules, total] = yield scheduleRepo.findAndCount({
                                    take: size,
                                    skip: (page - 1) * size,
                                    order: { [field]: direction.toUpperCase() },
                                    relations: ['schedulePlan']
                                });
                                node.warn(`Found ${total} schedules, returning page ${page} with ${schedules.length} items`);
                                msg.payload = {
                                    result: {
                                        data: schedules,
                                        pagination: {
                                            totalElements: total,
                                            totalPages: Math.ceil(total / size),
                                            pageSize: size,
                                            pageNumber: page,
                                            order_by: orderBy
                                        }
                                    }
                                };
                            }
                            break;
                        case 'POST':
                            if (path === '/api/v2/schedule') {
                                node.warn(`Creating new schedule: ${JSON.stringify(payload)}`);
                                const schedule = scheduleRepo.create(payload);
                                const result = yield scheduleRepo.save(schedule);
                                node.warn(`Schedule created with ID: ${result[0].name}`);
                                msg.payload = { result: { data: result } };
                            }
                            break;
                        case 'PUT':
                            if (path.startsWith('/api/v2/schedule/')) {
                                const name = path.split('/').pop();
                                node.warn(`Updating schedule with ID: ${name}`);
                                yield scheduleRepo.update({ name: name }, payload);
                                const updated = yield scheduleRepo.findOneBy({ name: name });
                                node.warn(`Schedule updated: ${updated ? 'Success' : 'Not found'}`);
                                msg.payload = { result: { data: updated } };
                            }
                            break;
                        case 'DELETE':
                            if (path.startsWith('/api/v2/schedule/')) {
                                const name = path.split('/').pop();
                                node.warn(`Marking schedule as deleted, ID: ${name}`);
                                yield scheduleRepo.update({ name: name }, { is_deleted: 1 });
                                msg.payload = { result: { message: 'Schedule marked as deleted' } };
                            }
                            break;
                    }
                }
                catch (error) {
                    node.error(`Schedule CRUD error: ${error.message}`);
                    msg.payload = { error: error.message };
                    node.error(error);
                }
                return msg;
            });
        }
        // Schedule Plan CRUD handlers
        function handleSchedulePlanCRUD(msg) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!planRepo) {
                    throw new Error('Database not initialized');
                }
                const { method, url, query, payload } = msg.req || {};
                const path = getPathWithoutQuery(url || '');
                node.warn(`Schedule Plan CRUD: ${method} ${path}`);
                node.warn("fuck y0u");
                try {
                    switch (method) {
                        case 'GET':
                            node.warn("fuck");
                            node.warn(path);
                            node.warn('/api/v2/schedulePlan');
                            node.warn(path === '/api/v2/schedulePlan');
                            if (path === '/api/v2/schedulePlan') {
                                node.warn(`Processing GET request for schedule plans with query: ${JSON.stringify(query)}`);
                                const page = parseInt(query === null || query === void 0 ? void 0 : query.page) || 1;
                                const size = parseInt(query === null || query === void 0 ? void 0 : query.size) || 10;
                                const orderBy = (query === null || query === void 0 ? void 0 : query.order_by) || 'tabiot_schedule_plan.label ASC';
                                const [field, direction] = orderBy.split(' ').slice(-2);
                                node.warn(`Query parameters: page=${page}, size=${size}, orderBy=${orderBy}`);
                                node.warn(`Parsed order: field=${field}, direction=${direction}`);
                                const [plans, total] = yield planRepo.findAndCount({
                                    take: size,
                                    skip: (page - 1) * size,
                                    order: { [field.split('.').pop()]: direction.toUpperCase() },
                                    relations: ['schedules']
                                });
                                node.warn(`Found ${total} schedule plans, returning page ${page} with ${plans.length} items`);
                                msg.payload = {
                                    result: {
                                        data: plans,
                                        pagination: {
                                            totalElements: total,
                                            totalPages: Math.ceil(total / size),
                                            pageSize: size,
                                            pageNumber: page,
                                            order_by: orderBy
                                        }
                                    }
                                };
                            }
                            break;
                        case 'POST':
                            if (path === '/api/v2/schedulePlan') {
                                node.warn(`Creating new schedule plan: ${JSON.stringify(payload)}`);
                                const plan = planRepo.create(payload);
                                const result = yield planRepo.save(plan);
                                node.warn(`Schedule plan created with ID: ${result[0].name}`);
                                msg.payload = { result: { data: result } };
                            }
                            break;
                        case 'PUT':
                            if (path.startsWith('/api/v2/schedulePlan/')) {
                                const name = path.split('/').pop();
                                node.warn(`Updating schedule plan with ID: ${name}`);
                                yield planRepo.update({ name: name }, payload);
                                const updated = yield planRepo.findOneBy({ name: name });
                                node.warn(`Schedule plan updated: ${updated ? 'Success' : 'Not found'}`);
                                msg.payload = { result: { data: updated } };
                            }
                            break;
                        case 'DELETE':
                            if (path.startsWith('/api/v2/schedulePlan/')) {
                                const name = path.split('/').pop();
                                node.warn(`Marking schedule plan as deleted, ID: ${name}`);
                                yield planRepo.update({ name: name }, { is_deleted: 1 });
                                msg.payload = { result: { message: 'Schedule plan marked as deleted' } };
                            }
                            break;
                        default:
                            node.warn('nothing find');
                            node.warn(method);
                            node.warn(path);
                            break;
                    }
                }
                catch (error) {
                    node.error(`Schedule Plan CRUD error: ${error.message}`);
                    msg.payload = { error: error.message };
                    node.error(error);
                }
                return msg;
            });
        }
        node.on('input', function (msg) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                node.warn(`Received input message with URL: ${(_a = msg.req) === null || _a === void 0 ? void 0 : _a.url}`);
                if (!dataSource_1.AppDataSource.isInitialized) {
                    node.warn('Database not initialized, sending error response');
                    msg.payload = { error: 'Database not initialized' };
                    node.send(msg);
                    return;
                }
                const url = ((_b = msg.req) === null || _b === void 0 ? void 0 : _b.url) || '';
                const path = getPathWithoutQuery(url);
                node.warn(`Routing request for path: ${path}`);
                if (path.startsWith('/api/v2/schedulePlan')) {
                    node.warn('Routing to schedule plan CRUD handler');
                    msg = yield handleSchedulePlanCRUD(msg);
                }
                else if (path.startsWith('/api/v2/schedule')) {
                    node.warn('Routing to schedule plan CRUD handler');
                    msg = yield handleScheduleCRUD(msg);
                }
                else {
                    node.warn(`Invalid endpoint: ${path}`);
                    msg.payload = { error: 'Invalid endpoint' };
                }
                node.warn('Sending response');
                node.send(msg);
            });
        });
        // Only destroy if this node initialized the connection
        let shouldDestroy = false;
        dataSource_1.AppDataSource.initialize().then(() => {
            shouldDestroy = true;
            node.warn('DataSource initialized by this node, will destroy on close');
        });
        node.on('close', function () {
            return __awaiter(this, void 0, void 0, function* () {
                node.warn('Node closing, checking if should destroy DataSource');
                if (shouldDestroy && dataSource_1.AppDataSource.isInitialized) {
                    node.warn('Destroying DataSource');
                    yield dataSource_1.AppDataSource.destroy();
                }
            });
        });
    }
    RED.nodes.registerType('viis-crud-schedule', ViisCrudScheduleNode);
};

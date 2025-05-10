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
const databaseService_1 = require("./services/databaseService");
const scheduleHandler_1 = require("./handlers/scheduleHandler");
const schedulePlanHandler_1 = require("./handlers/schedulePlanHandler");
const urlParser_1 = require("./utils/urlParser");
const logger_1 = require("./utils/logger");
const constants_1 = require("./constants");
module.exports = function (RED) {
    // Wrapper để xử lý async trong constructor
    function ViisCrudScheduleNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.warn("start to 1");
        const dbService = new databaseService_1.DatabaseService();
        node.warn("start to 2");
        // Khởi tạo database đồng bộ
        (() => __awaiter(this, void 0, void 0, function* () {
            try {
                node.warn("start to init DB");
                yield dbService.initialize();
                node.warn("Database initialized successfully");
                const scheduleHandler = new scheduleHandler_1.ScheduleHandler(dbService, node);
                const schedulePlanHandler = new schedulePlanHandler_1.SchedulePlanHandler(dbService, node);
                node.on('input', (msg) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b;
                    try {
                        const url = ((_a = msg.req) === null || _a === void 0 ? void 0 : _a.url) || '';
                        const method = ((_b = msg.req) === null || _b === void 0 ? void 0 : _b.method) || 'GET';
                        const path = (0, urlParser_1.parseUrl)(url);
                        node.warn("Processing input");
                        logger_1.logger.info(node, `Received request: ${method} ${path}`);
                        let responseMsg;
                        if (path.startsWith(constants_1.API_PATHS.SCHEDULE_PLAN)) {
                            responseMsg = yield schedulePlanHandler.handleRequest(msg);
                        }
                        else if (path.startsWith(constants_1.API_PATHS.SCHEDULE)) {
                            responseMsg = yield scheduleHandler.handleRequest(msg);
                        }
                        else {
                            throw new Error('Invalid endpoint');
                        }
                        node.send(responseMsg);
                    }
                    catch (error) {
                        logger_1.logger.error(node, `Request failed: ${error.message}`);
                        msg.payload = { error: error.message };
                        node.send(msg);
                    }
                }));
                node.on('close', () => __awaiter(this, void 0, void 0, function* () {
                    logger_1.logger.info(node, 'Node closing');
                    yield dbService.destroy();
                }));
            }
            catch (err) {
                logger_1.logger.error(node, `Failed to initialize node: ${err.message}`);
                node.error(`Node initialization failed: ${err.message}`);
                // Đánh dấu node lỗi để không nhận input
                node.status({ fill: 'red', shape: 'ring', text: 'Database initialization failed' });
            }
        }))();
    }
    RED.nodes.registerType('viis-crud-schedule', ViisCrudScheduleNode);
};

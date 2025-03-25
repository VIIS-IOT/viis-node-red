import { Node, NodeAPI, NodeDef } from 'node-red';
import { DatabaseService } from './services/databaseService';
import { ScheduleHandler } from './handlers/scheduleHandler';
import { SchedulePlanHandler } from './handlers/schedulePlanHandler';
import { ExtendedNodeMessage } from './interfaces/types';
import { parseUrl } from './utils/urlParser';
import { logger } from './utils/logger';
import { API_PATHS } from './constants';

interface ViisCrudScheduleNodeDef extends NodeDef {
    config: string;
}

export = function (RED: NodeAPI) {
    // Wrapper để xử lý async trong constructor
    function ViisCrudScheduleNode(this: Node, config: ViisCrudScheduleNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.warn("start to 1");
        const dbService = new DatabaseService();
        node.warn("start to 2");

        // Khởi tạo database đồng bộ
        (async () => {
            try {
                node.warn("start to init DB");
                await dbService.initialize();
                node.warn("Database initialized successfully");

                const scheduleHandler = new ScheduleHandler(dbService, node);
                const schedulePlanHandler = new SchedulePlanHandler(dbService, node);

                node.on('input', async (msg: ExtendedNodeMessage) => {
                    try {
                        const url = msg.req?.url || '';
                        const method = msg.req?.method || 'GET';
                        const path = parseUrl(url);
                        node.warn("Processing input");
                        logger.info(node, `Received request: ${method} ${path}`);

                        let responseMsg: ExtendedNodeMessage;
                        if (path.startsWith(API_PATHS.SCHEDULE_PLAN)) {
                            responseMsg = await schedulePlanHandler.handleRequest(msg);
                        } else if (path.startsWith(API_PATHS.SCHEDULE)) {
                            responseMsg = await scheduleHandler.handleRequest(msg);
                        } else {
                            throw new Error('Invalid endpoint');
                        }

                        node.send(responseMsg);
                    } catch (error: any) {
                        logger.error(node, `Request failed: ${error.message}`);
                        msg.payload = { error: error.message };
                        node.send(msg);
                    }
                });

                node.on('close', async () => {
                    logger.info(node, 'Node closing');
                    await dbService.destroy();
                });
            } catch (err) {
                logger.error(node, `Failed to initialize node: ${(err as Error).message}`);
                node.error(`Node initialization failed: ${(err as Error).message}`);
                // Đánh dấu node lỗi để không nhận input
                node.status({ fill: 'red', shape: 'ring', text: 'Database initialization failed' });
            }
        })();
    }

    RED.nodes.registerType('viis-crud-schedule', ViisCrudScheduleNode);
};
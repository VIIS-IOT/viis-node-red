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

        const dbService = new DatabaseService();
        let isInitialized = false;

        // Register close handler OUTSIDE async IIFE to ensure it's always registered
        node.on('close', async (done: () => void) => {
            try {
                logger.info(node, 'Node closing');
                if (isInitialized) {
                    await dbService.destroy();
                }
            } catch (error) {
                logger.error(node, `Error during cleanup: ${(error as Error).message}`);
            }
            if (typeof done === 'function') {
                done();
            }
        });

        // Khởi tạo database đồng bộ
        (async () => {
            try {
                await dbService.initialize();
                isInitialized = true;
                logger.info(node, "Database initialized successfully");

                const scheduleHandler = new ScheduleHandler(dbService, node);
                const schedulePlanHandler = new SchedulePlanHandler(dbService, node);

                node.on('input', async (msg: ExtendedNodeMessage) => {
                    try {
                        const url = msg.req?.url || '';
                        const method = msg.req?.method || 'GET';
                        const path = parseUrl(url);
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
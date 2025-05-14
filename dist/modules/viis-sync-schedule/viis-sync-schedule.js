"use strict";
/**
 * @fileoverview Sync Schedule Node for VIIS IoT system
 * This node synchronizes schedules and schedule plans between the local database and server
 * It fetches data from the server, compares with local records, and updates as needed
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const logger_1 = require("./utils/logger");
const databaseService_1 = require("./services/databaseService");
const scheduleSyncHandler_1 = require("./handlers/scheduleSyncHandler");
const constants_1 = require("./constants");
module.exports = function (RED) {
    /**
     * Constructor for the VIIS sync schedule node
     * @param {ViisSyncScheduleNodeDef} config - Configuration settings for this node
     */
    function ViisSyncScheduleNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Apply defaults for missing configuration
        config.syncInterval = config.syncInterval || constants_1.SYNC_DEFAULTS.INTERVAL;
        config.maxRetries = config.maxRetries || 3;
        config.showDetailedLogs = !!config.showDetailedLogs;
        config.syncOnStartup = config.syncOnStartup !== false; // Default to true if not specified
        logger_1.logger.info(node, 'Initializing VIIS Sync Schedule Node');
        const dbService = new databaseService_1.DatabaseService();
        let syncIntervalId = null;
        let scheduleSyncHandler = null;
        // Initialize database and start sync process
        (() => __awaiter(this, void 0, void 0, function* () {
            try {
                logger_1.logger.info(node, 'Initializing database connection');
                yield dbService.initialize();
                logger_1.logger.info(node, 'Database initialized successfully');
                // Initialize the sync handler
                scheduleSyncHandler = new scheduleSyncHandler_1.ScheduleSyncHandler(dbService, node, config.accessToken);
                // Update node status with initial state
                updateNodeStatus('ready');
                // Set up sync interval if configured
                if (config.syncInterval > 0) {
                    setupSyncInterval();
                }
                // Perform initial sync if configured
                if (config.syncOnStartup) {
                    yield performSync('initial');
                }
                // Handle manual sync requests via node input
                node.on('input', (msg) => __awaiter(this, void 0, void 0, function* () {
                    // Skip if sync is already in progress
                    if (scheduleSyncHandler && scheduleSyncHandler.isSyncInProgress()) {
                        logger_1.logger.warn(node, 'Sync already in progress, ignoring new request');
                        msg.payload = { status: 'warning', message: 'Sync already in progress' };
                        node.send(msg);
                        return;
                    }
                    try {
                        const result = yield performSync('manual');
                        // Send result as message payload
                        msg.payload = {
                            status: 'success',
                            message: 'Sync completed successfully',
                            result
                        };
                        node.send(msg);
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        logger_1.logger.error(node, `Manual sync failed: ${errorMessage}`);
                        msg.payload = { status: 'error', message: errorMessage };
                        node.send(msg);
                        updateNodeStatus('error', errorMessage);
                    }
                }));
                // Clean up on node close
                node.on('close', (done) => __awaiter(this, void 0, void 0, function* () {
                    logger_1.logger.info(node, 'Node closing');
                    // Clear any scheduled syncs
                    if (syncIntervalId) {
                        clearInterval(syncIntervalId);
                        syncIntervalId = null;
                    }
                    try {
                        // Close database connection
                        yield dbService.destroy();
                        logger_1.logger.info(node, 'Database connection closed');
                        done();
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        logger_1.logger.error(node, `Error closing database: ${errorMessage}`);
                        done();
                    }
                }));
            }
            catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                logger_1.logger.error(node, `Failed to initialize node: ${errorMessage}`);
                node.error(`Node initialization failed: ${errorMessage}`);
                updateNodeStatus('error', 'Initialization failed');
            }
        }))();
        /**
         * Sets up the periodic sync interval
         */
        function setupSyncInterval() {
            if (syncIntervalId) {
                clearInterval(syncIntervalId);
            }
            const intervalMs = config.syncInterval * 60 * 1000; // Convert minutes to milliseconds
            logger_1.logger.info(node, `Setting up sync interval: ${config.syncInterval} minutes`);
            syncIntervalId = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                // Skip if sync is already in progress
                if (scheduleSyncHandler && scheduleSyncHandler.isSyncInProgress()) {
                    logger_1.logger.warn(node, 'Scheduled sync skipped - sync already in progress');
                    return;
                }
                try {
                    yield performSync('scheduled');
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    logger_1.logger.error(node, `Scheduled sync failed: ${errorMessage}`);
                    updateNodeStatus('error', 'Sync failed');
                }
            }), intervalMs);
        }
        /**
         * Performs a sync operation
         * @param type - Type of sync operation (initial, manual, scheduled)
         * @returns Promise resolving to sync result
         */
        function performSync(type) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!scheduleSyncHandler) {
                    throw new Error('Sync handler not initialized');
                }
                logger_1.logger.info(node, `Performing ${type} sync`);
                updateNodeStatus('syncing', `${type.charAt(0).toUpperCase() + type.slice(1)} sync...`);
                try {
                    const result = yield scheduleSyncHandler.syncAll();
                    // Update node status based on result
                    if (result.success) {
                        updateNodeStatus('success', `Sync complete (${result.totalPlans} plans, ${result.totalSchedules} schedules)`);
                        logger_1.logger.info(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync completed successfully`);
                    }
                    else {
                        updateNodeStatus('error', 'Sync failed');
                        logger_1.logger.error(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync failed: ${result.errorMessage || 'Unknown error'}`);
                    }
                    return result;
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    logger_1.logger.error(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync failed: ${errorMessage}`);
                    updateNodeStatus('error', 'Sync failed');
                    throw error;
                }
            });
        }
        /**
         * Updates the node's status in the flow editor
         * @param state - State of the node (ready, syncing, success, error)
         * @param message - Optional message to display
         */
        function updateNodeStatus(state, message) {
            let statusConfig;
            switch (state) {
                case 'ready':
                    statusConfig = {
                        fill: 'green',
                        shape: 'ring',
                        text: message || 'Ready'
                    };
                    break;
                case 'syncing':
                    statusConfig = {
                        fill: 'blue',
                        shape: 'dot',
                        text: message || 'Syncing...'
                    };
                    break;
                case 'success':
                    statusConfig = {
                        fill: 'green',
                        shape: 'dot',
                        text: message || 'Sync complete'
                    };
                    // Auto-revert to 'ready' status after 5 seconds
                    setTimeout(() => {
                        if (scheduleSyncHandler && !scheduleSyncHandler.isSyncInProgress()) {
                            const statusMessage = scheduleSyncHandler.getStatusMessage();
                            node.status({
                                fill: 'green',
                                shape: 'ring',
                                text: statusMessage || 'Ready'
                            });
                        }
                    }, 5000);
                    break;
                case 'error':
                    statusConfig = {
                        fill: 'red',
                        shape: 'ring',
                        text: message || 'Error'
                    };
                    break;
                default:
                    statusConfig = {
                        fill: 'grey',
                        shape: 'ring',
                        text: message || 'Unknown state'
                    };
            }
            node.status(statusConfig);
        }
    }
    RED.nodes.registerType('viis-sync-schedule', ViisSyncScheduleNode);
};

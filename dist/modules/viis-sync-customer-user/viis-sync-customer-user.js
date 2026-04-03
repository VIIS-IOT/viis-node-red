"use strict";
/**
 * @fileoverview Sync Customer User Node for VIIS IoT system
 * This node synchronizes customers and customer users between the local database and server
 * It fetches data from the server, compares with local records, and updates as needed
 */
const logger_1 = require("./utils/logger");
const databaseService_1 = require("./services/databaseService");
const customerUserSyncHandler_1 = require("./handlers/customerUserSyncHandler");
const constants_1 = require("./constants");
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    /**
     * Constructor for the VIIS sync customer user node
     * @param {ViisSyncCustomerUserNodeDef} config - Configuration settings for this node
     */
    function ViisSyncCustomerUserNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Apply defaults for missing configuration
        config.syncInterval = config.syncInterval || constants_1.SYNC_DEFAULTS.INTERVAL;
        config.maxRetries = config.maxRetries || 3;
        config.showDetailedLogs = !!config.showDetailedLogs;
        config.syncOnStartup = config.syncOnStartup !== false; // Default to true if not specified
        // Auto-load device ID from environment if not provided or if useEnvDeviceId is enabled
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        let deviceId;
        if (config.useEnvDeviceId) {
            // Force load from environment
            deviceId = globalHelper.getEnvVar('DEVICE_ID', '');
            if (!deviceId) {
                node.error('DEVICE_ID environment variable not found');
                node.status({ fill: 'red', shape: 'ring', text: 'Missing DEVICE_ID env' });
                return;
            }
            logger_1.logger.info(node, 'Using Device ID from DEVICE_ID environment variable');
        }
        else {
            // Use config or fallback to environment
            deviceId = config.deviceId || globalHelper.getEnvVar('DEVICE_ID', '');
            if (!deviceId) {
                node.error('Device ID not configured and DEVICE_ID not found in environment variables');
                node.status({ fill: 'red', shape: 'ring', text: 'Missing Device ID' });
                return;
            }
            if (!config.deviceId) {
                logger_1.logger.info(node, 'Device ID auto-loaded from DEVICE_ID environment variable');
            }
        }
        logger_1.logger.info(node, 'Initializing VIIS Sync Customer User Node');
        logger_1.logger.info(node, `Using Device ID: ${deviceId.substring(0, 8)}...`);
        const dbService = new databaseService_1.DatabaseService();
        let syncIntervalId = null;
        let customerUserSyncHandler = null;
        // Initialize database and start sync process
        (async () => {
            try {
                logger_1.logger.info(node, 'Initializing database connection');
                await dbService.initialize();
                logger_1.logger.info(node, 'Database initialized successfully');
                // Initialize the sync handler
                customerUserSyncHandler = new customerUserSyncHandler_1.CustomerUserSyncHandler(dbService, node, deviceId, config.showDetailedLogs, config.maxRetries);
                // Update node status with initial state
                updateNodeStatus('ready');
                // Set up sync interval if configured
                if (config.syncInterval > 0) {
                    setupSyncInterval();
                }
                // Perform initial sync if configured
                if (config.syncOnStartup) {
                    await performSync('initial');
                }
                // Handle manual sync requests via node input
                node.on('input', async function (msg) {
                    // Skip if sync is already in progress
                    if (customerUserSyncHandler && customerUserSyncHandler.isSyncInProgress()) {
                        logger_1.logger.warn(node, 'Sync already in progress, ignoring new request');
                        msg.payload = { status: 'warning', message: 'Sync already in progress' };
                        node.send(msg);
                        return;
                    }
                    try {
                        const result = await performSync('manual');
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
                });
                // Clean up on node close
                node.on('close', async (done) => {
                    logger_1.logger.info(node, 'Node closing');
                    // Clear any scheduled syncs
                    if (syncIntervalId) {
                        clearInterval(syncIntervalId);
                        syncIntervalId = null;
                    }
                    try {
                        // Close database connection
                        await dbService.destroy();
                        logger_1.logger.info(node, 'Database connection closed');
                        done();
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        logger_1.logger.error(node, `Error closing database: ${errorMessage}`);
                        done();
                    }
                });
            }
            catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                logger_1.logger.error(node, `Failed to initialize node: ${errorMessage}`);
                node.error(`Node initialization failed: ${errorMessage}`);
                updateNodeStatus('error', 'Initialization failed');
            }
        })();
        /**
         * Sets up the periodic sync interval
         */
        function setupSyncInterval() {
            if (syncIntervalId) {
                clearInterval(syncIntervalId);
            }
            const intervalMs = config.syncInterval * 60 * 1000; // Convert minutes to milliseconds
            logger_1.logger.info(node, `Setting up sync interval: ${config.syncInterval} minutes`);
            syncIntervalId = setInterval(async () => {
                // Skip if sync is already in progress
                if (customerUserSyncHandler && customerUserSyncHandler.isSyncInProgress()) {
                    logger_1.logger.warn(node, 'Scheduled sync skipped - sync already in progress');
                    return;
                }
                try {
                    await performSync('scheduled');
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    logger_1.logger.error(node, `Scheduled sync failed: ${errorMessage}`);
                    updateNodeStatus('error', 'Sync failed');
                }
            }, intervalMs);
        }
        /**
         * Performs a sync operation
         * @param type - Type of sync operation (initial, manual, scheduled)
         * @returns Promise resolving to sync result
         */
        async function performSync(type) {
            if (!customerUserSyncHandler) {
                throw new Error('Sync handler not initialized');
            }
            const syncStartTime = Date.now();
            logger_1.logger.info(node, `Performing ${type} sync`);
            logger_1.logger.debug(node, `Sync configuration: deviceId=${deviceId}, maxRetries=${config.maxRetries}, showDetailedLogs=${config.showDetailedLogs}`, config.showDetailedLogs);
            updateNodeStatus('syncing', `${type.charAt(0).toUpperCase() + type.slice(1)} sync...`);
            try {
                const result = await customerUserSyncHandler.syncAll();
                const syncDuration = Date.now() - syncStartTime;
                // Update node status based on result
                if (result.success) {
                    updateNodeStatus('success', `Sync complete (${result.totalCustomers} customers, ${result.totalUsers} users)`);
                    logger_1.logger.info(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync completed successfully in ${syncDuration}ms`);
                    if (config.showDetailedLogs) {
                        logger_1.logger.debug(node, `Sync result details: ${JSON.stringify(result, null, 2)}`, true);
                    }
                }
                else {
                    updateNodeStatus('error', 'Sync failed');
                    logger_1.logger.error(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync failed after ${syncDuration}ms: ${result.errorMessage || 'Unknown error'}`);
                }
                return result;
            }
            catch (error) {
                const syncDuration = Date.now() - syncStartTime;
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger_1.logger.error(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync failed after ${syncDuration}ms: ${errorMessage}`);
                if (config.showDetailedLogs && error instanceof Error && error.stack) {
                    logger_1.logger.debug(node, `Error stack trace: ${error.stack}`, true);
                }
                updateNodeStatus('error', 'Sync failed');
                logger_1.logger.warn(node, '⚠️  Continuing operations despite sync failure (network may be down)');
                // Don't throw - return failed result to allow node to continue
                return {
                    success: false,
                    errorMessage,
                    customersCreated: 0,
                    customersUpdated: 0,
                    usersCreated: 0,
                    usersUpdated: 0,
                    credentialsCreated: 0,
                    credentialsUpdated: 0,
                    totalCustomers: 0,
                    totalUsers: 0,
                    timestamp: Date.now()
                };
            }
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
                        if (customerUserSyncHandler && !customerUserSyncHandler.isSyncInProgress()) {
                            const statusMessage = customerUserSyncHandler.getStatusMessage();
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
    RED.nodes.registerType('viis-sync-customer-user', ViisSyncCustomerUserNode);
};

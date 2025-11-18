/**
 * @fileoverview Sync Customer User Node for VIIS IoT system
 * This node synchronizes customers and customer users between the local database and server
 * It fetches data from the server, compares with local records, and updates as needed
 */

import { Node, NodeAPI, NodeDef, NodeStatus } from 'node-red';
import { logger } from './utils/logger';
import { DatabaseService } from './services/databaseService';
import { CustomerUserSyncHandler } from './handlers/customerUserSyncHandler';
import { SyncResult } from './services/syncStateService';
import { SYNC_DEFAULTS } from './constants';

/**
 * Configuration definition for the VIIS sync customer user node
 * @interface ViisSyncCustomerUserNodeDef
 * @extends NodeDef
 */
interface ViisSyncCustomerUserNodeDef extends NodeDef {
    /** Device ID for authentication */
    deviceId: string;
    /** Sync interval in minutes */
    syncInterval: number;
    /** Whether to sync on startup */
    syncOnStartup: boolean;
    /** Whether to show detailed logs */
    showDetailedLogs: boolean;
    /** Maximum number of retries for API calls */
    maxRetries: number;
}

export = function (RED: NodeAPI) {
    /**
     * Constructor for the VIIS sync customer user node
     * @param {ViisSyncCustomerUserNodeDef} config - Configuration settings for this node
     */
    function ViisSyncCustomerUserNode(this: Node, config: ViisSyncCustomerUserNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Apply defaults for missing configuration
        config.syncInterval = config.syncInterval || SYNC_DEFAULTS.INTERVAL;
        config.maxRetries = config.maxRetries || 3;
        config.showDetailedLogs = !!config.showDetailedLogs;
        config.syncOnStartup = config.syncOnStartup !== false; // Default to true if not specified

        logger.info(node, 'Initializing VIIS Sync Customer User Node');

        const dbService = new DatabaseService();
        let syncIntervalId: NodeJS.Timeout | null = null;
        let customerUserSyncHandler: CustomerUserSyncHandler | null = null;

        // Initialize database and start sync process
        (async () => {
            try {
                logger.info(node, 'Initializing database connection');
                await dbService.initialize();
                logger.info(node, 'Database initialized successfully');

                // Initialize the sync handler
                customerUserSyncHandler = new CustomerUserSyncHandler(
                    dbService,
                    node,
                    config.deviceId,
                    config.showDetailedLogs,
                    config.maxRetries
                );

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
                node.on('input', async function (msg: any) {
                    // Skip if sync is already in progress
                    if (customerUserSyncHandler && customerUserSyncHandler.isSyncInProgress()) {
                        logger.warn(node, 'Sync already in progress, ignoring new request');
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
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        logger.error(node, `Manual sync failed: ${errorMessage}`);
                        msg.payload = { status: 'error', message: errorMessage };
                        node.send(msg);
                        updateNodeStatus('error', errorMessage);
                    }
                });

                // Clean up on node close
                node.on('close', async (done: () => void) => {
                    logger.info(node, 'Node closing');

                    // Clear any scheduled syncs
                    if (syncIntervalId) {
                        clearInterval(syncIntervalId);
                        syncIntervalId = null;
                    }

                    try {
                        // Close database connection
                        await dbService.destroy();
                        logger.info(node, 'Database connection closed');
                        done();
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        logger.error(node, `Error closing database: ${errorMessage}`);
                        done();
                    }
                });

            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                logger.error(node, `Failed to initialize node: ${errorMessage}`);
                node.error(`Node initialization failed: ${errorMessage}`);
                updateNodeStatus('error', 'Initialization failed');
            }
        })();

        /**
         * Sets up the periodic sync interval
         */
        function setupSyncInterval(): void {
            if (syncIntervalId) {
                clearInterval(syncIntervalId);
            }

            const intervalMs = config.syncInterval * 60 * 1000; // Convert minutes to milliseconds
            logger.info(node, `Setting up sync interval: ${config.syncInterval} minutes`);

            syncIntervalId = setInterval(async () => {
                // Skip if sync is already in progress
                if (customerUserSyncHandler && customerUserSyncHandler.isSyncInProgress()) {
                    logger.warn(node, 'Scheduled sync skipped - sync already in progress');
                    return;
                }

                try {
                    await performSync('scheduled');
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    logger.error(node, `Scheduled sync failed: ${errorMessage}`);
                    updateNodeStatus('error', 'Sync failed');
                }
            }, intervalMs);
        }

        /**
         * Performs a sync operation
         * @param type - Type of sync operation (initial, manual, scheduled)
         * @returns Promise resolving to sync result
         */
        async function performSync(type: 'initial' | 'manual' | 'scheduled'): Promise<SyncResult> {
            if (!customerUserSyncHandler) {
                throw new Error('Sync handler not initialized');
            }

            const syncStartTime = Date.now();
            logger.info(node, `Performing ${type} sync`);
            logger.debug(node, `Sync configuration: deviceId=${config.deviceId}, maxRetries=${config.maxRetries}, showDetailedLogs=${config.showDetailedLogs}`, config.showDetailedLogs);
            updateNodeStatus('syncing', `${type.charAt(0).toUpperCase() + type.slice(1)} sync...`);

            try {
                const result = await customerUserSyncHandler.syncAll();
                const syncDuration = Date.now() - syncStartTime;

                // Update node status based on result
                if (result.success) {
                    updateNodeStatus(
                        'success',
                        `Sync complete (${result.totalCustomers} customers, ${result.totalUsers} users)`
                    );
                    logger.info(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync completed successfully in ${syncDuration}ms`);

                    if (config.showDetailedLogs) {
                        logger.debug(node, `Sync result details: ${JSON.stringify(result, null, 2)}`, true);
                    }
                } else {
                    updateNodeStatus('error', 'Sync failed');
                    logger.error(
                        node,
                        `${type.charAt(0).toUpperCase() + type.slice(1)} sync failed after ${syncDuration}ms: ${result.errorMessage || 'Unknown error'}`
                    );
                }

                return result;
            } catch (error) {
                const syncDuration = Date.now() - syncStartTime;
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.error(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync failed after ${syncDuration}ms: ${errorMessage}`);

                if (config.showDetailedLogs && error instanceof Error && error.stack) {
                    logger.debug(node, `Error stack trace: ${error.stack}`, true);
                }

                updateNodeStatus('error', 'Sync failed');
                logger.warn(node, '⚠️  Continuing operations despite sync failure (network may be down)');
                
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
        function updateNodeStatus(state: 'ready' | 'syncing' | 'success' | 'error', message?: string): void {
            let statusConfig: NodeStatus;

            switch (state) {
                case 'ready':
                    statusConfig = {
                        fill: 'green' as const,
                        shape: 'ring' as const,
                        text: message || 'Ready'
                    };
                    break;

                case 'syncing':
                    statusConfig = {
                        fill: 'blue' as const,
                        shape: 'dot' as const,
                        text: message || 'Syncing...'
                    };
                    break;

                case 'success':
                    statusConfig = {
                        fill: 'green' as const,
                        shape: 'dot' as const,
                        text: message || 'Sync complete'
                    };

                    // Auto-revert to 'ready' status after 5 seconds
                    setTimeout(() => {
                        if (customerUserSyncHandler && !customerUserSyncHandler.isSyncInProgress()) {
                            const statusMessage = customerUserSyncHandler.getStatusMessage();
                            node.status({
                                fill: 'green' as const,
                                shape: 'ring' as const,
                                text: statusMessage || 'Ready'
                            });
                        }
                    }, 5000);
                    break;

                case 'error':
                    statusConfig = {
                        fill: 'red' as const,
                        shape: 'ring' as const,
                        text: message || 'Error'
                    };
                    break;

                default:
                    statusConfig = {
                        fill: 'grey' as const,
                        shape: 'ring' as const,
                        text: message || 'Unknown state'
                    };
            }

            node.status(statusConfig);
        }
    }

    RED.nodes.registerType('viis-sync-customer-user', ViisSyncCustomerUserNode);
};

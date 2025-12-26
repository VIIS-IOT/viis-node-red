/**
 * @fileoverview Sync Production Function Node for VIIS IoT system
 * This node synchronizes production functions between the local database and server
 * It fetches data from the server, compares with local records, and updates as needed
 */

import { Node, NodeAPI, NodeDef, NodeStatus } from 'node-red';
import { logger } from './utils/logger';
import { DatabaseService } from './services/databaseService';
import { ProductionFunctionSyncHandler } from './handlers/productionFunctionSyncHandler';
import { SyncResult } from './services/syncStateService';
import { SYNC_DEFAULTS } from './constants';
import { GlobalContextHelper } from '../../ultils/global-context-helper';

/**
 * Configuration definition for the VIIS sync production function node
 * @interface ViisSyncProductionFunctionNodeDef
 * @extends NodeDef
 */
interface ViisSyncProductionFunctionNodeDef extends NodeDef {
    /** ThingsBoard access token for authentication (optional, auto-loaded from env if not provided) */
    thingsboardAccessToken?: string;
    /** Use environment variable for access token */
    useEnvAccessToken: boolean;
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
     * Constructor for the VIIS sync production function node
     * @param {ViisSyncProductionFunctionNodeDef} config - Configuration settings for this node
     */
    function ViisSyncProductionFunctionNode(this: Node, config: ViisSyncProductionFunctionNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Apply defaults for missing configuration
        config.syncInterval = config.syncInterval || SYNC_DEFAULTS.INTERVAL;
        config.maxRetries = config.maxRetries || 3;
        config.showDetailedLogs = !!config.showDetailedLogs;
        config.syncOnStartup = config.syncOnStartup !== false; // Default to true if not specified

        // Auto-load thingsboard access token from environment if not provided or if useEnvAccessToken is enabled
        const globalHelper = new GlobalContextHelper(node.context());
        let thingsboardAccessToken: string;

        if (config.useEnvAccessToken) {
            // Force load from environment
            thingsboardAccessToken = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
            if (!thingsboardAccessToken) {
                node.error('DEVICE_ACCESS_TOKEN environment variable not found');
                node.status({ fill: 'red', shape: 'ring', text: 'Missing DEVICE_ACCESS_TOKEN env' });
                return;
            }
            logger.info(node, 'Using ThingsBoard Access Token from DEVICE_ACCESS_TOKEN environment variable');
        } else {
            // Use config or fallback to environment
            thingsboardAccessToken = config.thingsboardAccessToken || globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
            if (!thingsboardAccessToken) {
                node.error('ThingsBoard Access Token not configured and DEVICE_ACCESS_TOKEN not found in environment variables');
                node.status({ fill: 'red', shape: 'ring', text: 'Missing Access Token' });
                return;
            }
            if (!config.thingsboardAccessToken) {
                logger.info(node, 'ThingsBoard Access Token auto-loaded from DEVICE_ACCESS_TOKEN environment variable');
            }
        }

        logger.info(node, 'Initializing VIIS Sync Production Function Node');
        logger.info(node, `Using ThingsBoard Access Token: ${thingsboardAccessToken.substring(0, 8)}...`);

        const dbService = new DatabaseService();
        let syncIntervalId: NodeJS.Timeout | null = null;
        let productionFunctionSyncHandler: ProductionFunctionSyncHandler | null = null;

        // Initialize database and start sync process
        (async () => {
            try {
                logger.info(node, 'Initializing database connection');
                await dbService.initialize();
                logger.info(node, 'Database initialized successfully');

                // Initialize the sync handler
                productionFunctionSyncHandler = new ProductionFunctionSyncHandler(
                    dbService,
                    node,
                    thingsboardAccessToken,
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
                    if (productionFunctionSyncHandler && productionFunctionSyncHandler.isSyncInProgress()) {
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
                if (productionFunctionSyncHandler && productionFunctionSyncHandler.isSyncInProgress()) {
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
            if (!productionFunctionSyncHandler) {
                throw new Error('Sync handler not initialized');
            }

            const syncStartTime = Date.now();
            logger.info(node, `Performing ${type} sync`);
            logger.debug(node, `Sync configuration: thingsboardAccessToken=${thingsboardAccessToken.substring(0, 8)}..., maxRetries=${config.maxRetries}, showDetailedLogs=${config.showDetailedLogs}`, config.showDetailedLogs);
            updateNodeStatus('syncing', `${type.charAt(0).toUpperCase() + type.slice(1)} sync...`);

            try {
                const result = await productionFunctionSyncHandler.syncAll();
                const syncDuration = Date.now() - syncStartTime;

                // Update node status based on result
                if (result.success) {
                    updateNodeStatus(
                        'success',
                        `Sync complete (${result.totalFunctions} functions)`
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
                    functionsCreated: 0,
                    functionsUpdated: 0,
                    totalFunctions: 0,
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
                        if (productionFunctionSyncHandler && !productionFunctionSyncHandler.isSyncInProgress()) {
                            const statusMessage = productionFunctionSyncHandler.getStatusMessage();
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

    RED.nodes.registerType('viis-sync-production-function', ViisSyncProductionFunctionNode);
};

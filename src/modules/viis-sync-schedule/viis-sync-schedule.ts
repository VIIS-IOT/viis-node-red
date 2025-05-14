/**
 * @fileoverview Sync Schedule Node for VIIS IoT system
 * This node synchronizes schedules and schedule plans between the local database and server
 * It fetches data from the server, compares with local records, and updates as needed
 */

import { Node, NodeAPI, NodeDef, NodeStatus } from 'node-red';
import { logger } from './utils/logger';
import { DatabaseService } from './services/databaseService';
import { ScheduleSyncHandler } from './handlers/scheduleSyncHandler';
import { ExtendedNodeMessage } from './interfaces/types';
import { SyncResult } from './services/syncStateService';
import { SYNC_DEFAULTS } from './constants';

/**
 * Configuration definition for the VIIS sync schedule node
 * @interface ViisSyncScheduleNodeDef
 * @extends NodeDef
 */
interface ViisSyncScheduleNodeDef extends NodeDef {
    /** Access token for device authentication */
    accessToken: string;
    /** Sync interval in minutes */
    syncInterval: number;
    /** Whether to sync on startup */
    syncOnStartup: boolean;
    /** Whether to show detailed logs */
    showDetailedLogs: boolean;
    /** Maximum number of retries for API calls */
    maxRetries: number;
}

export = function(RED: NodeAPI) {
    /**
     * Constructor for the VIIS sync schedule node
     * @param {ViisSyncScheduleNodeDef} config - Configuration settings for this node
     */
    function ViisSyncScheduleNode(this: Node, config: ViisSyncScheduleNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Apply defaults for missing configuration
        config.syncInterval = config.syncInterval || SYNC_DEFAULTS.INTERVAL;
        config.maxRetries = config.maxRetries || 3;
        config.showDetailedLogs = !!config.showDetailedLogs;
        config.syncOnStartup = config.syncOnStartup !== false; // Default to true if not specified

        logger.info(node, 'Initializing VIIS Sync Schedule Node');
        
        const dbService = new DatabaseService();
        let syncIntervalId: NodeJS.Timeout | null = null;
        let scheduleSyncHandler: ScheduleSyncHandler | null = null;
        
        // Initialize database and start sync process
        (async () => {
            try {
                logger.info(node, 'Initializing database connection');
                await dbService.initialize();
                logger.info(node, 'Database initialized successfully');

                // Initialize the sync handler
                scheduleSyncHandler = new ScheduleSyncHandler(dbService, node, config.accessToken);
                
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
                node.on('input', async (msg: ExtendedNodeMessage) => {
                    // Skip if sync is already in progress
                    if (scheduleSyncHandler && scheduleSyncHandler.isSyncInProgress()) {
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
                if (scheduleSyncHandler && scheduleSyncHandler.isSyncInProgress()) {
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
            if (!scheduleSyncHandler) {
                throw new Error('Sync handler not initialized');
            }
            
            logger.info(node, `Performing ${type} sync`);
            updateNodeStatus('syncing', `${type.charAt(0).toUpperCase() + type.slice(1)} sync...`);
            
            try {
                const result = await scheduleSyncHandler.syncAll();
                
                // Update node status based on result
                if (result.success) {
                    updateNodeStatus('success', `Sync complete (${result.totalPlans} plans, ${result.totalSchedules} schedules)`);
                    logger.info(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync completed successfully`);
                } else {
                    updateNodeStatus('error', 'Sync failed');
                    logger.error(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync failed: ${result.errorMessage || 'Unknown error'}`);
                }
                
                return result;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.error(node, `${type.charAt(0).toUpperCase() + type.slice(1)} sync failed: ${errorMessage}`);
                updateNodeStatus('error', 'Sync failed');
                throw error;
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
                        if (scheduleSyncHandler && !scheduleSyncHandler.isSyncInProgress()) {
                            const statusMessage = scheduleSyncHandler.getStatusMessage();
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
    
    RED.nodes.registerType('viis-sync-schedule', ViisSyncScheduleNode);
};

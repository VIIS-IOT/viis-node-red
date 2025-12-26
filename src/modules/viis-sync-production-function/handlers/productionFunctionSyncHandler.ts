/**
 * @fileoverview Production Function Sync Handler for VIIS Sync Production Function module
 * Handles synchronization of production functions between server and local database
 */

import { Node } from 'node-red';
import { Repository } from 'typeorm';
import { DatabaseService } from '../services/databaseService';
import { ApiService } from '../services/apiService';
import { ServerProductionFunction } from '../interfaces/types';
import { logger } from '../utils/logger';
import { TabiotProductionFunction } from '../../../orm/entities/production-function/TabioProductionFunction';
import { TabiotDeviceProfile } from '../../../orm/entities/device-profile/TabiotDeviceProfile';
import { adjustToUTC7 } from '../../../ultils/helper';
import { SyncStateService, SyncResult } from '../services/syncStateService';

/**
 * Handler for synchronizing production functions
 */
export class ProductionFunctionSyncHandler {
    /** Repository for production functions */
    private readonly productionFunctionRepo: Repository<TabiotProductionFunction>;
    /** Repository for device profiles */
    private readonly deviceProfileRepo: Repository<TabiotDeviceProfile>;
    /** Node-RED node instance */
    private readonly node: Node;
    /** API service for server communication */
    private readonly apiService: ApiService;
    /** Service for tracking sync state */
    private readonly syncStateService: SyncStateService;
    /** Configuration for detailed logging */
    private readonly showDetailedLogs: boolean;
    /** Statistics for current sync operation */
    private syncStats: {
        functionsCreated: number;
        functionsUpdated: number;
        totalFunctions: number;
    };

    /**
     * Creates a new production function sync handler
     * @param dbService - Database service for repository access
     * @param node - Node-RED node instance
     * @param thingsboardAccessToken - ThingsBoard access token for authentication
     * @param showDetailedLogs - Whether to show detailed logs
     * @param maxRetries - Maximum number of retries for API calls
     */
    constructor(
        dbService: DatabaseService,
        node: Node,
        thingsboardAccessToken: string,
        showDetailedLogs: boolean = false,
        maxRetries: number = 3
    ) {
        this.productionFunctionRepo = dbService.getProductionFunctionRepository();
        this.deviceProfileRepo = dbService.getDeviceProfileRepository();
        this.node = node;
        this.apiService = new ApiService(thingsboardAccessToken, maxRetries, node, showDetailedLogs);
        this.syncStateService = new SyncStateService(node);
        this.showDetailedLogs = showDetailedLogs;

        // Initialize sync statistics
        this.resetSyncStats();

        logger.info(node, 'ProductionFunctionSyncHandler initialized');
        logger.debug(node, `Configuration: showDetailedLogs=${showDetailedLogs}, maxRetries=${maxRetries}`, showDetailedLogs);
    }

    /**
     * Resets sync statistics to zero
     */
    private resetSyncStats(): void {
        this.syncStats = {
            functionsCreated: 0,
            functionsUpdated: 0,
            totalFunctions: 0
        };
    }

    /**
     * Synchronizes all production functions
     * @returns Promise that resolves to the sync result
     */
    async syncAll(): Promise<SyncResult> {
        const syncTimer = logger.startTimer('Full sync operation');

        // Reset sync statistics
        this.resetSyncStats();

        // Record sync start
        this.syncStateService.startSync();

        try {
            logger.info(this.node, 'Starting synchronization of production functions');

            // Fetch production functions from server
            // Note: Backend already merges custom labels from tabiot_function_custom_setting
            // and filters out hidden functions (is_hidden = 1)
            const apiTimer = logger.startTimer('API fetch production functions');
            const serverResponse = await this.apiService.syncProductionFunctions();
            logger.endTimer(this.node, apiTimer, this.showDetailedLogs);

            const serverProductionFunctions = serverResponse.production_functions || [];
            const deviceProfile = serverResponse.device_profile;
            const deviceInfo = serverResponse.device_info;
            const totalFromServer = serverResponse.total || 0;

            this.syncStats.totalFunctions = serverProductionFunctions.length;
            logger.info(this.node, `Received ${serverProductionFunctions.length} production functions from server (total visible: ${totalFromServer})`);

            if (this.showDetailedLogs) {
                logger.debug(this.node, `Device Profile: ${deviceProfile?.name || 'N/A'} (${deviceProfile?.label || 'N/A'})`, true);
                logger.debug(this.node, `Device Info: ${deviceInfo?.name || 'N/A'} (${deviceInfo?.label || 'N/A'})`, true);
                logger.debug(this.node, `Server response structure: ${JSON.stringify(serverResponse, null, 2)}`, true);
            }

            // Ensure device profile exists in local database before syncing functions
            let localDeviceProfile: TabiotDeviceProfile | null = null;
            if (deviceProfile?.name) {
                localDeviceProfile = await this.ensureDeviceProfileExists(deviceProfile);
            }

            // Process each production function
            let processedFunctions = 0;
            for (const serverFunction of serverProductionFunctions) {
                const functionTimer = logger.startTimer(`Sync function: ${serverFunction.name}`);

                try {
                    await this.syncProductionFunction(serverFunction, localDeviceProfile);
                    processedFunctions++;

                    logger.endTimer(this.node, functionTimer, this.showDetailedLogs);

                    if (this.showDetailedLogs) {
                        logger.debug(this.node, `Progress: ${processedFunctions}/${serverProductionFunctions.length} functions processed`, true);
                    }
                } catch (error) {
                    logger.endTimer(this.node, functionTimer, this.showDetailedLogs);
                    logger.errorWithStack(this.node, `Failed to sync production function ${serverFunction.name}`, error as Error, this.showDetailedLogs);
                    throw error;
                }
            }

            // Create sync result
            const result: SyncResult = {
                success: true,
                ...this.syncStats,
                timestamp: Date.now()
            };

            // Record successful sync
            this.syncStateService.recordSyncResult(result);

            const totalDuration = logger.endTimer(this.node, syncTimer, this.showDetailedLogs);

            logger.info(this.node, 'Synchronization completed successfully');
            logger.syncStats(this.node, this.syncStats, this.showDetailedLogs);
            logger.info(this.node, `Total sync duration: ${totalDuration}ms`);

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const totalDuration = logger.endTimer(this.node, syncTimer, this.showDetailedLogs);

            // Create failed sync result
            const result: SyncResult = {
                success: false,
                errorMessage,
                ...this.syncStats,
                timestamp: Date.now()
            };

            // Record failed sync
            this.syncStateService.recordSyncResult(result);

            logger.errorWithStack(this.node, `Synchronization failed after ${totalDuration}ms`, error as Error, this.showDetailedLogs);
            logger.syncStats(this.node, this.syncStats, this.showDetailedLogs);
            logger.warn(this.node, '⚠️  Continuing operations despite sync failure (network may be down)');

            // Don't throw - return failed result to allow node to continue
            return result;
        }
    }

    /**
     * Gets the current sync state information
     * @returns Status message describing the current sync state
     */
    getStatusMessage(): string {
        return this.syncStateService.getStatusMessage();
    }

    /**
     * Checks if a sync is currently in progress
     * @returns True if sync is in progress, false otherwise
     */
    isSyncInProgress(): boolean {
        return this.syncStateService.isSyncInProgress();
    }

    /**
     * Ensures device profile exists in local database, creates if not found
     * @param deviceProfileInfo - Device profile information from server
     * @returns Promise resolving to the local device profile entity
     */
    private async ensureDeviceProfileExists(deviceProfileInfo: { name: string; label?: string; description?: string; type?: string }): Promise<TabiotDeviceProfile | null> {
        try {
            // Check if device profile exists
            let deviceProfile = await this.deviceProfileRepo.findOne({
                where: { name: deviceProfileInfo.name }
            });

            if (!deviceProfile) {
                // Create new device profile
                logger.info(this.node, `Device profile ${deviceProfileInfo.name} not found locally, creating new record`);
                deviceProfile = new TabiotDeviceProfile();
                deviceProfile.name = deviceProfileInfo.name;
                deviceProfile.label = deviceProfileInfo.label || deviceProfileInfo.name;
                deviceProfile.description = deviceProfileInfo.description || null;
                deviceProfile.type = deviceProfileInfo.type || 'DEFAULT';
                deviceProfile.creation = adjustToUTC7(new Date());
                deviceProfile.modified = adjustToUTC7(new Date());

                await this.deviceProfileRepo.save(deviceProfile);
                logger.info(this.node, `Successfully created device profile: ${deviceProfileInfo.name}`);
            } else {
                logger.info(this.node, `Device profile ${deviceProfileInfo.name} already exists locally`);
            }

            return deviceProfile;
        } catch (error) {
            logger.errorWithStack(this.node, `Failed to ensure device profile exists: ${deviceProfileInfo.name}`, error as Error, this.showDetailedLogs);
            return null;
        }
    }

    /**
     * Synchronizes a single production function
     * @param serverFunction - Production function data from server
     * @param deviceProfile - Device profile entity (optional)
     * @returns Promise that resolves when synchronization is complete
     */
    private async syncProductionFunction(serverFunction: ServerProductionFunction, deviceProfile?: TabiotDeviceProfile | null): Promise<void> {
        try {
            logger.info(this.node, `Synchronizing production function: ${serverFunction.name}`);
            logger.debug(this.node, `Function data: ${JSON.stringify(serverFunction)}`, this.showDetailedLogs);

            // Check if production function already exists in local database
            const dbTimer = logger.startTimer(`DB query for function: ${serverFunction.name}`);
            const localFunction = await this.productionFunctionRepo.findOne({
                where: { name: serverFunction.name }
            });
            logger.endTimer(this.node, dbTimer, this.showDetailedLogs);

            logger.dbOperation(this.node, 'FIND_ONE', 'TabiotProductionFunction', { name: serverFunction.name }, this.showDetailedLogs);

            if (!localFunction) {
                // Production function doesn't exist locally, create it
                logger.info(this.node, `Production function ${serverFunction.name} not found locally, creating new record`);
                await this.createProductionFunction(serverFunction, deviceProfile);
            } else {
                // Production function exists locally, update if needed
                logger.info(this.node, `Production function ${serverFunction.name} found locally, checking for updates`);
                await this.updateProductionFunctionIfNeeded(localFunction, serverFunction, deviceProfile);
            }
        } catch (error) {
            logger.errorWithStack(this.node, `Failed to sync production function ${serverFunction.name}`, error as Error, this.showDetailedLogs);
            throw error;
        }
    }

    /**
     * Creates a new production function in the local database
     * @param serverFunction - Production function data from server
     * @param deviceProfile - Device profile entity (optional)
     * @returns Promise that resolves when the production function is created
     */
    private async createProductionFunction(serverFunction: ServerProductionFunction, deviceProfile?: TabiotDeviceProfile | null): Promise<void> {
        const createTimer = logger.startTimer(`Create function: ${serverFunction.name}`);

        try {
            logger.info(this.node, `Creating new production function: ${serverFunction.name}`);

            // Create new production function entity
            const newFunction = new TabiotProductionFunction();
            newFunction.name = serverFunction.name;
            newFunction.type = serverFunction.type;
            newFunction.label = serverFunction.label;
            newFunction.identifier = serverFunction.identifier;
            newFunction.data_type = serverFunction.data_type;
            newFunction.icon_url = serverFunction.icon_url;
            newFunction.data_on_text = serverFunction.data_on_text;
            newFunction.data_off_text = serverFunction.data_off_text;
            newFunction.enum_value = serverFunction.enum_value;
            newFunction.unit = serverFunction.unit;
            newFunction.data_permission = serverFunction.data_permission;
            newFunction.description = serverFunction.description;
            newFunction.device_group_function_id = serverFunction.device_group_function_id;
            newFunction.data_measure_max = serverFunction.data_measure_max;
            newFunction.data_measure_min = serverFunction.data_measure_min;
            newFunction.data_eligible_max = serverFunction.data_eligible_max;
            newFunction.data_eligible_min = serverFunction.data_eligible_min;
            newFunction.checkbox_bit_label1 = serverFunction.checkbox_bit_label1;
            newFunction.checkbox_bit_label2 = serverFunction.checkbox_bit_label2;
            newFunction.checkbox_bit_label3 = serverFunction.checkbox_bit_label3;
            newFunction.checkbox_bit_label4 = serverFunction.checkbox_bit_label4;
            newFunction.checkbox_bit_label5 = serverFunction.checkbox_bit_label5;
            newFunction.checkbox_bit_label6 = serverFunction.checkbox_bit_label6;
            newFunction.checkbox_bit_label7 = serverFunction.checkbox_bit_label7;
            newFunction.checkbox_bit_label8 = serverFunction.checkbox_bit_label8;
            newFunction.chart_type = serverFunction.chart_type;
            newFunction.round_type = serverFunction.round_type;
            newFunction.md_size = serverFunction.md_size;
            newFunction.show_chart = serverFunction.show_chart;
            newFunction.index_sort = serverFunction.index_sort;

            // Set device profile relationship if provided
            if (deviceProfile) {
                newFunction.device_profile = deviceProfile;
                if (this.showDetailedLogs) {
                    logger.debug(this.node, `Assigned device profile ${deviceProfile.name} to production function ${serverFunction.name}`, true);
                }
            }

            // Set the created and modified timestamps
            newFunction.creation = adjustToUTC7(new Date());
            newFunction.modified = adjustToUTC7(new Date());

            if (this.showDetailedLogs) {
                logger.debug(this.node, `Function entity prepared: ${JSON.stringify(newFunction, null, 2)}`, true);
            }

            // Save the production function to the database
            const saveTimer = logger.startTimer(`DB save function: ${serverFunction.name}`);
            await this.productionFunctionRepo.save(newFunction);
            logger.endTimer(this.node, saveTimer, this.showDetailedLogs);

            logger.dbOperation(this.node, 'SAVE', 'TabiotProductionFunction', { name: serverFunction.name }, this.showDetailedLogs);

            this.syncStats.functionsCreated++;
            logger.endTimer(this.node, createTimer, this.showDetailedLogs);
            logger.info(this.node, `Successfully created production function: ${serverFunction.name}`);
        } catch (error) {
            logger.endTimer(this.node, createTimer, this.showDetailedLogs);
            logger.errorWithStack(this.node, `Failed to create production function ${serverFunction.name}`, error as Error, this.showDetailedLogs);
            throw error;
        }
    }

    /**
     * Updates a local production function if the server version is newer
     * @param localFunction - Local production function entity
     * @param serverFunction - Production function data from server
     * @param deviceProfile - Device profile entity (optional)
     * @returns Promise that resolves when the production function is updated (if needed)
     */
    private async updateProductionFunctionIfNeeded(
        localFunction: TabiotProductionFunction,
        serverFunction: ServerProductionFunction,
        deviceProfile?: TabiotDeviceProfile | null
    ): Promise<void> {
        try {
            logger.info(this.node, `Checking for updates to production function: ${serverFunction.name}`);

            // Check if any fields need updating
            let needsUpdate = false;

            if (localFunction.type !== serverFunction.type ||
                localFunction.label !== serverFunction.label ||
                localFunction.identifier !== serverFunction.identifier ||
                localFunction.data_type !== serverFunction.data_type ||
                localFunction.icon_url !== serverFunction.icon_url ||
                localFunction.data_on_text !== serverFunction.data_on_text ||
                localFunction.data_off_text !== serverFunction.data_off_text ||
                localFunction.enum_value !== serverFunction.enum_value ||
                localFunction.unit !== serverFunction.unit ||
                localFunction.data_permission !== serverFunction.data_permission ||
                localFunction.description !== serverFunction.description ||
                localFunction.device_group_function_id !== serverFunction.device_group_function_id ||
                localFunction.data_measure_max !== serverFunction.data_measure_max ||
                localFunction.data_measure_min !== serverFunction.data_measure_min ||
                localFunction.data_eligible_max !== serverFunction.data_eligible_max ||
                localFunction.data_eligible_min !== serverFunction.data_eligible_min ||
                localFunction.checkbox_bit_label1 !== serverFunction.checkbox_bit_label1 ||
                localFunction.checkbox_bit_label2 !== serverFunction.checkbox_bit_label2 ||
                localFunction.checkbox_bit_label3 !== serverFunction.checkbox_bit_label3 ||
                localFunction.checkbox_bit_label4 !== serverFunction.checkbox_bit_label4 ||
                localFunction.checkbox_bit_label5 !== serverFunction.checkbox_bit_label5 ||
                localFunction.checkbox_bit_label6 !== serverFunction.checkbox_bit_label6 ||
                localFunction.checkbox_bit_label7 !== serverFunction.checkbox_bit_label7 ||
                localFunction.checkbox_bit_label8 !== serverFunction.checkbox_bit_label8 ||
                localFunction.chart_type !== serverFunction.chart_type ||
                localFunction.round_type !== serverFunction.round_type ||
                localFunction.md_size !== serverFunction.md_size ||
                localFunction.show_chart !== serverFunction.show_chart ||
                localFunction.index_sort !== serverFunction.index_sort) {
                needsUpdate = true;
            }

            if (!needsUpdate) {
                logger.info(this.node, `No updates needed for production function: ${serverFunction.name}`);
                return;
            }

            // Update production function fields
            localFunction.type = serverFunction.type;
            localFunction.label = serverFunction.label;
            localFunction.identifier = serverFunction.identifier;
            localFunction.data_type = serverFunction.data_type;
            localFunction.icon_url = serverFunction.icon_url;
            localFunction.data_on_text = serverFunction.data_on_text;
            localFunction.data_off_text = serverFunction.data_off_text;
            localFunction.enum_value = serverFunction.enum_value;
            localFunction.unit = serverFunction.unit;
            localFunction.data_permission = serverFunction.data_permission;
            localFunction.description = serverFunction.description;
            localFunction.device_group_function_id = serverFunction.device_group_function_id;
            localFunction.data_measure_max = serverFunction.data_measure_max;
            localFunction.data_measure_min = serverFunction.data_measure_min;
            localFunction.data_eligible_max = serverFunction.data_eligible_max;
            localFunction.data_eligible_min = serverFunction.data_eligible_min;
            localFunction.checkbox_bit_label1 = serverFunction.checkbox_bit_label1;
            localFunction.checkbox_bit_label2 = serverFunction.checkbox_bit_label2;
            localFunction.checkbox_bit_label3 = serverFunction.checkbox_bit_label3;
            localFunction.checkbox_bit_label4 = serverFunction.checkbox_bit_label4;
            localFunction.checkbox_bit_label5 = serverFunction.checkbox_bit_label5;
            localFunction.checkbox_bit_label6 = serverFunction.checkbox_bit_label6;
            localFunction.checkbox_bit_label7 = serverFunction.checkbox_bit_label7;
            localFunction.checkbox_bit_label8 = serverFunction.checkbox_bit_label8;
            localFunction.chart_type = serverFunction.chart_type;
            localFunction.round_type = serverFunction.round_type;
            localFunction.md_size = serverFunction.md_size;
            localFunction.show_chart = serverFunction.show_chart;
            localFunction.index_sort = serverFunction.index_sort;

            // Update device profile relationship if provided
            if (deviceProfile) {
                localFunction.device_profile = deviceProfile;
                if (this.showDetailedLogs) {
                    logger.debug(this.node, `Updated device profile ${deviceProfile.name} for production function ${serverFunction.name}`, true);
                }
            }

            // Update the modified timestamp
            localFunction.modified = adjustToUTC7(new Date());

            // Save the updated production function to the database
            await this.productionFunctionRepo.save(localFunction);
            this.syncStats.functionsUpdated++;
            logger.info(this.node, `Updated production function: ${serverFunction.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to update production function ${serverFunction.name}: ${errorMessage}`);
            throw error;
        }
    }
}

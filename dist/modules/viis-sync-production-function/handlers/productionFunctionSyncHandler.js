"use strict";
/**
 * @fileoverview Production Function Sync Handler for VIIS Sync Production Function module
 * Handles synchronization of production functions between server and local database
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductionFunctionSyncHandler = void 0;
const apiService_1 = require("../services/apiService");
const logger_1 = require("../utils/logger");
const TabioProductionFunction_1 = require("../../../orm/entities/production-function/TabioProductionFunction");
const TabiotDeviceProfile_1 = require("../../../orm/entities/device-profile/TabiotDeviceProfile");
const helper_1 = require("../../../ultils/helper");
const syncStateService_1 = require("../services/syncStateService");
/**
 * Handler for synchronizing production functions
 */
class ProductionFunctionSyncHandler {
    /**
     * Creates a new production function sync handler
     * @param dbService - Database service for repository access
     * @param node - Node-RED node instance
     * @param thingsboardAccessToken - ThingsBoard access token for authentication
     * @param showDetailedLogs - Whether to show detailed logs
     * @param maxRetries - Maximum number of retries for API calls
     */
    constructor(dbService, node, thingsboardAccessToken, showDetailedLogs = false, maxRetries = 3) {
        this.productionFunctionRepo = dbService.getProductionFunctionRepository();
        this.deviceProfileRepo = dbService.getDeviceProfileRepository();
        this.node = node;
        this.apiService = new apiService_1.ApiService(thingsboardAccessToken, maxRetries, node, showDetailedLogs);
        this.syncStateService = new syncStateService_1.SyncStateService(node);
        this.showDetailedLogs = showDetailedLogs;
        // Initialize sync statistics
        this.resetSyncStats();
        logger_1.logger.info(node, 'ProductionFunctionSyncHandler initialized');
        logger_1.logger.debug(node, `Configuration: showDetailedLogs=${showDetailedLogs}, maxRetries=${maxRetries}`, showDetailedLogs);
    }
    /**
     * Resets sync statistics to zero
     */
    resetSyncStats() {
        this.syncStats = {
            functionsCreated: 0,
            functionsUpdated: 0,
            totalFunctions: 0
        };
    }
    /**
     * Compares multilingual label objects safely
     */
    isLabelMultilingualChanged(localLabelMultilingual, serverLabelMultilingual) {
        return JSON.stringify(localLabelMultilingual !== null && localLabelMultilingual !== void 0 ? localLabelMultilingual : null) !== JSON.stringify(serverLabelMultilingual !== null && serverLabelMultilingual !== void 0 ? serverLabelMultilingual : null);
    }
    /**
     * Synchronizes all production functions
     * @returns Promise that resolves to the sync result
     */
    async syncAll() {
        const syncTimer = logger_1.logger.startTimer('Full sync operation');
        // Reset sync statistics
        this.resetSyncStats();
        // Record sync start
        this.syncStateService.startSync();
        try {
            logger_1.logger.info(this.node, 'Starting synchronization of production functions');
            // Fetch production functions from server
            // Note: Backend already merges custom labels from tabiot_function_custom_setting
            // and filters out hidden functions (is_hidden = 1)
            const apiTimer = logger_1.logger.startTimer('API fetch production functions');
            const serverResponse = await this.apiService.syncProductionFunctions();
            logger_1.logger.endTimer(this.node, apiTimer, this.showDetailedLogs);
            const serverProductionFunctions = serverResponse.production_functions || [];
            const deviceProfile = serverResponse.device_profile;
            const deviceInfo = serverResponse.device_info;
            const totalFromServer = serverResponse.total || 0;
            this.syncStats.totalFunctions = serverProductionFunctions.length;
            logger_1.logger.info(this.node, `Received ${serverProductionFunctions.length} production functions from server (total visible: ${totalFromServer})`);
            if (this.showDetailedLogs) {
                logger_1.logger.debug(this.node, `Device Profile: ${(deviceProfile === null || deviceProfile === void 0 ? void 0 : deviceProfile.name) || 'N/A'} (${(deviceProfile === null || deviceProfile === void 0 ? void 0 : deviceProfile.label) || 'N/A'})`, true);
                logger_1.logger.debug(this.node, `Device Info: ${(deviceInfo === null || deviceInfo === void 0 ? void 0 : deviceInfo.name) || 'N/A'} (${(deviceInfo === null || deviceInfo === void 0 ? void 0 : deviceInfo.label) || 'N/A'})`, true);
                logger_1.logger.debug(this.node, `Server response structure: ${JSON.stringify(serverResponse, null, 2)}`, true);
            }
            // Ensure device profile exists in local database before syncing functions
            let localDeviceProfile = null;
            if (deviceProfile === null || deviceProfile === void 0 ? void 0 : deviceProfile.name) {
                localDeviceProfile = await this.ensureDeviceProfileExists(deviceProfile);
            }
            // Process each production function
            let processedFunctions = 0;
            for (const serverFunction of serverProductionFunctions) {
                const functionTimer = logger_1.logger.startTimer(`Sync function: ${serverFunction.name}`);
                try {
                    await this.syncProductionFunction(serverFunction, localDeviceProfile);
                    processedFunctions++;
                    logger_1.logger.endTimer(this.node, functionTimer, this.showDetailedLogs);
                    if (this.showDetailedLogs) {
                        logger_1.logger.debug(this.node, `Progress: ${processedFunctions}/${serverProductionFunctions.length} functions processed`, true);
                    }
                }
                catch (error) {
                    logger_1.logger.endTimer(this.node, functionTimer, this.showDetailedLogs);
                    logger_1.logger.errorWithStack(this.node, `Failed to sync production function ${serverFunction.name}`, error, this.showDetailedLogs);
                    throw error;
                }
            }
            // Create sync result
            const result = Object.assign(Object.assign({ success: true }, this.syncStats), { timestamp: Date.now() });
            // Record successful sync
            this.syncStateService.recordSyncResult(result);
            const totalDuration = logger_1.logger.endTimer(this.node, syncTimer, this.showDetailedLogs);
            logger_1.logger.info(this.node, 'Synchronization completed successfully');
            logger_1.logger.syncStats(this.node, this.syncStats, this.showDetailedLogs);
            logger_1.logger.info(this.node, `Total sync duration: ${totalDuration}ms`);
            return result;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const totalDuration = logger_1.logger.endTimer(this.node, syncTimer, this.showDetailedLogs);
            // Create failed sync result
            const result = Object.assign(Object.assign({ success: false, errorMessage }, this.syncStats), { timestamp: Date.now() });
            // Record failed sync
            this.syncStateService.recordSyncResult(result);
            logger_1.logger.errorWithStack(this.node, `Synchronization failed after ${totalDuration}ms`, error, this.showDetailedLogs);
            logger_1.logger.syncStats(this.node, this.syncStats, this.showDetailedLogs);
            logger_1.logger.warn(this.node, '⚠️  Continuing operations despite sync failure (network may be down)');
            // Don't throw - return failed result to allow node to continue
            return result;
        }
    }
    /**
     * Gets the current sync state information
     * @returns Status message describing the current sync state
     */
    getStatusMessage() {
        return this.syncStateService.getStatusMessage();
    }
    /**
     * Checks if a sync is currently in progress
     * @returns True if sync is in progress, false otherwise
     */
    isSyncInProgress() {
        return this.syncStateService.isSyncInProgress();
    }
    /**
     * Ensures device profile exists in local database, creates if not found
     * @param deviceProfileInfo - Device profile information from server
     * @returns Promise resolving to the local device profile entity
     */
    async ensureDeviceProfileExists(deviceProfileInfo) {
        try {
            // Check if device profile exists
            let deviceProfile = await this.deviceProfileRepo.findOne({
                where: { name: deviceProfileInfo.name }
            });
            if (!deviceProfile) {
                // Create new device profile
                logger_1.logger.info(this.node, `Device profile ${deviceProfileInfo.name} not found locally, creating new record`);
                deviceProfile = new TabiotDeviceProfile_1.TabiotDeviceProfile();
                deviceProfile.name = deviceProfileInfo.name;
                deviceProfile.label = deviceProfileInfo.label || deviceProfileInfo.name;
                deviceProfile.description = deviceProfileInfo.description || null;
                deviceProfile.type = deviceProfileInfo.type || 'DEFAULT';
                deviceProfile.creation = (0, helper_1.adjustToUTC7)(new Date());
                deviceProfile.modified = (0, helper_1.adjustToUTC7)(new Date());
                await this.deviceProfileRepo.save(deviceProfile);
                logger_1.logger.info(this.node, `Successfully created device profile: ${deviceProfileInfo.name}`);
            }
            else {
                logger_1.logger.info(this.node, `Device profile ${deviceProfileInfo.name} already exists locally`);
            }
            return deviceProfile;
        }
        catch (error) {
            logger_1.logger.errorWithStack(this.node, `Failed to ensure device profile exists: ${deviceProfileInfo.name}`, error, this.showDetailedLogs);
            return null;
        }
    }
    /**
     * Synchronizes a single production function
     * @param serverFunction - Production function data from server
     * @param deviceProfile - Device profile entity (optional)
     * @returns Promise that resolves when synchronization is complete
     */
    async syncProductionFunction(serverFunction, deviceProfile) {
        try {
            logger_1.logger.info(this.node, `Synchronizing production function: ${serverFunction.name}`);
            logger_1.logger.debug(this.node, `Function data: ${JSON.stringify(serverFunction)}`, this.showDetailedLogs);
            // Check if production function already exists in local database
            const dbTimer = logger_1.logger.startTimer(`DB query for function: ${serverFunction.name}`);
            const localFunction = await this.productionFunctionRepo.findOne({
                where: { name: serverFunction.name }
            });
            logger_1.logger.endTimer(this.node, dbTimer, this.showDetailedLogs);
            logger_1.logger.dbOperation(this.node, 'FIND_ONE', 'TabiotProductionFunction', { name: serverFunction.name }, this.showDetailedLogs);
            if (!localFunction) {
                // Production function doesn't exist locally, create it
                logger_1.logger.info(this.node, `Production function ${serverFunction.name} not found locally, creating new record`);
                await this.createProductionFunction(serverFunction, deviceProfile);
            }
            else {
                // Production function exists locally, update if needed
                logger_1.logger.info(this.node, `Production function ${serverFunction.name} found locally, checking for updates`);
                await this.updateProductionFunctionIfNeeded(localFunction, serverFunction, deviceProfile);
            }
        }
        catch (error) {
            logger_1.logger.errorWithStack(this.node, `Failed to sync production function ${serverFunction.name}`, error, this.showDetailedLogs);
            throw error;
        }
    }
    /**
     * Creates a new production function in the local database
     * @param serverFunction - Production function data from server
     * @param deviceProfile - Device profile entity (optional)
     * @returns Promise that resolves when the production function is created
     */
    async createProductionFunction(serverFunction, deviceProfile) {
        const createTimer = logger_1.logger.startTimer(`Create function: ${serverFunction.name}`);
        try {
            logger_1.logger.info(this.node, `Creating new production function: ${serverFunction.name}`);
            // Create new production function entity
            const newFunction = new TabioProductionFunction_1.TabiotProductionFunction();
            newFunction.name = serverFunction.name;
            newFunction.type = serverFunction.type;
            newFunction.label = serverFunction.label;
            newFunction.label_multilingual = serverFunction.label_multilingual;
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
                    logger_1.logger.debug(this.node, `Assigned device profile ${deviceProfile.name} to production function ${serverFunction.name}`, true);
                }
            }
            // Set the created and modified timestamps
            newFunction.creation = (0, helper_1.adjustToUTC7)(new Date());
            newFunction.modified = (0, helper_1.adjustToUTC7)(new Date());
            if (this.showDetailedLogs) {
                logger_1.logger.debug(this.node, `Function entity prepared: ${JSON.stringify(newFunction, null, 2)}`, true);
            }
            // Save the production function to the database
            const saveTimer = logger_1.logger.startTimer(`DB save function: ${serverFunction.name}`);
            await this.productionFunctionRepo.save(newFunction);
            logger_1.logger.endTimer(this.node, saveTimer, this.showDetailedLogs);
            logger_1.logger.dbOperation(this.node, 'SAVE', 'TabiotProductionFunction', { name: serverFunction.name }, this.showDetailedLogs);
            this.syncStats.functionsCreated++;
            logger_1.logger.endTimer(this.node, createTimer, this.showDetailedLogs);
            logger_1.logger.info(this.node, `Successfully created production function: ${serverFunction.name}`);
        }
        catch (error) {
            logger_1.logger.endTimer(this.node, createTimer, this.showDetailedLogs);
            logger_1.logger.errorWithStack(this.node, `Failed to create production function ${serverFunction.name}`, error, this.showDetailedLogs);
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
    async updateProductionFunctionIfNeeded(localFunction, serverFunction, deviceProfile) {
        try {
            logger_1.logger.info(this.node, `Checking for updates to production function: ${serverFunction.name}`);
            // Check if any fields need updating
            let needsUpdate = false;
            if (localFunction.type !== serverFunction.type ||
                localFunction.label !== serverFunction.label ||
                this.isLabelMultilingualChanged(localFunction.label_multilingual, serverFunction.label_multilingual) ||
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
                logger_1.logger.info(this.node, `No updates needed for production function: ${serverFunction.name}`);
                return;
            }
            // Update production function fields
            localFunction.type = serverFunction.type;
            localFunction.label = serverFunction.label;
            localFunction.label_multilingual = serverFunction.label_multilingual;
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
                    logger_1.logger.debug(this.node, `Updated device profile ${deviceProfile.name} for production function ${serverFunction.name}`, true);
                }
            }
            // Update the modified timestamp
            localFunction.modified = (0, helper_1.adjustToUTC7)(new Date());
            // Save the updated production function to the database
            await this.productionFunctionRepo.save(localFunction);
            this.syncStats.functionsUpdated++;
            logger_1.logger.info(this.node, `Updated production function: ${serverFunction.name}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(this.node, `Failed to update production function ${serverFunction.name}: ${errorMessage}`);
            throw error;
        }
    }
}
exports.ProductionFunctionSyncHandler = ProductionFunctionSyncHandler;

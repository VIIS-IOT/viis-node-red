"use strict";
/**
 * @fileoverview Customer User Sync Handler for VIIS Sync Customer User module
 * Handles synchronization of customers and customer users between server and local database
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerUserSyncHandler = void 0;
const apiService_1 = require("../services/apiService");
const logger_1 = require("../utils/logger");
const customer_1 = require("../../../orm/entities/customer/customer");
const customer_user_1 = require("../../../orm/entities/customer/customer_user");
const customer_user_credentials_1 = require("../../../orm/entities/customer/customer_user_credentials");
const dynamicRole_1 = require("../../../orm/entities/dynamicRole/dynamicRole");
const helper_1 = require("../../../ultils/helper");
const syncStateService_1 = require("../services/syncStateService");
/**
 * Handler for synchronizing customers and customer users
 */
class CustomerUserSyncHandler {
    /**
     * Creates a new customer user sync handler
     * @param dbService - Database service for repository access
     * @param node - Node-RED node instance
     * @param deviceId - Device ID for authentication
     * @param showDetailedLogs - Whether to show detailed logs
     * @param maxRetries - Maximum number of retries for API calls
     */
    constructor(dbService, node, deviceId, showDetailedLogs = false, maxRetries = 3) {
        this.customerRepo = dbService.getCustomerRepository();
        this.customerUserRepo = dbService.getCustomerUserRepository();
        this.credentialsRepo = dbService.getCustomerUserCredentialsRepository();
        this.dynamicRoleRepo = dbService.getDynamicRoleRepository();
        this.node = node;
        this.apiService = new apiService_1.ApiService(deviceId, maxRetries, node, showDetailedLogs);
        this.syncStateService = new syncStateService_1.SyncStateService(node);
        this.showDetailedLogs = showDetailedLogs;
        // Initialize sync statistics
        this.resetSyncStats();
        logger_1.logger.info(node, 'CustomerUserSyncHandler initialized');
        logger_1.logger.debug(node, `Configuration: deviceId=${deviceId}, showDetailedLogs=${showDetailedLogs}, maxRetries=${maxRetries}`, showDetailedLogs);
    }
    /**
     * Resets sync statistics to zero
     */
    resetSyncStats() {
        this.syncStats = {
            customersCreated: 0,
            customersUpdated: 0,
            usersCreated: 0,
            usersUpdated: 0,
            credentialsCreated: 0,
            credentialsUpdated: 0,
            totalCustomers: 0,
            totalUsers: 0
        };
    }
    /**
     * Synchronizes all customers and their users
     * @returns Promise that resolves to the sync result
     */
    async syncAll() {
        const syncTimer = logger_1.logger.startTimer('Full sync operation');
        // Reset sync statistics
        this.resetSyncStats();
        // Record sync start
        this.syncStateService.startSync();
        try {
            logger_1.logger.info(this.node, 'Starting synchronization of all customers and users');
            // Fetch all customers and their users from server
            const apiTimer = logger_1.logger.startTimer('API fetch customers');
            const serverResponse = await this.apiService.getAllCustomers();
            logger_1.logger.endTimer(this.node, apiTimer, this.showDetailedLogs);
            const serverCustomers = serverResponse.result.data;
            this.syncStats.totalCustomers = serverCustomers.length;
            logger_1.logger.info(this.node, `Received ${serverCustomers.length} customers from server`);
            if (this.showDetailedLogs) {
                const totalUsers = serverCustomers.reduce((sum, customer) => { var _a; return sum + (((_a = customer.users) === null || _a === void 0 ? void 0 : _a.length) || 0); }, 0);
                logger_1.logger.debug(this.node, `Total users across all customers: ${totalUsers}`, true);
                logger_1.logger.debug(this.node, `Server response structure: ${JSON.stringify(serverResponse, null, 2)}`, true);
            }
            // Process each customer
            let processedCustomers = 0;
            for (const serverCustomer of serverCustomers) {
                const customerTimer = logger_1.logger.startTimer(`Sync customer: ${serverCustomer.name}`);
                try {
                    await this.syncCustomer(serverCustomer);
                    processedCustomers++;
                    logger_1.logger.endTimer(this.node, customerTimer, this.showDetailedLogs);
                    if (this.showDetailedLogs) {
                        logger_1.logger.debug(this.node, `Progress: ${processedCustomers}/${serverCustomers.length} customers processed`, true);
                    }
                }
                catch (error) {
                    logger_1.logger.endTimer(this.node, customerTimer, this.showDetailedLogs);
                    logger_1.logger.errorWithStack(this.node, `Failed to sync customer ${serverCustomer.name}`, error, this.showDetailedLogs);
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
     * Synchronizes a single customer and its users
     * @param serverCustomer - Customer data from server
     * @returns Promise that resolves when synchronization is complete
     */
    async syncCustomer(serverCustomer) {
        try {
            logger_1.logger.info(this.node, `Synchronizing customer: ${serverCustomer.name}`);
            logger_1.logger.debug(this.node, `Customer data: ${JSON.stringify(serverCustomer)}`, this.showDetailedLogs);
            // Check if customer already exists in local database
            const dbTimer = logger_1.logger.startTimer(`DB query for customer: ${serverCustomer.name}`);
            const localCustomer = await this.customerRepo.findOne({
                where: { name: serverCustomer.name }
            });
            logger_1.logger.endTimer(this.node, dbTimer, this.showDetailedLogs);
            logger_1.logger.dbOperation(this.node, 'FIND_ONE', 'TabiotCustomer', { name: serverCustomer.name }, this.showDetailedLogs);
            if (!localCustomer) {
                // Customer doesn't exist locally, create it
                logger_1.logger.info(this.node, `Customer ${serverCustomer.name} not found locally, creating new record`);
                await this.createCustomer(serverCustomer);
            }
            else {
                // Customer exists locally, update if needed
                logger_1.logger.info(this.node, `Customer ${serverCustomer.name} found locally, checking for updates`);
                await this.updateCustomerIfNeeded(localCustomer, serverCustomer);
            }
            // Sync users for this customer if they exist
            if (serverCustomer.users && serverCustomer.users.length > 0) {
                logger_1.logger.info(this.node, `Found ${serverCustomer.users.length} users for customer: ${serverCustomer.name}`);
                await this.syncUsersForCustomer(serverCustomer);
            }
            else {
                logger_1.logger.info(this.node, `No users found for customer: ${serverCustomer.name}`);
            }
        }
        catch (error) {
            logger_1.logger.errorWithStack(this.node, `Failed to sync customer ${serverCustomer.name}`, error, this.showDetailedLogs);
            throw error;
        }
    }
    /**
     * Creates a new customer in the local database
     * @param serverCustomer - Customer data from server
     * @returns Promise that resolves when the customer is created
     */
    async createCustomer(serverCustomer) {
        var _a, _b, _c, _d;
        const createTimer = logger_1.logger.startTimer(`Create customer: ${serverCustomer.name}`);
        try {
            logger_1.logger.info(this.node, `Creating new customer: ${serverCustomer.name}`);
            // Create new customer entity
            const newCustomer = new customer_1.TabiotCustomer();
            newCustomer.name = serverCustomer.name;
            newCustomer.id = serverCustomer.id;
            newCustomer.customerName = serverCustomer.customerName;
            newCustomer.createdTime = serverCustomer.createdTime ? new Date(serverCustomer.createdTime) : null;
            newCustomer.email = serverCustomer.email;
            newCustomer.phone = serverCustomer.phone;
            newCustomer.description = serverCustomer.description;
            newCustomer.address = serverCustomer.address;
            newCustomer.city = serverCustomer.city;
            newCustomer.country = serverCustomer.country;
            newCustomer.province = serverCustomer.province;
            newCustomer.zipPostalCode = serverCustomer.zipPostalCode;
            newCustomer.zipCode = serverCustomer.zipCode;
            newCustomer.logo = serverCustomer.logo;
            newCustomer.district = serverCustomer.district;
            newCustomer.ward = serverCustomer.ward;
            newCustomer.packageId = serverCustomer.packageId;
            newCustomer.type = serverCustomer.type;
            newCustomer.developerMode = (_a = serverCustomer.developerMode) !== null && _a !== void 0 ? _a : 0;
            newCustomer.developerWebhookId = serverCustomer.developerWebhookId;
            newCustomer.developerRuleId = serverCustomer.developerRuleId;
            newCustomer.test = (_b = serverCustomer.test) !== null && _b !== void 0 ? _b : 0;
            newCustomer.isReceiveConnectionNoti = (_c = serverCustomer.isReceiveConnectionNoti) !== null && _c !== void 0 ? _c : 0;
            newCustomer.isReceiveNotificationNoti = (_d = serverCustomer.isReceiveNotificationNoti) !== null && _d !== void 0 ? _d : 0;
            // Set the created and modified timestamps
            newCustomer.creation = (0, helper_1.adjustToUTC7)(new Date());
            newCustomer.modified = (0, helper_1.adjustToUTC7)(new Date());
            if (this.showDetailedLogs) {
                logger_1.logger.debug(this.node, `Customer entity prepared: ${JSON.stringify(newCustomer, null, 2)}`, true);
            }
            // Save the customer to the database
            const saveTimer = logger_1.logger.startTimer(`DB save customer: ${serverCustomer.name}`);
            await this.customerRepo.save(newCustomer);
            logger_1.logger.endTimer(this.node, saveTimer, this.showDetailedLogs);
            logger_1.logger.dbOperation(this.node, 'SAVE', 'TabiotCustomer', { name: serverCustomer.name, id: serverCustomer.id }, this.showDetailedLogs);
            this.syncStats.customersCreated++;
            logger_1.logger.endTimer(this.node, createTimer, this.showDetailedLogs);
            logger_1.logger.info(this.node, `Successfully created customer: ${serverCustomer.name} (ID: ${serverCustomer.id})`);
        }
        catch (error) {
            logger_1.logger.endTimer(this.node, createTimer, this.showDetailedLogs);
            logger_1.logger.errorWithStack(this.node, `Failed to create customer ${serverCustomer.name}`, error, this.showDetailedLogs);
            throw error;
        }
    }
    /**
     * Updates a local customer if the server version is newer
     * @param localCustomer - Local customer entity
     * @param serverCustomer - Customer data from server
     * @returns Promise that resolves when the customer is updated (if needed)
     */
    async updateCustomerIfNeeded(localCustomer, serverCustomer) {
        var _a, _b, _c, _d;
        try {
            logger_1.logger.info(this.node, `Checking for updates to customer: ${serverCustomer.name}`);
            // Check if any fields need updating
            let needsUpdate = false;
            if (localCustomer.id !== serverCustomer.id ||
                localCustomer.customerName !== serverCustomer.customerName ||
                localCustomer.email !== serverCustomer.email ||
                localCustomer.phone !== serverCustomer.phone ||
                localCustomer.description !== serverCustomer.description ||
                localCustomer.address !== serverCustomer.address ||
                localCustomer.city !== serverCustomer.city ||
                localCustomer.country !== serverCustomer.country ||
                localCustomer.province !== serverCustomer.province ||
                localCustomer.zipPostalCode !== serverCustomer.zipPostalCode ||
                localCustomer.zipCode !== serverCustomer.zipCode ||
                localCustomer.logo !== serverCustomer.logo ||
                localCustomer.district !== serverCustomer.district ||
                localCustomer.ward !== serverCustomer.ward ||
                localCustomer.packageId !== serverCustomer.packageId ||
                localCustomer.type !== serverCustomer.type ||
                localCustomer.developerMode !== serverCustomer.developerMode ||
                localCustomer.developerWebhookId !== serverCustomer.developerWebhookId ||
                localCustomer.developerRuleId !== serverCustomer.developerRuleId ||
                localCustomer.test !== serverCustomer.test ||
                localCustomer.isReceiveConnectionNoti !== serverCustomer.isReceiveConnectionNoti ||
                localCustomer.isReceiveNotificationNoti !== serverCustomer.isReceiveNotificationNoti) {
                needsUpdate = true;
            }
            if (!needsUpdate) {
                logger_1.logger.info(this.node, `No updates needed for customer: ${serverCustomer.name}`);
                return;
            }
            // Update customer fields
            localCustomer.id = serverCustomer.id;
            localCustomer.customerName = serverCustomer.customerName;
            localCustomer.email = serverCustomer.email;
            localCustomer.phone = serverCustomer.phone;
            localCustomer.description = serverCustomer.description;
            localCustomer.address = serverCustomer.address;
            localCustomer.city = serverCustomer.city;
            localCustomer.country = serverCustomer.country;
            localCustomer.province = serverCustomer.province;
            localCustomer.zipPostalCode = serverCustomer.zipPostalCode;
            localCustomer.zipCode = serverCustomer.zipCode;
            localCustomer.logo = serverCustomer.logo;
            localCustomer.district = serverCustomer.district;
            localCustomer.ward = serverCustomer.ward;
            localCustomer.packageId = serverCustomer.packageId;
            localCustomer.type = serverCustomer.type;
            localCustomer.developerMode = (_a = serverCustomer.developerMode) !== null && _a !== void 0 ? _a : 0;
            localCustomer.developerWebhookId = serverCustomer.developerWebhookId;
            localCustomer.developerRuleId = serverCustomer.developerRuleId;
            localCustomer.test = (_b = serverCustomer.test) !== null && _b !== void 0 ? _b : 0;
            localCustomer.isReceiveConnectionNoti = (_c = serverCustomer.isReceiveConnectionNoti) !== null && _c !== void 0 ? _c : 0;
            localCustomer.isReceiveNotificationNoti = (_d = serverCustomer.isReceiveNotificationNoti) !== null && _d !== void 0 ? _d : 0;
            // Update the modified timestamp
            localCustomer.modified = (0, helper_1.adjustToUTC7)(new Date());
            // Save the updated customer to the database
            await this.customerRepo.save(localCustomer);
            this.syncStats.customersUpdated++;
            logger_1.logger.info(this.node, `Updated customer: ${serverCustomer.name}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(this.node, `Failed to update customer ${serverCustomer.name}: ${errorMessage}`);
            throw error;
        }
    }
    /**
     * Synchronizes users for a specific customer
     * @param serverCustomer - Customer data from server
     * @returns Promise that resolves when all users are synchronized
     */
    async syncUsersForCustomer(serverCustomer) {
        try {
            if (!serverCustomer.users || serverCustomer.users.length === 0) {
                logger_1.logger.info(this.node, `No users to sync for customer: ${serverCustomer.name}`);
                return;
            }
            logger_1.logger.info(this.node, `Synchronizing ${serverCustomer.users.length} users for customer: ${serverCustomer.name}`);
            // STEP 1: Pre-sync all unique dynamic roles for this customer
            // This ensures all roles exist before we try to create users that reference them
            await this.preSyncDynamicRolesForCustomer(serverCustomer);
            // STEP 2: Process each user (roles should now exist)
            for (const serverUser of serverCustomer.users) {
                await this.syncUser(serverUser, serverCustomer.name);
            }
            // STEP 3: Check for deleted users
            await this.detectDeletedUsers(serverCustomer.users, serverCustomer.name);
            logger_1.logger.info(this.node, `Completed synchronizing users for customer: ${serverCustomer.name}`);
        }
        catch (error) {
            logger_1.logger.errorWithStack(this.node, `Failed to sync users for customer ${serverCustomer.name}`, error, this.showDetailedLogs);
            throw error;
        }
    }
    /**
     * Pre-synchronizes all unique dynamic roles for a customer
     * This ensures all roles exist before users are created/updated
     * @param serverCustomer - Customer data from server
     * @returns Promise that resolves when all dynamic roles are synchronized
     */
    async preSyncDynamicRolesForCustomer(serverCustomer) {
        try {
            if (!serverCustomer.users || serverCustomer.users.length === 0) {
                return;
            }
            // Collect all unique dynamic roles from users
            const uniqueRoles = new Map();
            for (const user of serverCustomer.users) {
                if (user.dynamicRole && user.dynamicRole.name) {
                    uniqueRoles.set(user.dynamicRole.name, user.dynamicRole);
                }
            }
            if (uniqueRoles.size === 0) {
                logger_1.logger.info(this.node, `No dynamic roles to pre-sync for customer: ${serverCustomer.name}`);
                return;
            }
            logger_1.logger.info(this.node, `Pre-syncing ${uniqueRoles.size} unique dynamic roles for customer: ${serverCustomer.name}`);
            // Sync each unique role
            for (const [roleName, role] of uniqueRoles) {
                try {
                    logger_1.logger.info(this.node, `Pre-syncing dynamic role: ${roleName}`);
                    await this.syncDynamicRole(role, serverCustomer.name);
                }
                catch (error) {
                    logger_1.logger.errorWithStack(this.node, `Failed to pre-sync dynamic role ${roleName}`, error, this.showDetailedLogs);
                    // Continue with other roles even if one fails
                }
            }
            logger_1.logger.info(this.node, `Completed pre-syncing dynamic roles for customer: ${serverCustomer.name}`);
        }
        catch (error) {
            logger_1.logger.errorWithStack(this.node, `Failed to pre-sync dynamic roles for customer ${serverCustomer.name}`, error, this.showDetailedLogs);
            throw error;
        }
    }
    /**
     * Synchronizes a single user
     * @param serverUser - User data from server
     * @param customerId - Parent customer ID
     * @returns Promise that resolves when the user is synchronized
     */
    async syncUser(serverUser, customerId) {
        try {
            logger_1.logger.info(this.node, `Synchronizing user: ${serverUser.name}`);
            logger_1.logger.debug(this.node, `User data: ${JSON.stringify(serverUser)}`, this.showDetailedLogs);
            // Validate dynamic role reference if present
            if (serverUser.iot_dynamic_role) {
                // Check if the referenced role exists (should exist from pre-sync)
                const existingRole = await this.dynamicRoleRepo.findOne({
                    where: { name: serverUser.iot_dynamic_role }
                });
                if (!existingRole) {
                    logger_1.logger.warn(this.node, `Dynamic role ${serverUser.iot_dynamic_role} not found, will clear role reference for user ${serverUser.name}`);
                    // Clear the role reference to avoid foreign key constraint error
                    serverUser.iot_dynamic_role = undefined;
                }
            }
            // Check if user already exists in local database
            const localUser = await this.customerUserRepo.findOne({
                where: { name: serverUser.name }
            });
            if (!localUser) {
                // User doesn't exist locally, create it
                await this.createUser(serverUser, customerId);
            }
            else {
                // User exists locally, update if needed
                await this.updateUserIfNeeded(localUser, serverUser);
            }
            // Sync credentials for this user if they exist
            if (serverUser.credentials) {
                await this.syncUserCredentials(serverUser.credentials, serverUser.name);
            }
        }
        catch (error) {
            logger_1.logger.errorWithStack(this.node, `Failed to sync user ${serverUser.name}`, error, this.showDetailedLogs);
            throw error;
        }
    }
    /**
     * Creates a new user in the local database
     * @param serverUser - User data from server
     * @param customerId - Parent customer ID
     * @returns Promise that resolves when the user is created
     */
    async createUser(serverUser, customerId) {
        var _a;
        try {
            logger_1.logger.info(this.node, `Creating new user: ${serverUser.name}`);
            // Create new user entity
            const newUser = new customer_user_1.IotCustomerUser();
            newUser.name = serverUser.name;
            newUser.user_id = serverUser.user_id;
            newUser.user_name = serverUser.user_name;
            newUser.created_time = serverUser.created_time ? new Date(serverUser.created_time) : undefined;
            newUser.user_avatar = serverUser.user_avatar;
            newUser.email = serverUser.email;
            newUser.full_name = serverUser.full_name;
            newUser.phone_number = serverUser.phone_number;
            newUser.address = serverUser.address;
            newUser.date_join = serverUser.date_join ? new Date(serverUser.date_join) : undefined;
            newUser.date_active = serverUser.date_active ? new Date(serverUser.date_active) : undefined;
            newUser.date_warranty = serverUser.date_warranty;
            newUser.first_name = serverUser.first_name;
            newUser.last_name = serverUser.last_name;
            newUser.district = serverUser.district;
            newUser.ward = serverUser.ward;
            newUser.province = serverUser.province;
            newUser.is_admin = (_a = serverUser.is_admin) !== null && _a !== void 0 ? _a : 0;
            newUser.description = serverUser.description;
            newUser.employee_id = serverUser.employee_id;
            newUser.user_type = serverUser.user_type; // Using 'any' to handle the enum
            newUser.role_label = serverUser.role_label;
            newUser.is_deactivated = serverUser.is_deactivated;
            newUser.customer_id = customerId;
            newUser.iot_dynamic_role = serverUser.iot_dynamic_role;
            // Set the created and modified timestamps
            newUser.creation = (0, helper_1.adjustToUTC7)(new Date());
            newUser.modified = (0, helper_1.adjustToUTC7)(new Date());
            // Save the user to the database
            await this.customerUserRepo.save(newUser);
            this.syncStats.usersCreated++;
            this.syncStats.totalUsers++;
            logger_1.logger.info(this.node, `Created user: ${serverUser.name}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(this.node, `Failed to create user ${serverUser.name}: ${errorMessage}`);
            throw error;
        }
    }
    /**
     * Updates a local user if the server version is newer
     * @param localUser - Local user entity
     * @param serverUser - User data from server
     * @returns Promise that resolves when the user is updated (if needed)
     */
    async updateUserIfNeeded(localUser, serverUser) {
        var _a;
        try {
            logger_1.logger.info(this.node, `Checking for updates to user: ${serverUser.name}`);
            // Check if any fields need updating
            let needsUpdate = false;
            if (localUser.user_id !== serverUser.user_id ||
                localUser.user_name !== serverUser.user_name ||
                localUser.user_avatar !== serverUser.user_avatar ||
                localUser.email !== serverUser.email ||
                localUser.full_name !== serverUser.full_name ||
                localUser.phone_number !== serverUser.phone_number ||
                localUser.address !== serverUser.address ||
                localUser.date_warranty !== serverUser.date_warranty ||
                localUser.first_name !== serverUser.first_name ||
                localUser.last_name !== serverUser.last_name ||
                localUser.district !== serverUser.district ||
                localUser.ward !== serverUser.ward ||
                localUser.province !== serverUser.province ||
                localUser.is_admin !== serverUser.is_admin ||
                localUser.description !== serverUser.description ||
                localUser.employee_id !== serverUser.employee_id ||
                localUser.user_type !== serverUser.user_type ||
                localUser.role_label !== serverUser.role_label ||
                localUser.is_deactivated !== serverUser.is_deactivated ||
                localUser.customer_id !== serverUser.customer_id ||
                localUser.iot_dynamic_role !== serverUser.iot_dynamic_role) {
                needsUpdate = true;
            }
            if (!needsUpdate) {
                logger_1.logger.info(this.node, `No updates needed for user: ${serverUser.name}`);
                return;
            }
            // Update user fields
            localUser.user_id = serverUser.user_id;
            localUser.user_name = serverUser.user_name;
            localUser.user_avatar = serverUser.user_avatar;
            localUser.email = serverUser.email;
            localUser.full_name = serverUser.full_name;
            localUser.phone_number = serverUser.phone_number;
            localUser.address = serverUser.address;
            localUser.date_join = serverUser.date_join ? new Date(serverUser.date_join) : localUser.date_join;
            localUser.date_active = serverUser.date_active ? new Date(serverUser.date_active) : localUser.date_active;
            localUser.date_warranty = serverUser.date_warranty;
            localUser.first_name = serverUser.first_name;
            localUser.last_name = serverUser.last_name;
            localUser.district = serverUser.district;
            localUser.ward = serverUser.ward;
            localUser.province = serverUser.province;
            localUser.is_admin = (_a = serverUser.is_admin) !== null && _a !== void 0 ? _a : localUser.is_admin;
            localUser.description = serverUser.description;
            localUser.employee_id = serverUser.employee_id;
            localUser.user_type = serverUser.user_type || localUser.user_type; // Using 'any' to handle the enum
            localUser.role_label = serverUser.role_label;
            localUser.is_deactivated = serverUser.is_deactivated;
            localUser.customer_id = serverUser.customer_id || localUser.customer_id;
            localUser.iot_dynamic_role = serverUser.iot_dynamic_role;
            // Update the modified timestamp
            localUser.modified = (0, helper_1.adjustToUTC7)(new Date());
            // Save the updated user to the database
            await this.customerUserRepo.save(localUser);
            this.syncStats.usersUpdated++;
            this.syncStats.totalUsers++;
            logger_1.logger.info(this.node, `Updated user: ${serverUser.name}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(this.node, `Failed to update user ${serverUser.name}: ${errorMessage}`);
            throw error;
        }
    }
    /**
     * Synchronizes credentials for a user
     * @param serverCredentials - Credentials data from server
     * @param userId - Parent user ID
     * @returns Promise that resolves when the credentials are synchronized
     */
    async syncUserCredentials(serverCredentials, userId) {
        try {
            logger_1.logger.info(this.node, `Synchronizing credentials for user: ${userId}`);
            logger_1.logger.debug(this.node, `Credentials data: ${JSON.stringify(serverCredentials)}`, this.showDetailedLogs);
            // Check if credentials already exist in local database
            const localCredentials = await this.credentialsRepo.findOne({
                where: { user_id: userId }
            });
            if (!localCredentials) {
                // Credentials don't exist locally, create them
                await this.createUserCredentials(serverCredentials, userId);
            }
            else {
                // Credentials exist locally, update if needed
                await this.updateUserCredentialsIfNeeded(localCredentials, serverCredentials);
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(this.node, `Failed to sync credentials for user ${userId}: ${errorMessage}`);
            throw error;
        }
    }
    /**
     * Creates new credentials for a user in the local database
     * @param serverCredentials - Credentials data from server
     * @param userId - Parent user ID
     * @returns Promise that resolves when the credentials are created
     */
    async createUserCredentials(serverCredentials, userId) {
        var _a;
        try {
            logger_1.logger.info(this.node, `Creating new credentials for user: ${userId}`);
            // Create new credentials entity
            const newCredentials = new customer_user_credentials_1.IotCustomerUserCredentials();
            newCredentials.name = `${userId}_credentials`; // Generate a unique name
            newCredentials.id = serverCredentials.id;
            newCredentials.user_id = userId;
            newCredentials.password = serverCredentials.password;
            newCredentials.enable = (_a = serverCredentials.is_active) !== null && _a !== void 0 ? _a : 1;
            newCredentials.reset_password_key = serverCredentials.password; // Store as reset key if needed
            newCredentials.total_retry_send_email = 0;
            // Set the created and modified timestamps
            newCredentials.creation = (0, helper_1.adjustToUTC7)(new Date());
            newCredentials.modified = (0, helper_1.adjustToUTC7)(new Date());
            // Save the credentials to the database
            await this.credentialsRepo.save(newCredentials);
            this.syncStats.credentialsCreated++;
            logger_1.logger.info(this.node, `Created credentials for user: ${userId}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(this.node, `Failed to create credentials for user ${userId}: ${errorMessage}`);
            throw error;
        }
    }
    /**
     * Updates local credentials if the server version is newer
     * @param localCredentials - Local credentials entity
     * @param serverCredentials - Credentials data from server
     * @returns Promise that resolves when the credentials are updated (if needed)
     */
    async updateUserCredentialsIfNeeded(localCredentials, serverCredentials) {
        var _a, _b;
        try {
            logger_1.logger.info(this.node, `Checking for updates to credentials for user: ${localCredentials.user_id}`);
            // Check if any fields need updating
            let needsUpdate = false;
            if (localCredentials.password !== serverCredentials.password ||
                localCredentials.enable !== ((_a = serverCredentials.is_active) !== null && _a !== void 0 ? _a : 1)) {
                needsUpdate = true;
            }
            if (!needsUpdate) {
                logger_1.logger.info(this.node, `No updates needed for credentials for user: ${localCredentials.user_id}`);
                return;
            }
            // Update credentials fields
            localCredentials.password = serverCredentials.password;
            localCredentials.enable = (_b = serverCredentials.is_active) !== null && _b !== void 0 ? _b : 1;
            localCredentials.last_reset_password_key_generated_on = serverCredentials.last_changed_time
                ? new Date(serverCredentials.last_changed_time)
                : localCredentials.last_reset_password_key_generated_on;
            // Update the modified timestamp
            localCredentials.modified = (0, helper_1.adjustToUTC7)(new Date());
            // Save the updated credentials to the database
            await this.credentialsRepo.save(localCredentials);
            this.syncStats.credentialsUpdated++;
            logger_1.logger.info(this.node, `Updated credentials for user: ${localCredentials.user_id}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(this.node, `Failed to update credentials for user ${localCredentials.user_id}: ${errorMessage}`);
            throw error;
        }
    }
    /**
     * Synchronizes a dynamic role
     * @param serverDynamicRole - Dynamic role data from server
     * @param customerId - Parent customer ID
     * @returns Promise that resolves when the dynamic role is synchronized
     */
    async syncDynamicRole(serverDynamicRole, customerId) {
        try {
            logger_1.logger.info(this.node, `Synchronizing dynamic role: ${serverDynamicRole.name}`);
            logger_1.logger.debug(this.node, `Dynamic role data: ${JSON.stringify(serverDynamicRole)}`, this.showDetailedLogs);
            // Check if dynamic role already exists in local database
            const localDynamicRole = await this.dynamicRoleRepo.findOne({
                where: { name: serverDynamicRole.name }
            });
            if (!localDynamicRole) {
                // Dynamic role doesn't exist locally, create it
                await this.createDynamicRole(serverDynamicRole, customerId);
            }
            else {
                // Dynamic role exists locally, update if needed
                await this.updateDynamicRoleIfNeeded(localDynamicRole, serverDynamicRole, customerId);
            }
        }
        catch (error) {
            logger_1.logger.errorWithStack(this.node, `Failed to sync dynamic role ${serverDynamicRole.name}`, error, this.showDetailedLogs);
            throw error;
        }
    }
    /**
     * Creates a new dynamic role in the local database
     * @param serverDynamicRole - Dynamic role data from server
     * @param customerId - Parent customer ID
     * @returns Promise that resolves when the dynamic role is created
     */
    async createDynamicRole(serverDynamicRole, customerId) {
        const createTimer = logger_1.logger.startTimer(`Create dynamic role: ${serverDynamicRole.name}`);
        try {
            logger_1.logger.info(this.node, `Creating new dynamic role: ${serverDynamicRole.name}`);
            // Create new dynamic role entity
            const newDynamicRole = new dynamicRole_1.IotDynamicRole();
            newDynamicRole.name = serverDynamicRole.name;
            newDynamicRole.label = serverDynamicRole.label;
            newDynamicRole.role = serverDynamicRole.role;
            newDynamicRole.sections = serverDynamicRole.sections;
            // Set the customer relationship if provided
            if (serverDynamicRole.iot_customer || customerId) {
                // Get the customer entity to establish the relationship
                const customer = await this.customerRepo.findOne({
                    where: { name: serverDynamicRole.iot_customer || customerId }
                });
                if (customer) {
                    newDynamicRole.iot_customer = customer;
                }
            }
            // Set the created and modified timestamps
            newDynamicRole.creation = (0, helper_1.adjustToUTC7)(new Date());
            newDynamicRole.modified = (0, helper_1.adjustToUTC7)(new Date());
            if (this.showDetailedLogs) {
                logger_1.logger.debug(this.node, `Dynamic role entity prepared: ${JSON.stringify(newDynamicRole, null, 2)}`, true);
            }
            // Save the dynamic role to the database
            const saveTimer = logger_1.logger.startTimer(`DB save dynamic role: ${serverDynamicRole.name}`);
            await this.dynamicRoleRepo.save(newDynamicRole);
            logger_1.logger.endTimer(this.node, saveTimer, this.showDetailedLogs);
            logger_1.logger.dbOperation(this.node, 'SAVE', 'IotDynamicRole', { name: serverDynamicRole.name }, this.showDetailedLogs);
            logger_1.logger.endTimer(this.node, createTimer, this.showDetailedLogs);
            logger_1.logger.info(this.node, `Successfully created dynamic role: ${serverDynamicRole.name}`);
        }
        catch (error) {
            logger_1.logger.endTimer(this.node, createTimer, this.showDetailedLogs);
            logger_1.logger.errorWithStack(this.node, `Failed to create dynamic role ${serverDynamicRole.name}`, error, this.showDetailedLogs);
            throw error;
        }
    }
    /**
     * Updates a local dynamic role if the server version is newer
     * @param localDynamicRole - Local dynamic role entity
     * @param serverDynamicRole - Dynamic role data from server
     * @param customerId - Parent customer ID
     * @returns Promise that resolves when the dynamic role is updated (if needed)
     */
    async updateDynamicRoleIfNeeded(localDynamicRole, serverDynamicRole, customerId) {
        try {
            logger_1.logger.info(this.node, `Checking for updates to dynamic role: ${serverDynamicRole.name}`);
            // Check if any fields need updating
            let needsUpdate = false;
            if (localDynamicRole.label !== serverDynamicRole.label ||
                localDynamicRole.role !== serverDynamicRole.role ||
                localDynamicRole.sections !== serverDynamicRole.sections) {
                needsUpdate = true;
            }
            // Check if customer relationship needs updating
            const expectedCustomerName = serverDynamicRole.iot_customer || customerId;
            if (expectedCustomerName && (!localDynamicRole.iot_customer || localDynamicRole.iot_customer.name !== expectedCustomerName)) {
                needsUpdate = true;
            }
            if (!needsUpdate) {
                logger_1.logger.info(this.node, `No updates needed for dynamic role: ${serverDynamicRole.name}`);
                return;
            }
            // Update dynamic role fields
            localDynamicRole.label = serverDynamicRole.label;
            localDynamicRole.role = serverDynamicRole.role;
            localDynamicRole.sections = serverDynamicRole.sections;
            // Update customer relationship if needed
            if (expectedCustomerName && (!localDynamicRole.iot_customer || localDynamicRole.iot_customer.name !== expectedCustomerName)) {
                const customer = await this.customerRepo.findOne({
                    where: { name: expectedCustomerName }
                });
                if (customer) {
                    localDynamicRole.iot_customer = customer;
                }
            }
            // Update the modified timestamp
            localDynamicRole.modified = (0, helper_1.adjustToUTC7)(new Date());
            // Save the updated dynamic role to the database
            await this.dynamicRoleRepo.save(localDynamicRole);
            logger_1.logger.info(this.node, `Updated dynamic role: ${serverDynamicRole.name}`);
        }
        catch (error) {
            logger_1.logger.errorWithStack(this.node, `Failed to update dynamic role ${serverDynamicRole.name}`, error, this.showDetailedLogs);
            throw error;
        }
    }
    /**
     * Detects users that exist locally but are not present in server data
     * Marks these users as deleted in the local database
     *
     * @param serverUsers - Array of users from the server
     * @param customerId - Customer ID
     * @returns Promise that resolves when deleted users are processed
     */
    async detectDeletedUsers(serverUsers, customerId) {
        try {
            logger_1.logger.info(this.node, `Checking for deleted users for customer ${customerId}`);
            // Get all active users for this customer from local DB
            const localUsers = await this.customerUserRepo.find({
                where: {
                    customer_id: customerId,
                    is_deactivated: 0
                }
            });
            if (!localUsers || localUsers.length === 0) {
                logger_1.logger.info(this.node, `No local users found for customer ${customerId}`);
                return;
            }
            // Create a map of server user names for fast lookup
            const serverUserMap = new Map();
            serverUsers.forEach(user => {
                serverUserMap.set(user.name, true);
            });
            // Find users that exist locally but not on server
            const deletedUsers = localUsers.filter(localUser => !serverUserMap.has(localUser.name));
            if (deletedUsers.length === 0) {
                logger_1.logger.info(this.node, `No deleted users found for customer ${customerId}`);
                return;
            }
            logger_1.logger.info(this.node, `Found ${deletedUsers.length} deleted users for customer ${customerId}`);
            // Mark each missing user as deleted (deactivated)
            for (const deletedUser of deletedUsers) {
                logger_1.logger.info(this.node, `Marking user ${deletedUser.name} as deleted`);
                deletedUser.is_deactivated = 1;
                deletedUser.modified = (0, helper_1.adjustToUTC7)(new Date());
                await this.customerUserRepo.save(deletedUser);
                this.syncStats.usersUpdated++;
                this.syncStats.totalUsers++;
            }
            logger_1.logger.info(this.node, `Processed ${deletedUsers.length} deleted users for customer ${customerId}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(this.node, `Failed to detect deleted users for customer ${customerId}: ${errorMessage}`);
            throw error;
        }
    }
}
exports.CustomerUserSyncHandler = CustomerUserSyncHandler;

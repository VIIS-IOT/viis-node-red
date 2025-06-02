/**
 * @fileoverview Customer User Sync Handler for VIIS Sync Customer User module
 * Handles synchronization of customers and customer users between server and local database
 */

import { Node } from 'node-red';
import { Repository } from 'typeorm';
import { DatabaseService } from '../services/databaseService';
import { ApiService } from '../services/apiService';
import { ServerCustomer, ServerCustomerUser, ServerCustomerUserCredentials } from '../interfaces/types';
import { logger } from '../utils/logger';
import { TabiotCustomer } from '../../../orm/entities/customer/customer';
import { IotCustomerUser } from '../../../orm/entities/customer/customer_user';
import { IotCustomerUserCredentials } from '../../../orm/entities/customer/customer_user_credentials';
import { adjustToUTC7 } from '../../../ultils/helper';
import { SyncStateService, SyncResult } from '../services/syncStateService';

/**
 * Handler for synchronizing customers and customer users
 */
export class CustomerUserSyncHandler {
    /** Repository for customers */
    private readonly customerRepo: Repository<TabiotCustomer>;
    /** Repository for customer users */
    private readonly customerUserRepo: Repository<IotCustomerUser>;
    /** Repository for customer user credentials */
    private readonly credentialsRepo: Repository<IotCustomerUserCredentials>;
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
        customersCreated: number;
        customersUpdated: number;
        usersCreated: number;
        usersUpdated: number;
        credentialsCreated: number;
        credentialsUpdated: number;
        totalCustomers: number;
        totalUsers: number;
    };

    /**
     * Creates a new customer user sync handler
     * @param dbService - Database service for repository access
     * @param node - Node-RED node instance
     * @param accessToken - Device access token for authentication
     * @param showDetailedLogs - Whether to show detailed logs
     */
    constructor(
        dbService: DatabaseService,
        node: Node,
        accessToken: string,
        showDetailedLogs: boolean = false
    ) {
        this.customerRepo = dbService.getCustomerRepository();
        this.customerUserRepo = dbService.getCustomerUserRepository();
        this.credentialsRepo = dbService.getCustomerUserCredentialsRepository();
        this.node = node;
        this.apiService = new ApiService(accessToken);
        this.syncStateService = new SyncStateService(node);
        this.showDetailedLogs = showDetailedLogs;

        // Initialize sync statistics
        this.resetSyncStats();

        logger.info(node, 'CustomerUserSyncHandler initialized');
    }

    /**
     * Resets sync statistics to zero
     */
    private resetSyncStats(): void {
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
    async syncAll(): Promise<SyncResult> {
        // Reset sync statistics
        this.resetSyncStats();

        // Record sync start
        this.syncStateService.startSync();

        try {
            logger.info(this.node, 'Starting synchronization of all customers and users');

            // Fetch all customers and their users from server
            const serverResponse = await this.apiService.getAllCustomers();
            const serverCustomers = serverResponse.result.data;

            this.syncStats.totalCustomers = serverCustomers.length;
            logger.info(this.node, `Received ${serverCustomers.length} customers from server`);

            // Process each customer
            for (const serverCustomer of serverCustomers) {
                await this.syncCustomer(serverCustomer);
            }

            // Create sync result
            const result: SyncResult = {
                success: true,
                ...this.syncStats,
                timestamp: Date.now()
            };

            // Record successful sync
            this.syncStateService.recordSyncResult(result);

            logger.info(
                this.node,
                `Synchronization completed successfully: Created ${this.syncStats.customersCreated} customers, ` +
                `updated ${this.syncStats.customersUpdated} customers, ` +
                `created ${this.syncStats.usersCreated} users, ` +
                `updated ${this.syncStats.usersUpdated} users, ` +
                `created ${this.syncStats.credentialsCreated} credentials, ` +
                `updated ${this.syncStats.credentialsUpdated} credentials`
            );

            return result;
        } catch (error) {
            // Create error sync result
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const result: SyncResult = {
                success: false,
                errorMessage,
                ...this.syncStats,
                timestamp: Date.now()
            };

            // Record failed sync
            this.syncStateService.recordSyncResult(result);

            logger.error(this.node, `Synchronization failed: ${errorMessage}`);
            throw error;
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
     * Synchronizes a single customer and its users
     * @param serverCustomer - Customer data from server
     * @returns Promise that resolves when synchronization is complete
     */
    private async syncCustomer(serverCustomer: ServerCustomer): Promise<void> {
        try {
            logger.info(this.node, `Synchronizing customer: ${serverCustomer.name}`);
            logger.debug(this.node, `Customer data: ${JSON.stringify(serverCustomer)}`, this.showDetailedLogs);

            // Check if customer already exists in local database
            const localCustomer = await this.customerRepo.findOne({
                where: { name: serverCustomer.name }
            });

            if (!localCustomer) {
                // Customer doesn't exist locally, create it
                await this.createCustomer(serverCustomer);
            } else {
                // Customer exists locally, update if needed
                await this.updateCustomerIfNeeded(localCustomer, serverCustomer);
            }

            // Sync users for this customer if they exist
            if (serverCustomer.users && serverCustomer.users.length > 0) {
                await this.syncUsersForCustomer(serverCustomer);
            } else {
                logger.info(this.node, `No users found for customer: ${serverCustomer.name}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to sync customer ${serverCustomer.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Creates a new customer in the local database
     * @param serverCustomer - Customer data from server
     * @returns Promise that resolves when the customer is created
     */
    private async createCustomer(serverCustomer: ServerCustomer): Promise<void> {
        try {
            logger.info(this.node, `Creating new customer: ${serverCustomer.name}`);

            // Create new customer entity
            const newCustomer = new TabiotCustomer();
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
            newCustomer.developerMode = serverCustomer.developerMode ?? 0;
            newCustomer.developerWebhookId = serverCustomer.developerWebhookId;
            newCustomer.developerRuleId = serverCustomer.developerRuleId;
            newCustomer.test = serverCustomer.test ?? 0;
            newCustomer.isReceiveConnectionNoti = serverCustomer.isReceiveConnectionNoti ?? 0;
            newCustomer.isReceiveNotificationNoti = serverCustomer.isReceiveNotificationNoti ?? 0;

            // Set the created and modified timestamps
            newCustomer.creation = adjustToUTC7(new Date());
            newCustomer.modified = adjustToUTC7(new Date());

            // Save the customer to the database
            await this.customerRepo.save(newCustomer);
            this.syncStats.customersCreated++;
            logger.info(this.node, `Created customer: ${serverCustomer.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to create customer ${serverCustomer.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Updates a local customer if the server version is newer
     * @param localCustomer - Local customer entity
     * @param serverCustomer - Customer data from server
     * @returns Promise that resolves when the customer is updated (if needed)
     */
    private async updateCustomerIfNeeded(localCustomer: TabiotCustomer, serverCustomer: ServerCustomer): Promise<void> {
        try {
            logger.info(this.node, `Checking for updates to customer: ${serverCustomer.name}`);

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
                logger.info(this.node, `No updates needed for customer: ${serverCustomer.name}`);
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
            localCustomer.developerMode = serverCustomer.developerMode ?? 0;
            localCustomer.developerWebhookId = serverCustomer.developerWebhookId;
            localCustomer.developerRuleId = serverCustomer.developerRuleId;
            localCustomer.test = serverCustomer.test ?? 0;
            localCustomer.isReceiveConnectionNoti = serverCustomer.isReceiveConnectionNoti ?? 0;
            localCustomer.isReceiveNotificationNoti = serverCustomer.isReceiveNotificationNoti ?? 0;

            // Update the modified timestamp
            localCustomer.modified = adjustToUTC7(new Date());

            // Save the updated customer to the database
            await this.customerRepo.save(localCustomer);
            this.syncStats.customersUpdated++;
            logger.info(this.node, `Updated customer: ${serverCustomer.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to update customer ${serverCustomer.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Synchronizes users for a specific customer
     * @param serverCustomer - Customer data from server
     * @returns Promise that resolves when all users are synchronized
     */
    private async syncUsersForCustomer(serverCustomer: ServerCustomer): Promise<void> {
        try {
            if (!serverCustomer.users || serverCustomer.users.length === 0) {
                logger.info(this.node, `No users to sync for customer: ${serverCustomer.name}`);
                return;
            }

            logger.info(this.node, `Synchronizing ${serverCustomer.users.length} users for customer: ${serverCustomer.name}`);

            // Process each user
            for (const serverUser of serverCustomer.users) {
                await this.syncUser(serverUser, serverCustomer.name);
            }

            // Check for deleted users
            await this.detectDeletedUsers(serverCustomer.users, serverCustomer.name);

            logger.info(this.node, `Completed synchronizing users for customer: ${serverCustomer.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to sync users for customer ${serverCustomer.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Synchronizes a single user
     * @param serverUser - User data from server
     * @param customerId - Parent customer ID
     * @returns Promise that resolves when the user is synchronized
     */
    private async syncUser(serverUser: ServerCustomerUser, customerId: string): Promise<void> {
        try {
            logger.info(this.node, `Synchronizing user: ${serverUser.name}`);
            logger.debug(this.node, `User data: ${JSON.stringify(serverUser)}`, this.showDetailedLogs);

            // Check if user already exists in local database
            const localUser = await this.customerUserRepo.findOne({
                where: { name: serverUser.name }
            });

            if (!localUser) {
                // User doesn't exist locally, create it
                await this.createUser(serverUser, customerId);
            } else {
                // User exists locally, update if needed
                await this.updateUserIfNeeded(localUser, serverUser);
            }

            // Sync credentials for this user if they exist
            if (serverUser.credentials) {
                await this.syncUserCredentials(serverUser.credentials, serverUser.name);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to sync user ${serverUser.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Creates a new user in the local database
     * @param serverUser - User data from server
     * @param customerId - Parent customer ID
     * @returns Promise that resolves when the user is created
     */
    private async createUser(serverUser: ServerCustomerUser, customerId: string): Promise<void> {
        try {
            logger.info(this.node, `Creating new user: ${serverUser.name}`);

            // Create new user entity
            const newUser = new IotCustomerUser();
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
            newUser.is_admin = serverUser.is_admin ?? 0;
            newUser.description = serverUser.description;
            newUser.employee_id = serverUser.employee_id;
            newUser.user_type = serverUser.user_type as any; // Using 'any' to handle the enum
            newUser.role_label = serverUser.role_label;
            newUser.is_deactivated = serverUser.is_deactivated;
            newUser.customer_id = customerId;
            newUser.iot_dynamic_role = serverUser.iot_dynamic_role;

            // Set the created and modified timestamps
            newUser.creation = adjustToUTC7(new Date());
            newUser.modified = adjustToUTC7(new Date());

            // Save the user to the database
            await this.customerUserRepo.save(newUser);
            this.syncStats.usersCreated++;
            this.syncStats.totalUsers++;
            logger.info(this.node, `Created user: ${serverUser.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to create user ${serverUser.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Updates a local user if the server version is newer
     * @param localUser - Local user entity
     * @param serverUser - User data from server
     * @returns Promise that resolves when the user is updated (if needed)
     */
    private async updateUserIfNeeded(localUser: IotCustomerUser, serverUser: ServerCustomerUser): Promise<void> {
        try {
            logger.info(this.node, `Checking for updates to user: ${serverUser.name}`);

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
                logger.info(this.node, `No updates needed for user: ${serverUser.name}`);
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
            localUser.is_admin = serverUser.is_admin ?? localUser.is_admin;
            localUser.description = serverUser.description;
            localUser.employee_id = serverUser.employee_id;
            localUser.user_type = serverUser.user_type as any || localUser.user_type; // Using 'any' to handle the enum
            localUser.role_label = serverUser.role_label;
            localUser.is_deactivated = serverUser.is_deactivated;
            localUser.customer_id = serverUser.customer_id || localUser.customer_id;
            localUser.iot_dynamic_role = serverUser.iot_dynamic_role;

            // Update the modified timestamp
            localUser.modified = adjustToUTC7(new Date());

            // Save the updated user to the database
            await this.customerUserRepo.save(localUser);
            this.syncStats.usersUpdated++;
            this.syncStats.totalUsers++;
            logger.info(this.node, `Updated user: ${serverUser.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to update user ${serverUser.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Synchronizes credentials for a user
     * @param serverCredentials - Credentials data from server
     * @param userId - Parent user ID
     * @returns Promise that resolves when the credentials are synchronized
     */
    private async syncUserCredentials(serverCredentials: ServerCustomerUserCredentials, userId: string): Promise<void> {
        try {
            logger.info(this.node, `Synchronizing credentials for user: ${userId}`);
            logger.debug(this.node, `Credentials data: ${JSON.stringify(serverCredentials)}`, this.showDetailedLogs);

            // Check if credentials already exist in local database
            const localCredentials = await this.credentialsRepo.findOne({
                where: { user_id: userId }
            });

            if (!localCredentials) {
                // Credentials don't exist locally, create them
                await this.createUserCredentials(serverCredentials, userId);
            } else {
                // Credentials exist locally, update if needed
                await this.updateUserCredentialsIfNeeded(localCredentials, serverCredentials);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to sync credentials for user ${userId}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Creates new credentials for a user in the local database
     * @param serverCredentials - Credentials data from server
     * @param userId - Parent user ID
     * @returns Promise that resolves when the credentials are created
     */
    private async createUserCredentials(serverCredentials: ServerCustomerUserCredentials, userId: string): Promise<void> {
        try {
            logger.info(this.node, `Creating new credentials for user: ${userId}`);

            // Create new credentials entity
            const newCredentials = new IotCustomerUserCredentials();
            newCredentials.name = `${userId}_credentials`; // Generate a unique name
            newCredentials.id = serverCredentials.id;
            newCredentials.user_id = userId;
            newCredentials.password = serverCredentials.password;
            newCredentials.enable = serverCredentials.is_active ?? 1;
            newCredentials.reset_password_key = serverCredentials.password; // Store as reset key if needed
            newCredentials.total_retry_send_email = 0;

            // Set the created and modified timestamps
            newCredentials.creation = adjustToUTC7(new Date());
            newCredentials.modified = adjustToUTC7(new Date());

            // Save the credentials to the database
            await this.credentialsRepo.save(newCredentials);
            this.syncStats.credentialsCreated++;
            logger.info(this.node, `Created credentials for user: ${userId}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to create credentials for user ${userId}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Updates local credentials if the server version is newer
     * @param localCredentials - Local credentials entity
     * @param serverCredentials - Credentials data from server
     * @returns Promise that resolves when the credentials are updated (if needed)
     */
    private async updateUserCredentialsIfNeeded(
        localCredentials: IotCustomerUserCredentials,
        serverCredentials: ServerCustomerUserCredentials
    ): Promise<void> {
        try {
            logger.info(this.node, `Checking for updates to credentials for user: ${localCredentials.user_id}`);

            // Check if any fields need updating
            let needsUpdate = false;

            if (localCredentials.password !== serverCredentials.password ||
                localCredentials.enable !== (serverCredentials.is_active ?? 1)) {
                needsUpdate = true;
            }

            if (!needsUpdate) {
                logger.info(this.node, `No updates needed for credentials for user: ${localCredentials.user_id}`);
                return;
            }

            // Update credentials fields
            localCredentials.password = serverCredentials.password;
            localCredentials.enable = serverCredentials.is_active ?? 1;
            localCredentials.last_reset_password_key_generated_on = serverCredentials.last_changed_time
                ? new Date(serverCredentials.last_changed_time)
                : localCredentials.last_reset_password_key_generated_on;

            // Update the modified timestamp
            localCredentials.modified = adjustToUTC7(new Date());

            // Save the updated credentials to the database
            await this.credentialsRepo.save(localCredentials);
            this.syncStats.credentialsUpdated++;
            logger.info(this.node, `Updated credentials for user: ${localCredentials.user_id}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to update credentials for user ${localCredentials.user_id}: ${errorMessage}`);
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
    private async detectDeletedUsers(serverUsers: ServerCustomerUser[], customerId: string): Promise<void> {
        try {
            logger.info(this.node, `Checking for deleted users for customer ${customerId}`);

            // Get all active users for this customer from local DB
            const localUsers = await this.customerUserRepo.find({
                where: {
                    customer_id: customerId,
                    is_deactivated: 0
                }
            });

            if (!localUsers || localUsers.length === 0) {
                logger.info(this.node, `No local users found for customer ${customerId}`);
                return;
            }

            // Create a map of server user names for fast lookup
            const serverUserMap = new Map<string, boolean>();
            serverUsers.forEach(user => {
                serverUserMap.set(user.name, true);
            });

            // Find users that exist locally but not on server
            const deletedUsers = localUsers.filter(localUser =>
                !serverUserMap.has(localUser.name)
            );

            if (deletedUsers.length === 0) {
                logger.info(this.node, `No deleted users found for customer ${customerId}`);
                return;
            }

            logger.info(this.node, `Found ${deletedUsers.length} deleted users for customer ${customerId}`);

            // Mark each missing user as deleted (deactivated)
            for (const deletedUser of deletedUsers) {
                logger.info(this.node, `Marking user ${deletedUser.name} as deleted`);

                deletedUser.is_deactivated = 1;
                deletedUser.modified = adjustToUTC7(new Date());

                await this.customerUserRepo.save(deletedUser);
                this.syncStats.usersUpdated++;
                this.syncStats.totalUsers++;
            }

            logger.info(this.node, `Processed ${deletedUsers.length} deleted users for customer ${customerId}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to detect deleted users for customer ${customerId}: ${errorMessage}`);
            throw error;
        }
    }
}

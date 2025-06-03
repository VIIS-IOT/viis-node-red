"use strict";
/**
 * @fileoverview Database Service for VIIS Sync Customer User module
 * Provides access to database repositories for customer and customer user entities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const customer_1 = require("../../../orm/entities/customer/customer");
const customer_user_1 = require("../../../orm/entities/customer/customer_user");
const customer_user_credentials_1 = require("../../../orm/entities/customer/customer_user_credentials");
const dynamicRole_1 = require("../../../orm/entities/dynamicRole/dynamicRole");
const dataSource_1 = require("../../../orm/dataSource");
const logger_1 = require("../utils/logger");
/**
 * Service for database operations related to customer users
 */
class DatabaseService {
    /**
     * Creates a new database service instance
     */
    constructor() {
        /** Flag indicating if database is initialized */
        this.initialized = false;
        this.dataSource = dataSource_1.AppDataSource;
    }
    /**
     * Initializes the database connection
     */
    async initialize() {
        if (!this.initialized) {
            try {
                logger_1.logger.info(null, 'Initializing database connection...');
                // Check if DataSource is already initialized
                if (!this.dataSource.isInitialized) {
                    logger_1.logger.info(null, 'DataSource not initialized, initializing now...');
                    await this.dataSource.initialize();
                }
                else {
                    logger_1.logger.info(null, 'DataSource already initialized');
                }
                this.initialized = true;
                logger_1.logger.info(null, 'Database initialized successfully');
            }
            catch (error) {
                logger_1.logger.error(null, `Failed to initialize database: ${error.message}`);
                throw error;
            }
        }
        else {
            logger_1.logger.info(null, 'Database already initialized, skipping.');
        }
    }
    /**
     * Checks if database is initialized
     * @returns True if database is initialized, false otherwise
     */
    isInitialized() {
        const status = this.initialized && this.dataSource.isInitialized;
        logger_1.logger.info(null, `Database initialized status: ${status}`);
        return status;
    }
    /**
     * Destroys the database connection
     */
    async destroy() {
        if (this.initialized) {
            try {
                logger_1.logger.info(null, 'Destroying database connection...');
                await this.dataSource.destroy();
                this.initialized = false;
                logger_1.logger.info(null, 'Database connection destroyed');
            }
            catch (error) {
                logger_1.logger.error(null, `Error while destroying database connection: ${error.message}`);
                throw error;
            }
        }
        else {
            logger_1.logger.info(null, 'Destroy called, but database is not initialized.');
        }
    }
    /**
     * Gets the repository for TabiotCustomer entities
     * @returns Repository for customer entities
     */
    getCustomerRepository() {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(customer_1.TabiotCustomer);
    }
    /**
     * Gets the repository for IotCustomerUser entities
     * @returns Repository for customer user entities
     */
    getCustomerUserRepository() {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(customer_user_1.IotCustomerUser);
    }
    /**
     * Gets the repository for IotCustomerUserCredentials entities
     * @returns Repository for customer user credentials entities
     */
    getCustomerUserCredentialsRepository() {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(customer_user_credentials_1.IotCustomerUserCredentials);
    }
    /**
     * Gets the repository for IotDynamicRole entities
     * @returns Repository for dynamic role entities
     */
    getDynamicRoleRepository() {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(dynamicRole_1.IotDynamicRole);
    }
    /**
     * Gets the underlying DataSource for advanced operations
     * @returns TypeORM DataSource
     * @throws Error if database is not initialized
     */
    getDataSource() {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger_1.logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        return this.dataSource;
    }
}
exports.DatabaseService = DatabaseService;

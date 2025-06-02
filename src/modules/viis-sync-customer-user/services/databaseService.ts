/**
 * @fileoverview Database Service for VIIS Sync Customer User module
 * Provides access to database repositories for customer and customer user entities
 */

import { DataSource, Repository } from 'typeorm';
import { TabiotCustomer } from '../../../orm/entities/customer/customer';
import { IotCustomerUser } from '../../../orm/entities/customer/customer_user';
import { IotCustomerUserCredentials } from '../../../orm/entities/customer/customer_user_credentials';
import { IotDynamicRole } from '../../../orm/entities/dynamicRole/dynamicRole';
import { AppDataSource } from '../../../orm/dataSource';
import { logger } from '../utils/logger';

/**
 * Service for database operations related to customer users
 */
export class DatabaseService {
    /** TypeORM data source */
    private readonly dataSource: DataSource;
    /** Flag indicating if database is initialized */
    private initialized = false;

    /**
     * Creates a new database service instance
     */
    constructor() {
        this.dataSource = AppDataSource;
    }

    /**
     * Initializes the database connection
     */
    async initialize(): Promise<void> {
        if (!this.initialized) {
            try {
                logger.info(null, 'Initializing database connection...');

                // Check if DataSource is already initialized
                if (!this.dataSource.isInitialized) {
                    logger.info(null, 'DataSource not initialized, initializing now...');
                    await this.dataSource.initialize();
                } else {
                    logger.info(null, 'DataSource already initialized');
                }

                this.initialized = true;
                logger.info(null, 'Database initialized successfully');
            } catch (error) {
                logger.error(null, `Failed to initialize database: ${(error as Error).message}`);
                throw error;
            }
        } else {
            logger.info(null, 'Database already initialized, skipping.');
        }
    }

    /**
     * Checks if database is initialized
     * @returns True if database is initialized, false otherwise
     */
    isInitialized(): boolean {
        const status = this.initialized && this.dataSource.isInitialized;
        logger.info(null, `Database initialized status: ${status}`);
        return status;
    }

    /**
     * Destroys the database connection
     */
    async destroy(): Promise<void> {
        if (this.initialized) {
            try {
                logger.info(null, 'Destroying database connection...');
                await this.dataSource.destroy();
                this.initialized = false;
                logger.info(null, 'Database connection destroyed');
            } catch (error) {
                logger.error(null, `Error while destroying database connection: ${(error as Error).message}`);
                throw error;
            }
        } else {
            logger.info(null, 'Destroy called, but database is not initialized.');
        }
    }

    /**
     * Gets the repository for TabiotCustomer entities
     * @returns Repository for customer entities
     */
    getCustomerRepository(): Repository<TabiotCustomer> {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(TabiotCustomer);
    }

    /**
     * Gets the repository for IotCustomerUser entities
     * @returns Repository for customer user entities
     */
    getCustomerUserRepository(): Repository<IotCustomerUser> {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(IotCustomerUser);
    }

    /**
     * Gets the repository for IotCustomerUserCredentials entities
     * @returns Repository for customer user credentials entities
     */
    getCustomerUserCredentialsRepository(): Repository<IotCustomerUserCredentials> {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(IotCustomerUserCredentials);
    }

    /**
     * Gets the repository for IotDynamicRole entities
     * @returns Repository for dynamic role entities
     */
    getDynamicRoleRepository(): Repository<IotDynamicRole> {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(IotDynamicRole);
    }

    /**
     * Gets the underlying DataSource for advanced operations
     * @returns TypeORM DataSource
     * @throws Error if database is not initialized
     */
    getDataSource(): DataSource {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        return this.dataSource;
    }
}

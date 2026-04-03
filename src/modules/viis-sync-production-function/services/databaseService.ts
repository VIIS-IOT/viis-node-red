/**
 * @fileoverview Database Service for VIIS Sync Production Function module
 * Provides access to database repositories for production function entities
 */

import { DataSource, Repository } from 'typeorm';
import { TabiotProductionFunction } from '../../../orm/entities/production-function/TabioProductionFunction';
import { TabiotDeviceProfile } from '../../../orm/entities/device-profile/TabiotDeviceProfile';
import { AppDataSource } from '../../../orm/dataSource';
import { logger } from '../utils/logger';

/**
 * Service for database operations related to production functions
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
     * Gets the repository for TabiotProductionFunction entities
     * @returns Repository for production function entities
     */
    getProductionFunctionRepository(): Repository<TabiotProductionFunction> {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(TabiotProductionFunction);
    }

    /**
     * Gets the repository for TabiotDeviceProfile entities
     * @returns Repository for device profile entities
     */
    getDeviceProfileRepository(): Repository<TabiotDeviceProfile> {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(TabiotDeviceProfile);
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

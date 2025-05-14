/**
 * @fileoverview Database service for VIIS Sync Schedule module
 * Handles database connections and repository access
 */

import { Node } from 'node-red';
import { DataSource, Repository } from 'typeorm';
import { AppDataSource } from '../../../orm/dataSource';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { TabiotSchedulePlan } from '../../../orm/entities/schedulePlan/TabiotSchedulePlan';
import { logger } from '../utils/logger';

/**
 * Service for managing database connections and repositories
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
     * @returns Promise that resolves when database is initialized
     */
    async initialize(): Promise<void> {
        if (!this.initialized) {
            try {
                logger.info(null, 'Initializing database connection...');
                await this.dataSource.initialize();
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
     * Closes the database connection
     * @returns Promise that resolves when database connection is closed
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
     * Gets the repository for schedule entities
     * @returns Repository for TabiotSchedule entities
     * @throws Error if database is not initialized
     */
    getScheduleRepository(): Repository<TabiotSchedule> {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        logger.info(null, 'Retrieving TabiotSchedule repository');
        return this.dataSource.getRepository(TabiotSchedule);
    }

    /**
     * Gets the repository for schedule plan entities
     * @returns Repository for TabiotSchedulePlan entities
     * @throws Error if database is not initialized
     */
    getSchedulePlanRepository(): Repository<TabiotSchedulePlan> {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        logger.info(null, 'Retrieving TabiotSchedulePlan repository');
        return this.dataSource.getRepository(TabiotSchedulePlan);
    }
}

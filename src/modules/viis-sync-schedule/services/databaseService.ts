/**
 * @fileoverview Database service for VIIS Sync Schedule module
 * Handles database connections and repository access
 * 
 * Note: This service doesn't initialize a new database connection,
 * but uses the existing AppDataSource which is initialized when Node-RED loads.
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
     * Verifies the database connection is active
     * @returns Promise that resolves when database connection is verified
     */
    async initialize(): Promise<void> {
        try {
            // Chủ động khởi tạo AppDataSource nếu chưa được initialize
            if (!this.dataSource.isInitialized) {
                logger.info(null, 'Initializing AppDataSource...');
                await this.dataSource.initialize();
                logger.info(null, 'AppDataSource initialized successfully');
            }
            
            this.initialized = true;
            logger.info(null, 'Database connection verified successfully');
        } catch (error) {
            logger.error(null, `Failed to initialize database connection: ${(error as Error).message}`);
            throw error;
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
     * Marks the service as no longer using the database connection
     * Note: Does not actually close the connection as it may be used by other services
     * @returns Promise that resolves immediately
     */
    async destroy(): Promise<void> {
        if (this.initialized) {
            // Simply mark as no longer initialized in this service
            // but don't actually destroy the connection as it might be used elsewhere
            this.initialized = false;
            logger.info(null, 'Database service marked as destroyed');
        } else {
            logger.info(null, 'Destroy called, but database service is not initialized.');
        }
        return Promise.resolve();
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

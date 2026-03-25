import { Node } from 'node-red';
import { DataSource, Repository } from 'typeorm';
import { logger } from '../utils/logger';
import { DataSourceManager } from '../../../orm/dataSource';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { TabiotSchedulePlan } from '../../../orm/entities/schedulePlan/TabiotSchedulePlan';

/**
 * DatabaseService for viis-crud-schedule module
 * Uses DataSourceManager for thread-safe singleton with reference counting
 */
export class DatabaseService {
    private dataSource: DataSource | null = null;
    private initialized = false;

    constructor() {
        // Don't initialize here - wait for initialize() call
    }

    /**
     * Initialize database connection using DataSourceManager
     * Thread-safe singleton with reference counting prevents race conditions
     */
    async initialize(): Promise<void> {
        if (!this.initialized) {
            try {
                logger.info(null, 'Initializing database connection...');
                // Use DataSourceManager.acquire() for thread-safe initialization
                this.dataSource = await DataSourceManager.acquire();
                this.initialized = true;
                logger.info(null, `Database initialized successfully (refCount: ${DataSourceManager.getRefCount()})`);
            } catch (error) {
                logger.error(null, `Failed to initialize database: ${(error as Error).message}`);
                throw error;
            }
        } else {
            logger.info(null, 'Database already initialized, skipping.');
        }
    }

    isInitialized(): boolean {
        const status = this.initialized && this.dataSource?.isInitialized;
        return status;
    }

    /**
     * Release database connection using DataSourceManager
     * Reference counting ensures connection stays alive while other nodes use it
     */
    async destroy(): Promise<void> {
        if (this.initialized && this.dataSource) {
            try {
                logger.info(null, 'Releasing database connection...');
                // Use DataSourceManager.release() for proper reference counting
                await DataSourceManager.release();
                this.initialized = false;
                this.dataSource = null;
                logger.info(null, `Database connection released (refCount: ${DataSourceManager.getRefCount()})`);
            } catch (error) {
                // Log but don't throw - prevent crash during cleanup
                logger.error(null, `Error while releasing database connection: ${(error as Error).message}`);
                this.initialized = false;
                this.dataSource = null;
            }
        } else {
            this.initialized = false;
            this.dataSource = null;
        }
    }

    getScheduleRepository(): Repository<TabiotSchedule> {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        return this.dataSource!.getRepository(TabiotSchedule);
    }

    getSchedulePlanRepository(): Repository<TabiotSchedulePlan> {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        return this.dataSource!.getRepository(TabiotSchedulePlan);
    }
}
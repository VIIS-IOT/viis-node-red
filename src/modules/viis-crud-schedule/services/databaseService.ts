import { Node } from 'node-red';
import { DataSource, Repository } from 'typeorm';
import { logger } from '../utils/logger';
import { AppDataSource } from '../../../orm/dataSource';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { TabiotSchedulePlan } from '../../../orm/entities/schedulePlan/TabiotSchedulePlan';

export class DatabaseService {
    private dataSource: DataSource;
    private initialized = false;

    constructor() {
        this.dataSource = AppDataSource;
    }

    async initialize(): Promise<void> {
        if (!this.initialized) {
            try {
                logger.info(null, 'Initializing database connection...');
                await this.dataSource.initialize();
                this.initialized = true;
                logger.info(null, 'Database initialized successfully');
            } catch (error) {
                logger.error(null, `Failed to initialize database: ${(error as Error).message}`);
                throw error; // Throw để báo lỗi rõ ràng
            }
        } else {
            logger.info(null, 'Database already initialized, skipping.');
        }
    }

    isInitialized(): boolean {
        const status = this.initialized && this.dataSource.isInitialized;
        logger.info(null, `Database initialized status: ${status}`);
        return status;
    }

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

    getScheduleRepository(): Repository<TabiotSchedule> {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        logger.info(null, 'Retrieving TabiotSchedule repository');
        return this.dataSource.getRepository(TabiotSchedule);
    }

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
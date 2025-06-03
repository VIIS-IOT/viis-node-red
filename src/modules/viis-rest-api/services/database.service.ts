/**
 * @fileoverview Database Service for VIIS REST API
 * Provides centralized access to TypeORM repositories and database operations
 */

import { DataSource, Repository } from 'typeorm';
import { Node } from 'node-red';
import { Service } from 'typedi';
import { AppDataSource } from '../../../orm/dataSource';
import { TabiotCustomer } from '../../../orm/entities/customer/customer';
import { IotCustomerUser } from '../../../orm/entities/customer/customer_user';
import { IotCustomerUserCredentials } from '../../../orm/entities/customer/customer_user_credentials';
import { IotDynamicRole } from '../../../orm/entities/dynamicRole/dynamicRole';
import { TabiotDevice } from '../../../orm/entities/device/TabiotDevice';
import { TabiotDeviceTelemetry } from '../../../orm/entities/device-telemetry/TabiotDeviceTelemetry';
import { TabiotDeviceTelemetryLatest } from '../../../orm/entities/device-telemetry/TabiotDeviceTelemetryLatest';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { TabiotSchedulePlan } from '../../../orm/entities/schedulePlan/TabiotSchedulePlan';
import { logger } from '../utils/logger';
import { IService, ApiError, ErrorType } from '../types/common.types';

/**
 * Database service for VIIS REST API
 * Provides centralized access to all TypeORM repositories
 */
@Service()
export class DatabaseService implements IService {
    /** TypeORM data source */
    private readonly dataSource: DataSource;
    /** Flag indicating if database is initialized */
    private initialized = false;
    /** Node-RED node instance for logging */
    private node: Node;

    /**
     * Creates a new database service instance
     * @param node - Node-RED node instance for logging
     */
    constructor(node: Node) {
        this.dataSource = AppDataSource;
        this.node = node;
    }

    /**
     * Initialize the database connection
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.debug(this.node, "Database service already initialized");
            return;
        }

        try {
            if (!this.dataSource.isInitialized) {
                await this.dataSource.initialize();
                logger.info(this.node, "TypeORM DataSource initialized");
            }

            this.initialized = true;
            logger.info(this.node, "Database service initialized successfully");
        } catch (error) {
            const errorMessage = `Failed to initialize database: ${(error as Error).message}`;
            logger.error(this.node, errorMessage);
            throw new ApiError(
                ErrorType.DATABASE_ERROR,
                errorMessage,
                500
            );
        }
    }

    /**
     * Cleanup database connections
     */
    async cleanup(): Promise<void> {
        try {
            if (this.dataSource.isInitialized) {
                await this.dataSource.destroy();
                logger.info(this.node, "Database connections closed");
            }
            this.initialized = false;
        } catch (error) {
            logger.error(this.node, `Error during database cleanup: ${(error as Error).message}`);
        }
    }

    /**
     * Check if database is initialized
     */
    isInitialized(): boolean {
        return this.initialized && this.dataSource.isInitialized;
    }

    /**
     * Ensure database is initialized before operations
     */
    private ensureInitialized(): void {
        if (!this.isInitialized()) {
            throw new ApiError(
                ErrorType.DATABASE_ERROR,
                "Database service not initialized",
                500
            );
        }
    }

    /**
     * Get customer repository
     */
    getCustomerRepository(): Repository<TabiotCustomer> {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotCustomer);
    }

    /**
     * Get customer user repository
     */
    getCustomerUserRepository(): Repository<IotCustomerUser> {
        this.ensureInitialized();
        return this.dataSource.getRepository(IotCustomerUser);
    }

    /**
     * Get customer user credential repository
     */
    getCustomerUserCredentialRepository(): Repository<IotCustomerUserCredentials> {
        this.ensureInitialized();
        return this.dataSource.getRepository(IotCustomerUserCredentials);
    }

    /**
     * Get IoT dynamic role repository
     */
    getIotDynamicRoleRepository(): Repository<IotDynamicRole> {
        this.ensureInitialized();
        return this.dataSource.getRepository(IotDynamicRole);
    }

    /**
     * Get device repository
     */
    getDeviceRepository(): Repository<TabiotDevice> {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotDevice);
    }

    /**
     * Get device telemetry repository
     */
    getDeviceTelemetryRepository(): Repository<TabiotDeviceTelemetry> {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotDeviceTelemetry);
    }

    /**
     * Get device telemetry latest repository
     */
    getDeviceTelemetryLatestRepository(): Repository<TabiotDeviceTelemetryLatest> {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotDeviceTelemetryLatest);
    }

    /**
     * Get schedule repository
     */
    getScheduleRepository(): Repository<TabiotSchedule> {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotSchedule);
    }

    /**
     * Get schedule plan repository
     */
    getSchedulePlanRepository(): Repository<TabiotSchedulePlan> {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotSchedulePlan);
    }

    /**
     * Execute raw SQL query
     */
    async query(sql: string, parameters?: any[]): Promise<any> {
        this.ensureInitialized();
        try {
            return await this.dataSource.query(sql, parameters);
        } catch (error) {
            logger.error(this.node, `Database query error: ${(error as Error).message}`);
            throw new ApiError(
                ErrorType.DATABASE_ERROR,
                `Database query failed: ${(error as Error).message}`,
                500
            );
        }
    }

    /**
     * Start a database transaction
     */
    async transaction<T>(runInTransaction: (manager: any) => Promise<T>): Promise<T> {
        this.ensureInitialized();
        try {
            return await this.dataSource.transaction(runInTransaction);
        } catch (error) {
            logger.error(this.node, `Database transaction error: ${(error as Error).message}`);
            throw new ApiError(
                ErrorType.DATABASE_ERROR,
                `Database transaction failed: ${(error as Error).message}`,
                500
            );
        }
    }

    /**
     * Get data source for advanced operations
     */
    getDataSource(): DataSource {
        this.ensureInitialized();
        return this.dataSource;
    }
}

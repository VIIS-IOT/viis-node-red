/**
 * @fileoverview Database Service for VIIS REST API
 * Provides access to TypeORM repositories for all entities
 */

import { Node } from 'node-red';
import { DataSource, Repository } from 'typeorm';
import { AppDataSource } from '../../../orm/dataSource';

// Import all entities
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

/**
 * Database service for VIIS REST API
 * Provides centralized access to all TypeORM repositories
 */
export class DatabaseService {
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
            throw new Error(errorMessage);
        }
    }

    /**
     * Check if database is initialized
     */
    isInitialized(): boolean {
        return this.initialized && this.dataSource.isInitialized;
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
     * Get customer user credentials repository
     */
    getCustomerUserCredentialsRepository(): Repository<IotCustomerUserCredentials> {
        this.ensureInitialized();
        return this.dataSource.getRepository(IotCustomerUserCredentials);
    }

    /**
     * Get dynamic role repository
     */
    getDynamicRoleRepository(): Repository<IotDynamicRole> {
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
            throw error;
        }
    }

    /**
     * Start a database transaction
     */
    async transaction<T>(runInTransaction: (manager: any) => Promise<T>): Promise<T> {
        this.ensureInitialized();
        return await this.dataSource.transaction(runInTransaction);
    }

    /**
     * Cleanup database connections
     */
    async cleanup(): Promise<void> {
        if (this.dataSource.isInitialized) {
            // Note: We don't destroy the DataSource as it might be used by other nodes
            // await this.dataSource.destroy();
            logger.info(this.node, "Database service cleanup completed");
        }
        this.initialized = false;
    }

    /**
     * Ensure database is initialized before operations
     */
    private ensureInitialized(): void {
        if (!this.initialized || !this.dataSource.isInitialized) {
            throw new Error("Database service not initialized. Call initialize() first.");
        }
    }
}

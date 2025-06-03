"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const dataSource_1 = require("../../../orm/dataSource");
const TabiotDeviceTelemetry_1 = require("../../../orm/entities/device-telemetry/TabiotDeviceTelemetry");
const TabiotDeviceTelemetryLatest_1 = require("../../../orm/entities/device-telemetry/TabiotDeviceTelemetryLatest");
/**
 * Service for managing database connections and repositories for telemetry data
 */
class DatabaseService {
    /**
     * Creates a new database service instance
     * @param logger - Logger instance for logging
     */
    constructor(logger) {
        /** Flag indicating if database is initialized */
        this.initialized = false;
        this.dataSource = dataSource_1.AppDataSource;
        this.logger = logger;
    }
    /**
     * Initializes the database connection
     * @returns Promise that resolves when database connection is verified
     */
    async initialize() {
        if (!this.initialized) {
            try {
                this.logger.log('Initializing database connection...');
                // Check if DataSource is already initialized
                if (!this.dataSource.isInitialized) {
                    this.logger.log('DataSource not initialized, initializing now...');
                    await this.dataSource.initialize();
                }
                else {
                    this.logger.log('DataSource already initialized');
                }
                this.initialized = true;
                this.logger.log('Database initialized successfully');
            }
            catch (error) {
                this.logger.errorWithStack('Failed to initialize database', error);
                throw error;
            }
        }
        else {
            this.logger.debug('Database already initialized, skipping.');
        }
    }
    /**
     * Checks if the database is initialized
     * @returns True if database is initialized and ready
     */
    isInitialized() {
        const status = this.initialized && this.dataSource.isInitialized;
        this.logger.debug(`Database initialized status: ${status}`);
        return status;
    }
    /**
     * Destroys the database connection
     * @returns Promise that resolves when connection is destroyed
     */
    async destroy() {
        if (this.initialized) {
            try {
                this.logger.log('Destroying database connection...');
                await this.dataSource.destroy();
                this.initialized = false;
                this.logger.log('Database connection destroyed');
            }
            catch (error) {
                this.logger.errorWithStack('Error while destroying database connection', error);
                throw error;
            }
        }
        else {
            this.logger.debug('Destroy called, but database is not initialized.');
        }
    }
    /**
     * Gets the repository for device telemetry entities
     * @returns Repository for TabiotDeviceTelemetry entities
     * @throws Error if database is not initialized
     */
    getTelemetryRepository() {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
        this.logger.debug('Retrieving TabiotDeviceTelemetry repository');
        return this.dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
    }
    /**
     * Gets the repository for device telemetry latest entities
     * @returns Repository for TabiotDeviceTelemetryLatest entities
     * @throws Error if database is not initialized
     */
    getTelemetryLatestRepository() {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
        this.logger.debug('Retrieving TabiotDeviceTelemetryLatest repository');
        return this.dataSource.getRepository(TabiotDeviceTelemetryLatest_1.TabiotDeviceTelemetryLatest);
    }
    /**
     * Gets the underlying DataSource for advanced operations
     * @returns TypeORM DataSource
     * @throws Error if database is not initialized
     */
    getDataSource() {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
        return this.dataSource;
    }
    /**
     * Checks if the database connection is healthy
     * @returns Promise that resolves to true if connection is healthy
     */
    async isHealthy() {
        try {
            if (!this.isInitialized()) {
                return false;
            }
            // Try a simple query to check connection health
            await this.dataSource.query('SELECT 1');
            return true;
        }
        catch (error) {
            this.logger.errorWithStack('Database health check failed', error);
            return false;
        }
    }
    /**
     * Gets connection information for monitoring
     * @returns Object with connection details
     */
    getConnectionInfo() {
        return {
            isInitialized: this.initialized,
            isConnected: this.dataSource.isInitialized,
            driver: this.dataSource.options.type || 'unknown'
        };
    }
}
exports.DatabaseService = DatabaseService;

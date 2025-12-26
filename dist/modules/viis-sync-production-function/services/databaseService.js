"use strict";
/**
 * @fileoverview Database Service for VIIS Sync Production Function module
 * Provides access to database repositories for production function entities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const TabioProductionFunction_1 = require("../../../orm/entities/production-function/TabioProductionFunction");
const TabiotDeviceProfile_1 = require("../../../orm/entities/device-profile/TabiotDeviceProfile");
const dataSource_1 = require("../../../orm/dataSource");
const logger_1 = require("../utils/logger");
/**
 * Service for database operations related to production functions
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
     * Gets the repository for TabiotProductionFunction entities
     * @returns Repository for production function entities
     */
    getProductionFunctionRepository() {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(TabioProductionFunction_1.TabiotProductionFunction);
    }
    /**
     * Gets the repository for TabiotDeviceProfile entities
     * @returns Repository for device profile entities
     */
    getDeviceProfileRepository() {
        if (!this.isInitialized()) {
            throw new Error('Database not initialized');
        }
        return this.dataSource.getRepository(TabiotDeviceProfile_1.TabiotDeviceProfile);
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

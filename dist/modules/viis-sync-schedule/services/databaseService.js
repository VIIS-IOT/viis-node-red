"use strict";
/**
 * @fileoverview Database service for VIIS Sync Schedule module
 * Handles database connections and repository access
 *
 * Note: This service doesn't initialize a new database connection,
 * but uses the existing AppDataSource which is initialized when Node-RED loads.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const dataSource_1 = require("../../../orm/dataSource");
const TabiotSchedule_1 = require("../../../orm/entities/schedule/TabiotSchedule");
const TabiotSchedulePlan_1 = require("../../../orm/entities/schedulePlan/TabiotSchedulePlan");
const logger_1 = require("../utils/logger");
/**
 * Service for managing database connections and repositories
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
     * Verifies the database connection is active
     * @returns Promise that resolves when database connection is verified
     */
    async initialize() {
        try {
            // Chủ động khởi tạo AppDataSource nếu chưa được initialize
            if (!this.dataSource.isInitialized) {
                logger_1.logger.info(null, 'Initializing AppDataSource...');
                await this.dataSource.initialize();
                logger_1.logger.info(null, 'AppDataSource initialized successfully');
            }
            this.initialized = true;
            logger_1.logger.info(null, 'Database connection verified successfully');
        }
        catch (error) {
            logger_1.logger.error(null, `Failed to initialize database connection: ${error.message}`);
            throw error;
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
     * Marks the service as no longer using the database connection
     * Note: Does not actually close the connection as it may be used by other services
     * @returns Promise that resolves immediately
     */
    async destroy() {
        if (this.initialized) {
            // Simply mark as no longer initialized in this service
            // but don't actually destroy the connection as it might be used elsewhere
            this.initialized = false;
            logger_1.logger.info(null, 'Database service marked as destroyed');
        }
        else {
            logger_1.logger.info(null, 'Destroy called, but database service is not initialized.');
        }
        return Promise.resolve();
    }
    /**
     * Gets the repository for schedule entities
     * @returns Repository for TabiotSchedule entities
     * @throws Error if database is not initialized
     */
    getScheduleRepository() {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger_1.logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        logger_1.logger.info(null, 'Retrieving TabiotSchedule repository');
        return this.dataSource.getRepository(TabiotSchedule_1.TabiotSchedule);
    }
    /**
     * Gets the repository for schedule plan entities
     * @returns Repository for TabiotSchedulePlan entities
     * @throws Error if database is not initialized
     */
    getSchedulePlanRepository() {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger_1.logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        logger_1.logger.info(null, 'Retrieving TabiotSchedulePlan repository');
        return this.dataSource.getRepository(TabiotSchedulePlan_1.TabiotSchedulePlan);
    }
}
exports.DatabaseService = DatabaseService;

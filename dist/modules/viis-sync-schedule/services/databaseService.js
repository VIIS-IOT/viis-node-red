"use strict";
/**
 * @fileoverview Database service for VIIS Sync Schedule module
 * Handles database connections and repository access
 *
 * Note: This service doesn't initialize a new database connection,
 * but uses the existing AppDataSource which is initialized when Node-RED loads.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Simply check if the DataSource is initialized
                if (!this.dataSource.isInitialized) {
                    logger_1.logger.warn(null, 'DataSource is not initialized, waiting for initialization...');
                    // Wait for a short period to see if it gets initialized by another process
                    yield new Promise(resolve => setTimeout(resolve, 2000));
                    // Check again after waiting
                    if (!this.dataSource.isInitialized) {
                        logger_1.logger.error(null, 'DataSource still not initialized after waiting');
                        throw new Error('Database connection not available');
                    }
                }
                // If we get here, the connection is active
                this.initialized = true;
                logger_1.logger.info(null, 'Database connection verified successfully');
            }
            catch (error) {
                logger_1.logger.error(null, `Failed to verify database connection: ${error.message}`);
                throw error;
            }
        });
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
    destroy() {
        return __awaiter(this, void 0, void 0, function* () {
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
        });
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

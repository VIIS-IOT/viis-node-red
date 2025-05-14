"use strict";
/**
 * @fileoverview Database service for VIIS Sync Schedule module
 * Handles database connections and repository access
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
     * Initializes the database connection
     * @returns Promise that resolves when database is initialized
     */
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.initialized) {
                try {
                    logger_1.logger.info(null, 'Initializing database connection...');
                    yield this.dataSource.initialize();
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
     * Closes the database connection
     * @returns Promise that resolves when database connection is closed
     */
    destroy() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.initialized) {
                try {
                    logger_1.logger.info(null, 'Destroying database connection...');
                    yield this.dataSource.destroy();
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

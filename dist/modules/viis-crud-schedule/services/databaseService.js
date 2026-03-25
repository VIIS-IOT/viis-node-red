"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const logger_1 = require("../utils/logger");
const dataSource_1 = require("../../../orm/dataSource");
const TabiotSchedule_1 = require("../../../orm/entities/schedule/TabiotSchedule");
const TabiotSchedulePlan_1 = require("../../../orm/entities/schedulePlan/TabiotSchedulePlan");
/**
 * DatabaseService for viis-crud-schedule module
 * Uses DataSourceManager for thread-safe singleton with reference counting
 */
class DatabaseService {
    constructor() {
        this.dataSource = null;
        this.initialized = false;
        // Don't initialize here - wait for initialize() call
    }
    /**
     * Initialize database connection using DataSourceManager
     * Thread-safe singleton with reference counting prevents race conditions
     */
    async initialize() {
        if (!this.initialized) {
            try {
                logger_1.logger.info(null, 'Initializing database connection...');
                // Use DataSourceManager.acquire() for thread-safe initialization
                this.dataSource = await dataSource_1.DataSourceManager.acquire();
                this.initialized = true;
                logger_1.logger.info(null, `Database initialized successfully (refCount: ${dataSource_1.DataSourceManager.getRefCount()})`);
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
    isInitialized() {
        var _a;
        const status = this.initialized && ((_a = this.dataSource) === null || _a === void 0 ? void 0 : _a.isInitialized);
        return status;
    }
    /**
     * Release database connection using DataSourceManager
     * Reference counting ensures connection stays alive while other nodes use it
     */
    async destroy() {
        if (this.initialized && this.dataSource) {
            try {
                logger_1.logger.info(null, 'Releasing database connection...');
                // Use DataSourceManager.release() for proper reference counting
                await dataSource_1.DataSourceManager.release();
                this.initialized = false;
                this.dataSource = null;
                logger_1.logger.info(null, `Database connection released (refCount: ${dataSource_1.DataSourceManager.getRefCount()})`);
            }
            catch (error) {
                // Log but don't throw - prevent crash during cleanup
                logger_1.logger.error(null, `Error while releasing database connection: ${error.message}`);
                this.initialized = false;
                this.dataSource = null;
            }
        }
        else {
            this.initialized = false;
            this.dataSource = null;
        }
    }
    getScheduleRepository() {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger_1.logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        return this.dataSource.getRepository(TabiotSchedule_1.TabiotSchedule);
    }
    getSchedulePlanRepository() {
        if (!this.isInitialized()) {
            const errorMessage = 'Database not initialized';
            logger_1.logger.error(null, errorMessage);
            throw new Error(errorMessage);
        }
        return this.dataSource.getRepository(TabiotSchedulePlan_1.TabiotSchedulePlan);
    }
}
exports.DatabaseService = DatabaseService;

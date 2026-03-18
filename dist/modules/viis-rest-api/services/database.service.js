"use strict";
/**
 * @fileoverview Database Service for VIIS REST API
 * Provides centralized access to TypeORM repositories and database operations
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const typedi_1 = require("typedi");
const dataSource_1 = require("../../../orm/dataSource");
const customer_1 = require("../../../orm/entities/customer/customer");
const customer_user_1 = require("../../../orm/entities/customer/customer_user");
const customer_user_credentials_1 = require("../../../orm/entities/customer/customer_user_credentials");
const dynamicRole_1 = require("../../../orm/entities/dynamicRole/dynamicRole");
const TabiotDevice_1 = require("../../../orm/entities/device/TabiotDevice");
const TabiotDeviceTelemetry_1 = require("../../../orm/entities/device-telemetry/TabiotDeviceTelemetry");
const TabiotDeviceTelemetryLatest_1 = require("../../../orm/entities/device-telemetry/TabiotDeviceTelemetryLatest");
const TabiotThingsboardTelemetryQueue_1 = require("../../../orm/entities/device-telemetry/TabiotThingsboardTelemetryQueue");
const TabiotSchedule_1 = require("../../../orm/entities/schedule/TabiotSchedule");
const TabiotSchedulePlan_1 = require("../../../orm/entities/schedulePlan/TabiotSchedulePlan");
const TabiotNotification_1 = require("../../../orm/entities/notification/TabiotNotification");
const logger_1 = require("../utils/logger");
const common_types_1 = require("../types/common.types");
/**
 * Database service for VIIS REST API
 * Provides centralized access to all TypeORM repositories
 */
let DatabaseService = class DatabaseService {
    /**
     * Creates a new database service instance
     * @param node - Node-RED node instance for logging
     */
    constructor(node) {
        /** Flag indicating if database is initialized */
        this.initialized = false;
        this.node = node;
    }
    /**
     * Initialize the database connection
     */
    async initialize() {
        if (this.initialized) {
            logger_1.logger.debug(this.node, "Database service already initialized");
            return;
        }
        try {
            // Use DataSourceManager with node context to get config from global context
            this.dataSource = await dataSource_1.DataSourceManager.acquire(this.node.context());
            logger_1.logger.info(this.node, "TypeORM DataSource initialized");
            this.initialized = true;
            logger_1.logger.info(this.node, "Database service initialized successfully");
        }
        catch (error) {
            const errorMessage = `Failed to initialize database: ${error.message}`;
            logger_1.logger.error(this.node, errorMessage);
            throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, errorMessage, 500);
        }
    }
    /**
     * Cleanup database connections
     */
    async cleanup() {
        try {
            if (this.dataSource.isInitialized) {
                await this.dataSource.destroy();
                logger_1.logger.info(this.node, "Database connections closed");
            }
            this.initialized = false;
        }
        catch (error) {
            logger_1.logger.error(this.node, `Error during database cleanup: ${error.message}`);
        }
    }
    /**
     * Check if database is initialized
     */
    isInitialized() {
        return this.initialized && this.dataSource.isInitialized;
    }
    /**
     * Ensure database is initialized before operations
     */
    ensureInitialized() {
        if (!this.isInitialized()) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, "Database service not initialized", 500);
        }
    }
    /**
     * Get customer repository
     */
    getCustomerRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(customer_1.TabiotCustomer);
    }
    /**
     * Get customer user repository
     */
    getCustomerUserRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(customer_user_1.IotCustomerUser);
    }
    /**
     * Get customer user credential repository
     */
    getCustomerUserCredentialRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(customer_user_credentials_1.IotCustomerUserCredentials);
    }
    /**
     * Get IoT dynamic role repository
     */
    getIotDynamicRoleRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(dynamicRole_1.IotDynamicRole);
    }
    /**
     * Get device repository
     */
    getDeviceRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotDevice_1.TabiotDevice);
    }
    /**
     * Get device telemetry repository
     */
    getDeviceTelemetryRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
    }
    /**
     * Get device telemetry latest repository
     */
    getDeviceTelemetryLatestRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotDeviceTelemetryLatest_1.TabiotDeviceTelemetryLatest);
    }
    /**
     * Get schedule repository
     */
    getScheduleRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotSchedule_1.TabiotSchedule);
    }
    /**
     * Get schedule plan repository
     */
    getSchedulePlanRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotSchedulePlan_1.TabiotSchedulePlan);
    }
    /**
     * Get schedule log repository
     */
    getScheduleLogRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotSchedule_1.TabiotScheduleLog);
    }
    /**
     * Get notification repository
     */
    getNotificationRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotNotification_1.TabiotNotification);
    }
    /**
     * Get ThingsBoard telemetry queue repository
     */
    getThingsboardTelemetryQueueRepository() {
        this.ensureInitialized();
        return this.dataSource.getRepository(TabiotThingsboardTelemetryQueue_1.TabiotThingsboardTelemetryQueue);
    }
    /**
     * Execute raw SQL query
     */
    async query(sql, parameters) {
        this.ensureInitialized();
        try {
            return await this.dataSource.query(sql, parameters);
        }
        catch (error) {
            logger_1.logger.error(this.node, `Database query error: ${error.message}`);
            throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Database query failed: ${error.message}`, 500);
        }
    }
    /**
     * Start a database transaction
     */
    async transaction(runInTransaction) {
        this.ensureInitialized();
        try {
            return await this.dataSource.transaction(runInTransaction);
        }
        catch (error) {
            logger_1.logger.error(this.node, `Database transaction error: ${error.message}`);
            throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, `Database transaction failed: ${error.message}`, 500);
        }
    }
    /**
     * Get data source for advanced operations
     */
    getDataSource() {
        this.ensureInitialized();
        return this.dataSource;
    }
};
exports.DatabaseService = DatabaseService;
exports.DatabaseService = DatabaseService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object])
], DatabaseService);

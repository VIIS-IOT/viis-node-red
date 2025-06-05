"use strict";
/**
 * @fileoverview Base service class with common functionality for all services
 * Provides standardized patterns for service implementation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseService = void 0;
const logger_1 = require("../utils/logger");
const common_types_1 = require("../types/common.types");
/**
 * Base service class that all services should extend
 * Provides common functionality and standardized patterns
 */
class BaseService {
    constructor(context, serviceName) {
        this.initialized = false;
        this.node = context.node;
        this.databaseService = context.databaseService;
        this.configManager = context.configManager;
        this.serviceName = serviceName || this.constructor.name;
    }
    /**
     * Initialize the service
     * Override this method in derived classes for custom initialization
     */
    async initialize() {
        if (this.initialized) {
            this.logDebug('Service already initialized, skipping');
            return;
        }
        try {
            this.logInfo('Initializing service...');
            await this.onInitialize();
            this.initialized = true;
            this.logInfo('Service initialized successfully');
        }
        catch (error) {
            this.logError('Service initialization failed', error);
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, `Failed to initialize ${this.serviceName}: ${error.message}`, 500);
        }
    }
    /**
     * Cleanup service resources
     * Override this method in derived classes for custom cleanup
     */
    async cleanup() {
        if (!this.initialized) {
            this.logDebug('Service not initialized, skipping cleanup');
            return;
        }
        try {
            this.logInfo('Cleaning up service...');
            await this.onCleanup();
            this.initialized = false;
            this.logInfo('Service cleanup completed');
        }
        catch (error) {
            this.logError('Service cleanup failed', error);
            // Don't throw during cleanup to avoid cascading failures
        }
    }
    /**
     * Check if service is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Ensure service is initialized before operations
     */
    ensureInitialized() {
        if (!this.initialized) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, `${this.serviceName} is not initialized`, 500);
        }
    }
    /**
     * Ensure database service is available
     */
    ensureDatabaseService() {
        if (!this.databaseService || !this.databaseService.isInitialized()) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, 'Database service is not available', 500);
        }
    }
    /**
     * Execute operation with error handling and logging
     */
    async executeOperation(operationName, operation, context) {
        const startTime = Date.now();
        this.logDebug(`Starting operation: ${operationName}`, context);
        try {
            const result = await operation();
            const duration = Date.now() - startTime;
            this.logDebug(`Operation completed: ${operationName} (${duration}ms)`, { context, duration });
            return result;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            this.logError(`Operation failed: ${operationName} (${duration}ms)`, error, { context, duration });
            // Re-throw ApiErrors as-is, wrap others
            if (error instanceof common_types_1.ApiError) {
                throw error;
            }
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, `${operationName} failed: ${error.message}`, 500, { originalError: error.message, context });
        }
    }
    /**
     * Execute database operation with transaction support
     */
    async executeWithTransaction(operation, operationName) {
        this.ensureDatabaseService();
        return this.executeOperation(operationName || 'database transaction', () => this.databaseService.transaction(operation));
    }
    /**
     * Validate input data
     */
    validateInput(data, fieldName) {
        if (data === null || data === undefined) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, `${fieldName} is required`, 400);
        }
    }
    /**
     * Validate string input
     */
    validateStringInput(data, fieldName, minLength = 1) {
        this.validateInput(data, fieldName);
        if (typeof data !== 'string' || data.trim().length < minLength) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, `${fieldName} must be a non-empty string`, 400);
        }
    }
    /**
     * Validate numeric input
     */
    validateNumericInput(data, fieldName, min, max) {
        this.validateInput(data, fieldName);
        if (typeof data !== 'number' || isNaN(data)) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, `${fieldName} must be a valid number`, 400);
        }
        if (min !== undefined && data < min) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, `${fieldName} must be at least ${min}`, 400);
        }
        if (max !== undefined && data > max) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, `${fieldName} must be at most ${max}`, 400);
        }
    }
    // Logging helpers with service context
    logInfo(message, data) {
        logger_1.logger.info(this.node, `[${this.serviceName}] ${message}`, data);
    }
    logError(message, error, data) {
        logger_1.logger.error(this.node, `[${this.serviceName}] ${message}`, Object.assign({ error: (error === null || error === void 0 ? void 0 : error.message) || error }, data));
    }
    logWarn(message, data) {
        logger_1.logger.warn(this.node, `[${this.serviceName}] ${message}`, data);
    }
    logDebug(message, data) {
        if (this.configManager.isEnabled('enableDebugMode')) {
            logger_1.logger.debug(this.node, `[${this.serviceName}] ${message}`, data);
        }
    }
    /**
     * Override this method for custom initialization logic
     */
    async onInitialize() {
        // Default implementation does nothing
    }
    /**
     * Override this method for custom cleanup logic
     */
    async onCleanup() {
        // Default implementation does nothing
    }
    /**
     * Get service metrics for monitoring
     */
    getMetrics() {
        return {
            serviceName: this.serviceName,
            initialized: this.initialized,
            uptime: this.initialized ? Date.now() : 0
        };
    }
    /**
     * Health check for the service
     */
    async healthCheck() {
        try {
            if (!this.initialized) {
                return { status: 'down', details: 'Service not initialized' };
            }
            // Override in derived classes for custom health checks
            const customHealth = await this.onHealthCheck();
            return { status: 'up', details: customHealth };
        }
        catch (error) {
            return {
                status: 'down',
                details: { error: error.message }
            };
        }
    }
    /**
     * Override this method for custom health check logic
     */
    async onHealthCheck() {
        return { message: 'Service is healthy' };
    }
}
exports.BaseService = BaseService;

/**
 * @fileoverview Base service class with common functionality for all services
 * Provides standardized patterns for service implementation
 */

import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { ApiError, ErrorType, IService } from '../types/common.types';
import { DatabaseService } from './database.service';
import { ApiConfigManager } from '../config/api.config';

/**
 * Service context interface for dependency injection
 */
export interface ServiceContext {
    node: Node;
    databaseService: DatabaseService;
    configManager: ApiConfigManager;
}

/**
 * Base service class that all services should extend
 * Provides common functionality and standardized patterns
 */
export abstract class BaseService implements IService {
    protected readonly node: Node;
    protected readonly databaseService: DatabaseService;
    protected readonly configManager: ApiConfigManager;
    protected readonly serviceName: string;
    protected initialized = false;

    constructor(context: ServiceContext, serviceName?: string) {
        this.node = context.node;
        this.databaseService = context.databaseService;
        this.configManager = context.configManager;
        this.serviceName = serviceName || this.constructor.name;
    }

    /**
     * Initialize the service
     * Override this method in derived classes for custom initialization
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            this.logDebug('Service already initialized, skipping');
            return;
        }

        try {
            this.logInfo('Initializing service...');
            await this.onInitialize();
            this.initialized = true;
            this.logInfo('Service initialized successfully');
        } catch (error) {
            this.logError('Service initialization failed', error);
            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                `Failed to initialize ${this.serviceName}: ${(error as Error).message}`,
                500
            );
        }
    }

    /**
     * Cleanup service resources
     * Override this method in derived classes for custom cleanup
     */
    async cleanup(): Promise<void> {
        if (!this.initialized) {
            this.logDebug('Service not initialized, skipping cleanup');
            return;
        }

        try {
            this.logInfo('Cleaning up service...');
            await this.onCleanup();
            this.initialized = false;
            this.logInfo('Service cleanup completed');
        } catch (error) {
            this.logError('Service cleanup failed', error);
            // Don't throw during cleanup to avoid cascading failures
        }
    }

    /**
     * Check if service is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Ensure service is initialized before operations
     */
    protected ensureInitialized(): void {
        if (!this.initialized) {
            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                `${this.serviceName} is not initialized`,
                500
            );
        }
    }

    /**
     * Ensure database service is available
     */
    protected ensureDatabaseService(): void {
        if (!this.databaseService || !this.databaseService.isInitialized()) {
            throw new ApiError(
                ErrorType.DATABASE_ERROR,
                'Database service is not available',
                500
            );
        }
    }

    /**
     * Execute operation with error handling and logging
     */
    protected async executeOperation<T>(
        operationName: string,
        operation: () => Promise<T>,
        context?: any
    ): Promise<T> {
        const startTime = Date.now();
        this.logDebug(`Starting operation: ${operationName}`, context);

        try {
            const result = await operation();
            const duration = Date.now() - startTime;
            this.logDebug(`Operation completed: ${operationName} (${duration}ms)`, { context, duration });
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            this.logError(`Operation failed: ${operationName} (${duration}ms)`, error, { context, duration });
            
            // Re-throw ApiErrors as-is, wrap others
            if (error instanceof ApiError) {
                throw error;
            }
            
            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                `${operationName} failed: ${(error as Error).message}`,
                500,
                { originalError: (error as Error).message, context }
            );
        }
    }

    /**
     * Execute database operation with transaction support
     */
    protected async executeWithTransaction<T>(
        operation: (manager: any) => Promise<T>,
        operationName?: string
    ): Promise<T> {
        this.ensureDatabaseService();
        
        return this.executeOperation(
            operationName || 'database transaction',
            () => this.databaseService.transaction(operation)
        );
    }

    /**
     * Validate input data
     */
    protected validateInput(data: any, fieldName: string): void {
        if (data === null || data === undefined) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                `${fieldName} is required`,
                400
            );
        }
    }

    /**
     * Validate string input
     */
    protected validateStringInput(data: string, fieldName: string, minLength = 1): void {
        this.validateInput(data, fieldName);
        
        if (typeof data !== 'string' || data.trim().length < minLength) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                `${fieldName} must be a non-empty string`,
                400
            );
        }
    }

    /**
     * Validate numeric input
     */
    protected validateNumericInput(data: number, fieldName: string, min?: number, max?: number): void {
        this.validateInput(data, fieldName);
        
        if (typeof data !== 'number' || isNaN(data)) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                `${fieldName} must be a valid number`,
                400
            );
        }
        
        if (min !== undefined && data < min) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                `${fieldName} must be at least ${min}`,
                400
            );
        }
        
        if (max !== undefined && data > max) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                `${fieldName} must be at most ${max}`,
                400
            );
        }
    }

    // Logging helpers with service context
    protected logInfo(message: string, data?: any): void {
        logger.info(this.node, `[${this.serviceName}] ${message}`, data);
    }

    protected logError(message: string, error?: any, data?: any): void {
        logger.error(this.node, `[${this.serviceName}] ${message}`, { error: error?.message || error, ...data });
    }

    protected logWarn(message: string, data?: any): void {
        logger.warn(this.node, `[${this.serviceName}] ${message}`, data);
    }

    protected logDebug(message: string, data?: any): void {
        if (this.configManager.isEnabled('enableDebugMode')) {
            logger.debug(this.node, `[${this.serviceName}] ${message}`, data);
        }
    }

    /**
     * Override this method for custom initialization logic
     */
    protected async onInitialize(): Promise<void> {
        // Default implementation does nothing
    }

    /**
     * Override this method for custom cleanup logic
     */
    protected async onCleanup(): Promise<void> {
        // Default implementation does nothing
    }

    /**
     * Get service metrics for monitoring
     */
    getMetrics(): any {
        return {
            serviceName: this.serviceName,
            initialized: this.initialized,
            uptime: this.initialized ? Date.now() : 0
        };
    }

    /**
     * Health check for the service
     */
    async healthCheck(): Promise<{ status: string; details?: any }> {
        try {
            if (!this.initialized) {
                return { status: 'down', details: 'Service not initialized' };
            }

            // Override in derived classes for custom health checks
            const customHealth = await this.onHealthCheck();
            return { status: 'up', details: customHealth };
        } catch (error) {
            return { 
                status: 'down', 
                details: { error: (error as Error).message } 
            };
        }
    }

    /**
     * Override this method for custom health check logic
     */
    protected async onHealthCheck(): Promise<any> {
        return { message: 'Service is healthy' };
    }
}

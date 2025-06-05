/**
 * @fileoverview Base controller class with common functionality
 */

import { Request, Response, NextFunction } from 'express';
import { Node } from 'node-red';
import { IController, RouteDefinition, RequestContext, ApiError } from '../types/common.types';
import { ResponseHelper } from '../utils/response.helper';
import { logger } from '../utils/logger';
import { ApiConfigManager } from '../config/api.config';

/**
 * Base controller class that all controllers should extend
 */
export abstract class BaseController implements IController {
    protected node: Node;
    protected context: RequestContext;
    protected configManager?: ApiConfigManager;
    protected controllerName: string;

    constructor(node: Node, configManager?: ApiConfigManager) {
        this.node = node;
        this.configManager = configManager;
        this.context = { node };
        this.controllerName = this.constructor.name;
    }

    /**
     * Abstract method to get route definitions
     */
    abstract getRoutes(): RouteDefinition[];

    /**
     * Create request context
     */
    protected createContext(req: Request): RequestContext {
        return {
            node: this.node,
            user: (req as any).user,
            requestId: this.generateRequestId(),
            startTime: Date.now()
        };
    }

    /**
     * Generate unique request ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Async handler wrapper for error handling with improved logging
     */
    protected asyncHandler(
        fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
        operationName?: string
    ) {
        return (req: Request, res: Response, next: NextFunction) => {
            const context = this.createContext(req);
            const operation = operationName || `${req.method} ${req.path}`;

            // Enhanced logging for development
            if (this.configManager?.isEnabled('enableDebugMode')) {
                this.logDebug(`Starting operation: ${operation}`, {
                    requestId: context.requestId,
                    ip: req.ip,
                    userAgent: req.get('User-Agent')?.substring(0, 100),
                    body: this.sanitizeLogData(req.body),
                    query: req.query,
                    params: req.params
                });
            } else {
                this.logInfo(`${operation}`, {
                    requestId: context.requestId,
                    ip: req.ip
                });
            }

            Promise.resolve(fn(req, res, next))
                .then(() => {
                    const duration = Date.now() - (context.startTime || 0);
                    this.logInfo(`Operation completed: ${operation} (${duration}ms)`, {
                        requestId: context.requestId,
                        statusCode: res.statusCode,
                        duration
                    });
                })
                .catch((error) => {
                    const duration = Date.now() - (context.startTime || 0);
                    this.logError(`Operation failed: ${operation} (${duration}ms)`, {
                        requestId: context.requestId,
                        error: error.message,
                        stack: this.configManager?.isEnabled('enableDebugMode') ? error.stack : undefined,
                        duration
                    });

                    ResponseHelper.error(res, error, undefined, undefined, this.node);
                });
        };
    }

    /**
     * Success response helper
     */
    protected success<T>(
        res: Response,
        data: T,
        statusCode: number = 200,
        message?: string
    ): void {
        ResponseHelper.success(res, data, statusCode, message);
    }

    /**
     * Error response helper
     */
    protected error(
        res: Response,
        error: string | ApiError,
        statusCode: number = 500,
        details?: any
    ): void {
        ResponseHelper.error(res, error, statusCode, details, this.node);
    }

    /**
     * Validation error helper
     */
    protected validationError(
        res: Response,
        message: string,
        details?: any
    ): void {
        ResponseHelper.validationError(res, message, details, this.node);
    }

    /**
     * Authentication error helper
     */
    protected authenticationError(
        res: Response,
        message?: string
    ): void {
        ResponseHelper.authenticationError(res, message, this.node);
    }

    /**
     * Authorization error helper
     */
    protected authorizationError(
        res: Response,
        message?: string
    ): void {
        ResponseHelper.authorizationError(res, message, this.node);
    }

    /**
     * Not found error helper
     */
    protected notFoundError(
        res: Response,
        message?: string
    ): void {
        ResponseHelper.notFoundError(res, message, this.node);
    }

    /**
     * Extract pagination parameters from query
     */
    protected getPaginationParams(req: Request) {
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
        const offset = (page - 1) * limit;

        return { page, limit, offset };
    }

    /**
     * Extract user from authenticated request
     */
    protected getAuthenticatedUser(req: Request) {
        return (req as any).user;
    }

    /**
     * Check if user is admin
     */
    protected isAdmin(req: Request): boolean {
        const user = this.getAuthenticatedUser(req);
        return user && user.is_admin === 1;
    }

    /**
     * Get user's customer ID
     */
    protected getUserCustomerId(req: Request): string | null {
        const user = this.getAuthenticatedUser(req);
        return user ? user.customer_id : null;
    }

    /**
     * Validate required parameters
     */
    protected validateRequired(value: any, fieldName: string): void {
        if (value === null || value === undefined || value === '') {
            throw new ApiError(
                'VALIDATION_ERROR' as any,
                `${fieldName} is required`,
                400
            );
        }
    }

    /**
     * Validate string parameter
     */
    protected validateString(value: string, fieldName: string, minLength = 1): void {
        this.validateRequired(value, fieldName);
        if (typeof value !== 'string' || value.trim().length < minLength) {
            throw new ApiError(
                'VALIDATION_ERROR' as any,
                `${fieldName} must be a non-empty string`,
                400
            );
        }
    }

    /**
     * Validate numeric parameter
     */
    protected validateNumber(value: number, fieldName: string, min?: number, max?: number): void {
        this.validateRequired(value, fieldName);
        if (typeof value !== 'number' || isNaN(value)) {
            throw new ApiError(
                'VALIDATION_ERROR' as any,
                `${fieldName} must be a valid number`,
                400
            );
        }
        if (min !== undefined && value < min) {
            throw new ApiError(
                'VALIDATION_ERROR' as any,
                `${fieldName} must be at least ${min}`,
                400
            );
        }
        if (max !== undefined && value > max) {
            throw new ApiError(
                'VALIDATION_ERROR' as any,
                `${fieldName} must be at most ${max}`,
                400
            );
        }
    }

    // Enhanced logging methods with controller context
    protected logInfo(message: string, data?: any): void {
        logger.info(this.node, `[${this.controllerName}] ${message}`, data);
    }

    protected logError(message: string, data?: any): void {
        logger.error(this.node, `[${this.controllerName}] ${message}`, data);
    }

    protected logWarn(message: string, data?: any): void {
        logger.warn(this.node, `[${this.controllerName}] ${message}`, data);
    }

    protected logDebug(message: string, data?: any): void {
        if (this.configManager?.isEnabled('enableDebugMode')) {
            logger.debug(this.node, `[${this.controllerName}] ${message}`, data);
        }
    }

    /**
     * Sanitize data for logging (remove sensitive information)
     */
    private sanitizeLogData(data: any): any {
        if (!data || typeof data !== 'object') return data;

        const sanitized = { ...data };
        const sensitiveFields = ['password', 'pwd', 'token', 'secret', 'key', 'authorization'];

        sensitiveFields.forEach(field => {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        });

        return sanitized;
    }

    /**
     * Execute operation with standardized error handling and logging
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
            this.logError(`Operation failed: ${operationName} (${duration}ms)`, {
                error: (error as Error).message,
                context,
                duration
            });
            throw error;
        }
    }
}

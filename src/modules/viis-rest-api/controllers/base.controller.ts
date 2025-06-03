/**
 * @fileoverview Base controller class with common functionality
 */

import { Request, Response, NextFunction } from 'express';
import { Node } from 'node-red';
import { IController, RouteDefinition, RequestContext, ApiError } from '../types/common.types';
import { ResponseHelper } from '../utils/response.helper';
import { logger } from '../utils/logger';

/**
 * Base controller class that all controllers should extend
 */
export abstract class BaseController implements IController {
    protected node: Node;
    protected context: RequestContext;

    constructor(node: Node) {
        this.node = node;
        this.context = { node };
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
     * Async handler wrapper for error handling
     */
    protected asyncHandler(
        fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
    ) {
        return (req: Request, res: Response, next: NextFunction) => {
            const context = this.createContext(req);

            // Log request
            logger.info(this.node, `${req.method} ${req.path}`, {
                requestId: context.requestId,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            Promise.resolve(fn(req, res, next))
                .then(() => {
                    // Log response time
                    const duration = Date.now() - (context.startTime || 0);
                    logger.info(this.node, `Request completed in ${duration}ms`, {
                        requestId: context.requestId,
                        statusCode: res.statusCode
                    });
                })
                .catch((error) => {
                    logger.error(this.node, `Request failed: ${error.message}`, {
                        requestId: context.requestId,
                        error: error.stack
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
}

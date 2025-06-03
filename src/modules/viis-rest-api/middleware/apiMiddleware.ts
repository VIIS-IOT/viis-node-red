/**
 * @fileoverview API Middleware for VIIS REST API
 * Provides authentication, CORS, rate limiting, and other middleware functions
 */

import { Request, Response, NextFunction } from 'express';
import { Node } from 'node-red';
import { AuthService, JwtPayload } from '../services/authService';
import { logger } from '../utils/logger';

// Use require for middleware modules to avoid TypeScript import issues
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

/**
 * Extended Request interface with user data
 */
export interface AuthenticatedRequest extends Request {
    user?: JwtPayload;
}

/**
 * API configuration interface
 */
export interface ApiConfig {
    enabled: boolean;
    apiPrefix: string;
    enableLogging: boolean;
    enableCors: boolean;
    jwtSecret: string;
    enableRateLimit: boolean;
    maxRequestsPerMinute: number;
}

/**
 * API middleware class for handling common middleware functions
 */
export class ApiMiddleware {
    private authService: AuthService;
    private config: ApiConfig;
    private node: Node;

    /**
     * Creates a new API middleware instance
     * @param authService - Authentication service
     * @param config - API configuration
     * @param node - Node-RED node instance for logging
     */
    constructor(authService: AuthService, config: ApiConfig, node: Node) {
        this.authService = authService;
        this.config = config;
        this.node = node;
    }

    /**
     * CORS middleware
     */
    getCorsMiddleware() {
        if (!this.config.enableCors) {
            return (_req: Request, _res: Response, next: NextFunction) => next();
        }

        return cors({
            origin: true, // Allow all origins for development
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
            exposedHeaders: ['Content-Range', 'X-Content-Range']
        });
    }

    /**
     * Security middleware using Helmet
     */
    getSecurityMiddleware() {
        return helmet({
            contentSecurityPolicy: false, // Disable CSP for API
            crossOriginEmbedderPolicy: false
        });
    }

    /**
     * Compression middleware
     */
    getCompressionMiddleware() {
        return compression({
            filter: (req, res) => {
                if (req.headers['x-no-compression']) {
                    return false;
                }
                return compression.filter(req, res);
            }
        });
    }

    /**
     * Rate limiting middleware
     */
    getRateLimitMiddleware() {
        if (!this.config.enableRateLimit) {
            return (_req: Request, _res: Response, next: NextFunction) => next();
        }

        return rateLimit({
            windowMs: 60 * 1000, // 1 minute
            max: this.config.maxRequestsPerMinute,
            message: {
                error: 'Too Many Requests',
                message: 'Rate limit exceeded. Please try again later.',
                retryAfter: 60
            },
            standardHeaders: true,
            legacyHeaders: false,
            handler: (req, res) => {
                logger.warn(this.node, `Rate limit exceeded for IP: ${req.ip}`);
                res.status(429).json({
                    error: 'Too Many Requests',
                    message: 'Rate limit exceeded. Please try again later.',
                    retryAfter: 60
                });
            }
        });
    }

    /**
     * Request logging middleware
     */
    getLoggingMiddleware() {
        if (!this.config.enableLogging) {
            return (_req: Request, _res: Response, next: NextFunction) => next();
        }

        return (req: Request, res: Response, next: NextFunction) => {
            const start = Date.now();
            const originalSend = res.send;

            // Override res.send to log response
            res.send = function (body) {
                const duration = Date.now() - start;
                const statusCode = res.statusCode;
                const method = req.method;
                const url = req.originalUrl;
                const ip = req.ip || req.connection.remoteAddress;

                logger.info(
                    req.app.locals.node || this.node,
                    `${method} ${url} ${statusCode} ${duration}ms - ${ip}`
                );

                return originalSend.call(this, body);
            }.bind(this);

            next();
        };
    }

    /**
     * Error handling middleware
     */
    getErrorHandlingMiddleware() {
        return (error: any, req: Request, res: Response, next: NextFunction) => {
            logger.error(this.node, `API Error: ${error.message} - ${req.method} ${req.originalUrl}`);

            // Don't leak error details in production
            const isDevelopment = process.env.NODE_ENV === 'development';

            if (error.name === 'ValidationError') {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Validation failed',
                    details: isDevelopment ? error.details : undefined
                });
            }

            if (error.name === 'UnauthorizedError' || error.message.includes('token')) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Authentication required'
                });
            }

            if (error.name === 'ForbiddenError') {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Insufficient permissions'
                });
            }

            // Default server error
            res.status(500).json({
                error: 'Internal Server Error',
                message: isDevelopment ? error.message : 'An unexpected error occurred',
                stack: isDevelopment ? error.stack : undefined
            });
        };
    }

    /**
     * JWT authentication middleware
     */
    getAuthMiddleware() {
        return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            try {
                const authHeader = req.headers.authorization;

                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return res.status(401).json({
                        error: 'Unauthorized',
                        message: 'Authorization header with Bearer token required'
                    });
                }

                const token = authHeader.substring(7); // Remove 'Bearer ' prefix

                // Verify token
                const decoded = await this.authService.verifyToken(token);
                req.user = decoded;

                logger.debug(this.node, `Authenticated user: ${decoded.user_id} (${decoded.email})`);
                next();

            } catch (error) {
                logger.warn(this.node, `Authentication failed: ${(error as Error).message}`);
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Invalid or expired token'
                });
            }
        };
    }

    /**
     * Optional authentication middleware (doesn't fail if no token)
     */
    getOptionalAuthMiddleware() {
        return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            try {
                const authHeader = req.headers.authorization;

                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const token = authHeader.substring(7);
                    const decoded = await this.authService.verifyToken(token);
                    req.user = decoded;
                    logger.debug(this.node, `Optional auth - authenticated user: ${decoded.user_id}`);
                }

                next();
            } catch (error) {
                // Continue without authentication
                logger.debug(this.node, `Optional auth failed: ${(error as Error).message}`);
                next();
            }
        };
    }

    /**
     * Admin role middleware
     */
    getAdminMiddleware() {
        return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            if (!req.user) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Authentication required'
                });
            }

            if (req.user.is_admin !== 1) {
                logger.warn(this.node, `Admin access denied for user: ${req.user.user_id}`);
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Admin privileges required'
                });
            }

            next();
        };
    }

    /**
     * Customer access middleware (user can only access their own customer data)
     */
    getCustomerAccessMiddleware() {
        return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
            if (!req.user) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Authentication required'
                });
            }

            const requestedCustomerId = req.params.customerId || req.query.customer_id;

            // Admin can access any customer
            if (req.user.is_admin === 1) {
                return next();
            }

            // User can only access their own customer
            if (requestedCustomerId && requestedCustomerId !== req.user.customer_id) {
                logger.warn(this.node, `Customer access denied: ${req.user.user_id} tried to access ${requestedCustomerId}`);
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Access denied to this customer data'
                });
            }

            next();
        };
    }
}

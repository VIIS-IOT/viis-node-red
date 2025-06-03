/**
 * @fileoverview Authentication middleware
 */

import { Request, Response, NextFunction } from 'express';
import { Node } from 'node-red';
import { AuthService } from '../services/auth.service';
import { AuthValidator } from '../validators/auth.validator';
import { ResponseHelper } from '../utils/response.helper';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../types/auth.types';

/**
 * Authentication middleware class
 */
export class AuthMiddleware {
    private authService: AuthService;
    private authValidator: AuthValidator;
    private node: Node;

    constructor(authService: AuthService, node: Node) {
        this.authService = authService;
        this.authValidator = new AuthValidator();
        this.node = node;
    }

    /**
     * JWT authentication middleware
     */
    authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            // Extract token from authorization header
            const token = await this.authValidator.validateAndExtractToken(req.headers);

            // Verify token
            const decoded = await this.authService.verifyToken(token);

            // Attach user to request
            (req as AuthenticatedRequest).user = decoded;
            (req as AuthenticatedRequest).token = token;

            logger.debug(this.node, `User authenticated: ${decoded.user_id}`);
            next();

        } catch (error) {
            logger.warn(this.node, `Authentication failed: ${(error as Error).message}`);
            ResponseHelper.authenticationError(res, (error as Error).message, this.node);
        }
    };

    /**
     * Admin authorization middleware
     */
    requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
        const user = (req as AuthenticatedRequest).user;

        if (!user) {
            return ResponseHelper.authenticationError(res, 'Authentication required', this.node);
        }

        if (user.is_admin !== 1) {
            return ResponseHelper.authorizationError(res, 'Admin access required', this.node);
        }

        logger.debug(this.node, `Admin access granted to user: ${user.user_id}`);
        next();
    };

    /**
     * Customer access middleware (user can only access their own customer data)
     */
    requireCustomerAccess = (req: Request, res: Response, next: NextFunction): void => {
        const user = (req as AuthenticatedRequest).user;

        if (!user) {
            return ResponseHelper.authenticationError(res, 'Authentication required', this.node);
        }

        const requestedCustomerId = req.params.customerId || req.query.customer_id;

        // Admin can access any customer
        if (user.is_admin === 1) {
            logger.debug(this.node, `Admin access granted to customer: ${requestedCustomerId}`);
            return next();
        }

        // Regular user can only access their own customer
        if (requestedCustomerId && requestedCustomerId !== user.customer_id) {
            logger.warn(this.node, `User ${user.user_id} attempted to access customer ${requestedCustomerId}`);
            return ResponseHelper.authorizationError(
                res, 
                'Access denied: You can only access your own customer data', 
                this.node
            );
        }

        logger.debug(this.node, `Customer access granted to user: ${user.user_id}`);
        next();
    };

    /**
     * Optional authentication middleware (doesn't fail if no token)
     */
    optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const authHeader = req.headers.authorization;
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                // No token provided, continue without authentication
                return next();
            }

            const token = this.authValidator.extractTokenFromHeader(authHeader);
            const decoded = await this.authService.verifyToken(token);

            // Attach user to request
            (req as AuthenticatedRequest).user = decoded;
            (req as AuthenticatedRequest).token = token;

            logger.debug(this.node, `Optional auth: User authenticated: ${decoded.user_id}`);

        } catch (error) {
            // Log warning but don't fail the request
            logger.warn(this.node, `Optional auth failed: ${(error as Error).message}`);
        }

        next();
    };

    /**
     * Role-based access middleware
     */
    requireRole = (allowedRoles: string[]) => {
        return (req: Request, res: Response, next: NextFunction): void => {
            const user = (req as AuthenticatedRequest).user;

            if (!user) {
                return ResponseHelper.authenticationError(res, 'Authentication required', this.node);
            }

            const userRole = user.iot_dynamic_role;
            
            if (!allowedRoles.includes(userRole)) {
                logger.warn(this.node, `User ${user.user_id} with role ${userRole} denied access. Required roles: ${allowedRoles.join(', ')}`);
                return ResponseHelper.authorizationError(
                    res, 
                    `Access denied: Required role(s): ${allowedRoles.join(', ')}`, 
                    this.node
                );
            }

            logger.debug(this.node, `Role-based access granted to user: ${user.user_id} with role: ${userRole}`);
            next();
        };
    };
}

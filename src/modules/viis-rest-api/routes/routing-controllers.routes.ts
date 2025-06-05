/**
 * @fileoverview Hybrid Routes Setup - Proof of Concept
 * Integrates routing-controllers with existing Node-RED Express server
 */

import 'reflect-metadata';
import { NodeAPI, Node } from 'node-red';
import { useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { logger } from '../utils/logger';
import { ApiConfigManager } from '../config/api.config';
import { AuthService } from '../services/auth.service';
import { DatabaseService } from '../services/database.service';
import { Action } from 'routing-controllers';
import { HealthController } from '../controllers/health.controller';
import { AuthController } from '../controllers/auth.controller';
import { UserController } from '../controllers/user.controller';
import { DeviceController } from '../controllers/device.controller';

/**
 * Routing Controllers Routes - Main routing system using routing-controllers
 *
 * This class integrates routing-controllers with Node-RED's Express server
 * and handles all API routing for the VIIS REST API module.
 */
export class RoutingControllersRoutes {
    private node: Node;
    private configManager: ApiConfigManager;
    private authService: AuthService;
    private databaseService: DatabaseService;

    constructor(
        node: Node,
        configManager: ApiConfigManager,
        authService: AuthService,
        databaseService: DatabaseService
    ) {
        this.node = node;
        this.configManager = configManager;
        this.authService = authService;
        this.databaseService = databaseService;
    }

    /**
     * Setup routing-controllers integration with Node-RED Express server
     */
    async setupRoutingControllers(RED: NodeAPI): Promise<void> {
        try {
            logger.info(this.node, 'Setting up routing-controllers integration...');

            // Ensure TypeDI container has all required dependencies
            this.ensureContainerSetup();

            // Configure routing-controllers with Node-RED's Express server
            const app = useExpressServer(RED.httpNode, {
                // Route configuration - now using main API prefix
                routePrefix: this.configManager.get('apiPrefix'),

                // Controllers to register
                controllers: [HealthController, AuthController, UserController, DeviceController],

                // Middleware (we'll integrate our existing middleware)
                middlewares: [], // Start empty for PoC

                // Validation and transformation
                validation: {
                    enableDebugMessages: this.configManager.isEnabled('enableDebugMode'),
                    skipMissingProperties: false,
                    whitelist: true,
                    forbidNonWhitelisted: true
                },
                classTransformer: true,

                // Error handling - disable default to use our custom handling
                defaultErrorHandler: false,

                // Authorization integration
                authorizationChecker: this.createAuthorizationChecker(),
                currentUserChecker: this.createCurrentUserChecker(),

                // Development features
                development: this.configManager.isEnabled('enableDebugMode'),

                // CORS (inherit from existing setup)
                cors: this.configManager.isEnabled('enableCors')
            });

            // Add custom error handling middleware after routing-controllers
            this.setupCustomErrorHandling(RED);

            logger.info(this.node, '✅ routing-controllers integration completed successfully');

            // Log registered routes for debugging
            this.logRegisteredRoutes();

        } catch (error) {
            logger.error(this.node, 'Failed to setup routing-controllers integration', {
                error: (error as Error).message,
                stack: (error as Error).stack
            });
            throw error;
        }
    }

    /**
     * Ensure TypeDI container has all required dependencies
     */
    private ensureContainerSetup(): void {
        // Verify all required services are in the container
        if (!Container.has('node')) {
            Container.set('node', this.node);
        }

        if (!Container.has('configManager')) {
            Container.set('configManager', this.configManager);
        }

        if (!Container.has(AuthService)) {
            Container.set(AuthService, this.authService);
        }

        if (!Container.has(DatabaseService)) {
            Container.set(DatabaseService, this.databaseService);
        }

        logger.debug(this.node, 'TypeDI container setup verified');
    }

    /**
     * Create authorization checker for routing-controllers
     */
    private createAuthorizationChecker() {
        return async (action: Action, roles: string[]): Promise<boolean> => {
            try {
                // Extract token from request
                const token = this.extractTokenFromRequest(action.request);

                if (!token) {
                    logger.debug(this.node, 'Authorization failed: No token provided');
                    return false;
                }

                // Verify token using our existing auth service
                const payload = await this.authService.verifyToken(token);

                if (!payload) {
                    logger.debug(this.node, 'Authorization failed: Invalid token');
                    return false;
                }

                // Store user in request for currentUserChecker
                action.request.user = payload;

                // If no specific roles required, just check if authenticated
                if (!roles || roles.length === 0) {
                    logger.debug(this.node, 'Authorization successful: User authenticated');
                    return true;
                }

                // Check roles if specified
                const hasRequiredRole = this.checkUserRoles(payload, roles);

                logger.debug(this.node, 'Authorization check completed', {
                    userId: payload.user_id,
                    requiredRoles: roles,
                    hasAccess: hasRequiredRole
                });

                return hasRequiredRole;

            } catch (error) {
                logger.warn(this.node, 'Authorization check failed', {
                    error: (error as Error).message
                });
                return false;
            }
        };
    }

    /**
     * Create current user checker for routing-controllers
     */
    private createCurrentUserChecker() {
        return async (action: Action): Promise<any> => {
            try {
                // User should already be set by authorizationChecker
                if (action.request.user) {
                    return action.request.user;
                }

                // Fallback: try to extract and verify token
                const token = this.extractTokenFromRequest(action.request);
                if (token) {
                    const payload = await this.authService.verifyToken(token);
                    action.request.user = payload;
                    return payload;
                }

                return null;
            } catch (error) {
                logger.warn(this.node, 'Current user check failed', {
                    error: (error as Error).message
                });
                return null;
            }
        };
    }

    /**
     * Extract JWT token from request headers
     */
    private extractTokenFromRequest(request: any): string | null {
        const authHeader = request.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }

        return null;
    }

    /**
     * Check if user has required roles
     */
    private checkUserRoles(user: any, requiredRoles: string[]): boolean {
        // For PoC, implement basic role checking
        if (user.role === 'admin' || user.is_admin) {
            return true;
        }

        if (user.roles && Array.isArray(user.roles)) {
            return requiredRoles.some(role => user.roles.includes(role));
        }

        return requiredRoles.length === 0;
    }

    /**
     * Setup custom error handling for routing-controllers
     */
    private setupCustomErrorHandling(RED: NodeAPI): void {
        RED.httpNode.use(this.configManager.get('apiPrefix'), (error: any, req: any, res: any, next: any) => {
            logger.error(this.node, 'routing-controllers error', {
                error: error.message,
                path: req.path,
                method: req.method,
                stack: this.configManager.isEnabled('enableDebugMode') ? error.stack : undefined
            });

            if (error.httpCode) {
                return res.status(error.httpCode).json({
                    success: false,
                    error: {
                        type: error.name || 'ValidationError',
                        message: error.message,
                        details: this.configManager.isEnabled('enableDebugMode') ? error.errors : undefined
                    },
                    timestamp: new Date().toISOString()
                });
            }

            res.status(500).json({
                success: false,
                error: {
                    type: 'InternalServerError',
                    message: 'An unexpected error occurred'
                },
                timestamp: new Date().toISOString()
            });
        });

        logger.debug(this.node, 'Custom error handling setup completed');
    }

    /**
     * Log registered routes for debugging
     */
    private logRegisteredRoutes(): void {
        if (this.configManager.isEnabled('enableDebugMode')) {
            logger.info(this.node, 'routing-controllers routes registered:', {
                prefix: this.configManager.get('apiPrefix'),
                controllers: ['HealthController', 'AuthController', 'UserController', 'DeviceController'],
                routes: [
                    'GET /health',
                    'GET /health/detailed',
                    'POST /auth/login',
                    'GET /auth/verify',
                    'POST /auth/logout',
                    'GET /auth/me',
                    'GET /users',
                    'GET /users/me',
                    'GET /users/:userId',
                    'GET /devices',
                    'GET /devices/:id',
                    'POST /devices',
                    'PUT /devices/:id',
                    'DELETE /devices/:id'
                ]
            });
        }
    }

    /**
     * Get integration status for monitoring
     */
    getStatus(): any {
        return {
            enabled: true,
            routePrefix: this.configManager.get('apiPrefix'),
            controllersRegistered: ['HealthController', 'AuthController', 'UserController', 'DeviceController'],
            authorizationEnabled: true,
            validationEnabled: true,
            errorHandlingEnabled: true
        };
    }
}
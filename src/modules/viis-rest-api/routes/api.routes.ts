/**
 * @fileoverview API Routes Registry for VIIS REST API
 * Registers all API endpoints with Node-RED's Express server using controllers
 */

import { NodeAPI, Node } from 'node-red';
import Container from 'typedi';
import { DatabaseService } from '../services/database.service';
import { AuthService } from '../services/auth.service';

import { logger } from '../utils/logger';
import { ApiConfig } from '../types/common.types';
import { ResponseHelper } from '../utils/response.helper';
import { ApiConfigManager } from '../config/api.config';
import { DevUtils } from '../utils/dev.utils';
import { RoutingControllersRoutes } from './routing-controllers.routes';

// Use require for body-parser
const bodyParser = require('body-parser');

/**
 * API routes registry class
 *
 * This class demonstrates the recommended patterns for API route management:
 * - Uses TypeDI container for dependency resolution
 * - Provides consistent middleware application
 * - Supports dynamic route registration
 * - Serves as a template for other API modules
 */
export class ApiRoutes {
    private node: Node;
    private configManager: ApiConfigManager;
    private devUtils: DevUtils;
    private routingControllersRoutes: RoutingControllersRoutes;

    constructor(
        databaseService: DatabaseService,
        authService: AuthService,
        node: Node,
        configManager: ApiConfigManager
    ) {
        this.node = node;
        this.configManager = configManager;
        this.devUtils = DevUtils.getInstance(node, configManager);

        // Initialize routing-controllers integration
        this.routingControllersRoutes = new RoutingControllersRoutes(node, configManager, authService, databaseService);
    }



    /**
     * Register all API routes with Node-RED's Express server
     */
    async registerRoutes(RED: NodeAPI, config: ApiConfig): Promise<void> {
        try {
            // Setup body parsing middleware
            this.setupBodyParsing(RED, config);

            // Setup global middleware
            this.setupGlobalMiddleware(RED, config);

            // Add debug routes for routing-controllers
            this.addDebugRoutes(RED, config);

            // Setup hybrid routing-controllers integration (Proof of Concept)
            await this.setupHybridRoutes(RED);

            // Setup error handling
            this.setupErrorHandling(RED, config);

            logger.info(this.node, `All API routes registered successfully with prefix: ${config.apiPrefix}`);

        } catch (error) {
            logger.error(this.node, `Failed to register API routes: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Setup body parsing middleware
     */
    private setupBodyParsing(RED: NodeAPI, config: ApiConfig): void {
        RED.httpNode.use(config.apiPrefix, bodyParser.json({
            limit: '10mb',
            strict: true
        }));

        RED.httpNode.use(config.apiPrefix, bodyParser.urlencoded({
            extended: true,
            limit: '10mb'
        }));

        logger.debug(this.node, "Body parsing middleware configured");
    }

    /**
     * Setup global middleware
     */
    private setupGlobalMiddleware(RED: NodeAPI, config: ApiConfig): void {
        // Development utilities middleware
        if (this.configManager.isEnabled('enableRequestTracing')) {
            RED.httpNode.use(config.apiPrefix, this.devUtils.createRequestTracingMiddleware());
        }

        if (this.configManager.isEnabled('enableDebugMode')) {
            RED.httpNode.use(config.apiPrefix, this.devUtils.createPerformanceMiddleware());
        }

        // Request logging middleware (simplified since tracing handles detailed logging)
        if (config.enableLogging) {
            RED.httpNode.use(config.apiPrefix, (req: any, res: any, next: any) => {
                logger.info(this.node, `${req.method} ${req.path}`, {
                    ip: req.ip,
                    userAgent: req.get('User-Agent')?.substring(0, 100) // Truncate long user agents
                });
                next();
            });
        }

        logger.debug(this.node, "Global middleware configured");
    }



    /**
     * Add debug routes for troubleshooting
     */
    private addDebugRoutes(RED: NodeAPI, config: ApiConfig): void {
        // Only add debug routes in development mode
        if (!this.configManager.isEnabled('enableDebugMode')) {
            return;
        }

        // Debug route to list all registered routes (now handled by routing-controllers)
        RED.httpNode.get(`${config.apiPrefix}/debug/routes`, (_req: any, res: any) => {
            const routeList = [
                // routing-controllers routes
                { controller: 'HealthController', method: 'GET', path: `${config.apiPrefix}/health`, handler: 'getHealth' },
                { controller: 'HealthController', method: 'GET', path: `${config.apiPrefix}/health/detailed`, handler: 'getDetailedHealth' },
                { controller: 'AuthController', method: 'POST', path: `${config.apiPrefix}/auth/login`, handler: 'login' },
                { controller: 'AuthController', method: 'GET', path: `${config.apiPrefix}/auth/verify`, handler: 'verifyToken' },
                { controller: 'AuthController', method: 'POST', path: `${config.apiPrefix}/auth/logout`, handler: 'logout' },
                { controller: 'AuthController', method: 'GET', path: `${config.apiPrefix}/auth/me`, handler: 'getCurrentUser' },
                { controller: 'UserController', method: 'GET', path: `${config.apiPrefix}/users`, handler: 'getAllUsers' },
                { controller: 'UserController', method: 'GET', path: `${config.apiPrefix}/users/me`, handler: 'getCurrentUser' },
                { controller: 'UserController', method: 'GET', path: `${config.apiPrefix}/users/:userId`, handler: 'getUserById' },
                { controller: 'DeviceController', method: 'GET', path: `${config.apiPrefix}/devices`, handler: 'listDevices' },
                { controller: 'DeviceController', method: 'GET', path: `${config.apiPrefix}/devices/:id`, handler: 'getDevice' },
                { controller: 'DeviceController', method: 'POST', path: `${config.apiPrefix}/devices`, handler: 'createDevice' },
                { controller: 'DeviceController', method: 'PUT', path: `${config.apiPrefix}/devices/:id`, handler: 'updateDevice' },
                { controller: 'DeviceController', method: 'DELETE', path: `${config.apiPrefix}/devices/:id`, handler: 'deleteDevice' }
            ];

            ResponseHelper.success(res, {
                totalRoutes: routeList.length,
                apiPrefix: config.apiPrefix,
                routes: routeList,
                note: 'All routes now handled by routing-controllers'
            }, 200, 'Registered routes');
        });

        // Development dashboard
        RED.httpNode.get(`${config.apiPrefix}/debug/dashboard`, (_req: any, res: any) => {
            const dashboardData = this.devUtils.getDashboardData();
            ResponseHelper.success(res, dashboardData, 200, 'Development dashboard');
        });

        // Performance metrics
        RED.httpNode.get(`${config.apiPrefix}/debug/metrics`, (_req: any, res: any) => {
            const metrics = this.devUtils.getMetrics();
            ResponseHelper.success(res, metrics, 200, 'Performance metrics');
        });

        // API documentation
        RED.httpNode.get(`${config.apiPrefix}/debug/docs`, (_req: any, res: any) => {
            const docs = {
                title: 'VIIS REST API Documentation',
                version: '2.0.0',
                description: 'Migrated to routing-controllers',
                endpoints: [
                    { path: '/health', method: 'GET', description: 'Basic health check' },
                    { path: '/health/detailed', method: 'GET', description: 'Detailed health check (admin only)' },
                    { path: '/auth/login', method: 'POST', description: 'User login' },
                    { path: '/auth/verify', method: 'GET', description: 'Token verification' },
                    { path: '/auth/logout', method: 'POST', description: 'User logout' },
                    { path: '/auth/me', method: 'GET', description: 'Current user info' },
                    { path: '/users', method: 'GET', description: 'Get all users (admin only)' },
                    { path: '/users/me', method: 'GET', description: 'Current user info' },
                    { path: '/users/:userId', method: 'GET', description: 'Get user by ID' },
                    { path: '/devices', method: 'GET', description: 'List devices with pagination' },
                    { path: '/devices/:id', method: 'GET', description: 'Get device by ID' },
                    { path: '/devices', method: 'POST', description: 'Create new device' },
                    { path: '/devices/:id', method: 'PUT', description: 'Update device' },
                    { path: '/devices/:id', method: 'DELETE', description: 'Delete device' }
                ]
            };
            ResponseHelper.success(res, docs, 200, 'API documentation');
        });

        logger.info(this.node, `✓ Added debug routes: routes, dashboard, metrics, docs`);
    }

    /**
     * Setup hybrid routing-controllers integration (Proof of Concept)
     */
    private async setupHybridRoutes(RED: NodeAPI): Promise<void> {
        try {
            logger.info(this.node, 'Setting up routing-controllers integration...');

            await this.routingControllersRoutes.setupRoutingControllers(RED);

            // Add hybrid routes status to debug dashboard
            if (this.configManager.isEnabled('enableDebugMode')) {
                RED.httpNode.get(`${this.configManager.get('apiPrefix')}/debug/routing-status`, (_req: any, res: any) => {
                    const status = this.routingControllersRoutes.getStatus();
                    ResponseHelper.success(res, status, 200, 'Routing controllers status');
                });
            }

            logger.info(this.node, '✅ Hybrid routing-controllers integration completed');
        } catch (error) {
            logger.error(this.node, 'Failed to setup hybrid routing-controllers', {
                error: (error as Error).message
            });
            // Don't throw - allow the rest of the API to work even if hybrid setup fails
        }
    }





    /**
     * Setup error handling middleware
     */
    private setupErrorHandling(RED: NodeAPI, config: ApiConfig): void {
        // Development error details middleware
        if (this.configManager.isEnabled('enableDetailedErrors')) {
            RED.httpNode.use(config.apiPrefix, this.devUtils.createErrorDetailsMiddleware());
        }

        // Global error handler (should be last middleware)
        RED.httpNode.use(config.apiPrefix, (error: any, req: any, res: any, next: any) => {
            // Check if response has already been sent
            if (res.headersSent) {
                logger.debug(this.node, `Response already sent for ${req.method} ${req.path}, skipping global error handler`);
                return next(error);
            }

            logger.error(this.node, `Unhandled error in API: ${error.message}`, {
                path: req.path,
                method: req.method,
                traceId: (req as any).traceId,
                stack: this.configManager.isEnabled('enableDebugMode') ? error.stack : undefined
            });

            ResponseHelper.error(res, error, undefined, undefined, this.node);
        });

        // 404 handler for API routes - only trigger if response hasn't been sent
        RED.httpNode.use(config.apiPrefix, (req: any, res: any, next: any) => {
            // Check if response has already been sent (by routing-controllers or other middleware)
            if (res.headersSent) {
                logger.debug(this.node, `Response already sent for ${req.method} ${req.path}, skipping 404 handler`);
                return;
            }

            // Only send 404 if no previous middleware handled the request
            ResponseHelper.notFoundError(res, `API endpoint not found: ${req.method} ${req.path}`, this.node);
        });

        logger.debug(this.node, "Error handling middleware configured");
    }


}

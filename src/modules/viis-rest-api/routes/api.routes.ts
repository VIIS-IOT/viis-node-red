/**
 * @fileoverview API Routes Registry for VIIS REST API
 * Registers all API endpoints with Node-RED's Express server using controllers
 */

import { NodeAPI, Node } from 'node-red';
import Container from 'typedi';
import { DatabaseService } from '../services/database.service';
import { AuthService } from '../services/auth.service';
import { AuthController } from '../controllers/auth.controller';
import { UserController } from '../controllers/user.controller';
import { HealthController } from '../controllers/health.controller';
import { AuthMiddleware } from '../middleware/auth.middleware';
import { ValidationMiddleware } from '../middleware/validation.middleware';
import { logger } from '../utils/logger';
import { ApiConfig, IController, RouteDefinition } from '../types/common.types';
import { ResponseHelper } from '../utils/response.helper';
import { ApiConfigManager } from '../config/api.config';
import { DevUtils } from '../utils/dev.utils';

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
    private databaseService: DatabaseService;
    private authService: AuthService;
    private authMiddleware: AuthMiddleware;
    private validationMiddleware: ValidationMiddleware;
    private node: Node;
    private controllers: Map<string, IController> = new Map();
    private configManager: ApiConfigManager;
    private devUtils: DevUtils;

    constructor(
        databaseService: DatabaseService,
        authService: AuthService,
        node: Node,
        configManager: ApiConfigManager
    ) {
        this.databaseService = databaseService;
        this.authService = authService;
        this.node = node;
        this.configManager = configManager;
        this.authMiddleware = new AuthMiddleware(authService, node);
        this.validationMiddleware = Container.get(ValidationMiddleware);
        this.devUtils = DevUtils.getInstance(node, configManager);

        // Initialize controllers using TypeDI container
        this.initializeControllers();
    }

    /**
     * Initialize all controllers using TypeDI container
     *
     * This method demonstrates how to resolve controllers from the DI container.
     * Controllers are automatically instantiated with their dependencies injected.
     */
    private initializeControllers(): void {
        try {
            // Get controllers from TypeDI container
            // The @Controller decorator and @Inject decorators handle dependency injection
            this.controllers.set('auth', Container.get(AuthController));
            this.controllers.set('user', Container.get(UserController));
            this.controllers.set('health', Container.get(HealthController));

            logger.info(this.node, `Initialized ${this.controllers.size} controllers using TypeDI container`);
        } catch (error) {
            logger.error(this.node, `Failed to initialize controllers: ${(error as Error).message}`);
            throw error;
        }
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

            // Register controller routes
            this.registerControllerRoutes(RED, config);

            // Add debug route to list all registered routes
            this.addDebugRoutes(RED, config);

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
     * Register routes from all controllers
     */
    private registerControllerRoutes(RED: NodeAPI, config: ApiConfig): void {
        logger.info(this.node, `Starting route registration for ${this.controllers.size} controllers...`);

        this.controllers.forEach((controller, controllerName) => {
            const routes = controller.getRoutes();
            logger.info(this.node, `Controller '${controllerName}' has ${routes.length} routes`);

            routes.forEach(route => {
                this.registerRoute(RED, config, controller, route, controllerName);
            });

            logger.info(this.node, `✓ Registered ${routes.length} routes for ${controllerName} controller`);
        });

        logger.info(this.node, `Route registration completed!`);
    }

    /**
     * Add debug routes for troubleshooting
     */
    private addDebugRoutes(RED: NodeAPI, config: ApiConfig): void {
        // Only add debug routes in development mode
        if (!this.configManager.isEnabled('enableDebugMode')) {
            return;
        }

        // Debug route to list all registered routes
        RED.httpNode.get(`${config.apiPrefix}/debug/routes`, (_req: any, res: any) => {
            const routeList: any[] = [];

            this.controllers.forEach((controller, controllerName) => {
                const routes = controller.getRoutes();
                routes.forEach(route => {
                    routeList.push({
                        controller: controllerName,
                        method: route.method,
                        path: `${config.apiPrefix}${route.path}`,
                        handler: route.handler,
                        middleware: route.middleware || []
                    });
                });
            });

            ResponseHelper.success(res, {
                totalRoutes: routeList.length,
                apiPrefix: config.apiPrefix,
                routes: routeList
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
            const docs = this.devUtils.generateApiDocs(this.controllers);
            ResponseHelper.success(res, docs, 200, 'API documentation');
        });

        logger.info(this.node, `✓ Added debug routes: routes, dashboard, metrics, docs`);
    }

    /**
     * Register a single route
     */
    private registerRoute(
        RED: NodeAPI,
        config: ApiConfig,
        controller: any,
        route: RouteDefinition,
        controllerName: string
    ): void {
        const fullPath = `${config.apiPrefix}${route.path}`;
        const middlewares: any[] = [];

        // Add middleware based on route configuration
        if (route.middleware) {
            route.middleware.forEach(middlewareName => {
                const middleware = this.getMiddleware(middlewareName);
                if (middleware) {
                    middlewares.push(middleware);
                }
            });
        }

        // Get handler function from controller
        const handler = controller[route.handler];
        if (!handler) {
            logger.error(this.node, `Handler ${route.handler} not found in ${controllerName} controller`);
            return;
        }

        // Register route with Express
        const method = route.method.toLowerCase();
        const expressMethod = (RED.httpNode as any)[method];

        if (!expressMethod) {
            logger.error(this.node, `HTTP method ${route.method} not supported`);
            return;
        }

        // Register the route with proper context binding
        expressMethod.call(RED.httpNode, fullPath, ...middlewares, handler.bind(controller));

        logger.info(this.node, `✓ Registered ${route.method} ${fullPath} -> ${controllerName}.${route.handler}`);
    }

    /**
     * Get middleware by name
     */
    private getMiddleware(middlewareName: string): any {
        switch (middlewareName) {
            case 'auth':
                return this.authMiddleware.authenticate;
            case 'admin':
                return this.authMiddleware.requireAdmin;
            case 'customer':
                return this.authMiddleware.requireCustomerAccess;
            case 'optionalAuth':
                return this.authMiddleware.optionalAuth;
            case 'pagination':
                // For pagination, use GetUsersQueryDto or create a specific pagination DTO
                logger.warn(this.node, `Pagination middleware should use DTO validation instead`);
                return null;
            case 'dateRange':
                // For date range, create a specific DTO with date validation
                logger.warn(this.node, `Date range middleware should use DTO validation instead`);
                return null;
            default:
                logger.warn(this.node, `Unknown middleware: ${middlewareName}`);
                return null;
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
            logger.error(this.node, `Unhandled error in API: ${error.message}`, {
                path: req.path,
                method: req.method,
                traceId: (req as any).traceId,
                stack: this.configManager.isEnabled('enableDebugMode') ? error.stack : undefined
            });

            ResponseHelper.error(res, error, undefined, undefined, this.node);
        });

        // 404 handler for API routes
        RED.httpNode.use(config.apiPrefix, (req: any, res: any) => {
            ResponseHelper.notFoundError(res, `API endpoint not found: ${req.method} ${req.path}`, this.node);
        });

        logger.debug(this.node, "Error handling middleware configured");
    }

    /**
     * Add a new controller
     */
    addController(name: string, controller: IController): void {
        this.controllers.set(name, controller);
        logger.info(this.node, `Added controller: ${name}`);
    }

    /**
     * Remove a controller
     */
    removeController(name: string): boolean {
        const removed = this.controllers.delete(name);
        if (removed) {
            logger.info(this.node, `Removed controller: ${name}`);
        }
        return removed;
    }

    /**
     * Get all registered controllers
     */
    getControllers(): Map<string, IController> {
        return new Map(this.controllers);
    }
}

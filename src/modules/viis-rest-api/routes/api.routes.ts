/**
 * @fileoverview API Routes Registry for VIIS REST API
 * Registers all API endpoints with Node-RED's Express server using controllers
 */

import { NodeAPI, Node } from 'node-red';
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

// Use require for body-parser
const bodyParser = require('body-parser');

/**
 * API routes registry class
 */
export class ApiRoutes {
    private databaseService: DatabaseService;
    private authService: AuthService;
    private authMiddleware: AuthMiddleware;
    private validationMiddleware: ValidationMiddleware;
    private node: Node;
    private controllers: Map<string, IController> = new Map();

    constructor(databaseService: DatabaseService, authService: AuthService, node: Node) {
        this.databaseService = databaseService;
        this.authService = authService;
        this.node = node;
        this.authMiddleware = new AuthMiddleware(authService, node);
        this.validationMiddleware = new ValidationMiddleware(node);

        // Initialize controllers
        this.initializeControllers();
    }

    /**
     * Initialize all controllers
     */
    private initializeControllers(): void {
        // Auth controller
        this.controllers.set('auth', new AuthController(this.authService, this.node));

        // User controller
        this.controllers.set('user', new UserController(this.databaseService, this.node));

        // Health controller
        this.controllers.set('health', new HealthController(this.databaseService, this.node));

        logger.info(this.node, `Initialized ${this.controllers.size} controllers`);
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
        // Request logging middleware
        if (config.enableLogging) {
            RED.httpNode.use(config.apiPrefix, (req: any, res: any, next: any) => {
                const startTime = Date.now();

                logger.info(this.node, `${req.method} ${req.path}`, {
                    ip: req.ip,
                    userAgent: req.get('User-Agent')
                });

                // Log response when finished
                res.on('finish', () => {
                    const duration = Date.now() - startTime;
                    logger.info(this.node, `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
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
        this.controllers.forEach((controller, controllerName) => {
            const routes = controller.getRoutes();

            routes.forEach(route => {
                this.registerRoute(RED, config, controller, route, controllerName);
            });

            logger.debug(this.node, `Registered ${routes.length} routes for ${controllerName} controller`);
        });
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

        // Register the route
        expressMethod.call(RED.httpNode, fullPath, ...middlewares, handler);

        logger.debug(this.node, `Registered ${route.method} ${fullPath} -> ${controllerName}.${route.handler}`);
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
                return this.validationMiddleware.validatePagination;
            case 'dateRange':
                return this.validationMiddleware.validateDateRange;
            default:
                logger.warn(this.node, `Unknown middleware: ${middlewareName}`);
                return null;
        }
    }

    /**
     * Setup error handling middleware
     */
    private setupErrorHandling(RED: NodeAPI, config: ApiConfig): void {
        // Global error handler (should be last middleware)
        RED.httpNode.use(config.apiPrefix, (error: any, req: any, res: any, next: any) => {
            logger.error(this.node, `Unhandled error in API: ${error.message}`, {
                path: req.path,
                method: req.method,
                stack: error.stack
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

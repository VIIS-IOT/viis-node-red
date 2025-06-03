"use strict";
/**
 * @fileoverview API Routes Registry for VIIS REST API
 * Registers all API endpoints with Node-RED's Express server using controllers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiRoutes = void 0;
const auth_controller_1 = require("../controllers/auth.controller");
const user_controller_1 = require("../controllers/user.controller");
const health_controller_1 = require("../controllers/health.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const logger_1 = require("../utils/logger");
const response_helper_1 = require("../utils/response.helper");
// Use require for body-parser
const bodyParser = require('body-parser');
/**
 * API routes registry class
 */
class ApiRoutes {
    constructor(databaseService, authService, node) {
        this.controllers = new Map();
        this.databaseService = databaseService;
        this.authService = authService;
        this.node = node;
        this.authMiddleware = new auth_middleware_1.AuthMiddleware(authService, node);
        this.validationMiddleware = new validation_middleware_1.ValidationMiddleware(node);
        // Initialize controllers
        this.initializeControllers();
    }
    /**
     * Initialize all controllers
     */
    initializeControllers() {
        // Auth controller
        this.controllers.set('auth', new auth_controller_1.AuthController(this.authService, this.node));
        // User controller
        this.controllers.set('user', new user_controller_1.UserController(this.databaseService, this.node));
        // Health controller
        this.controllers.set('health', new health_controller_1.HealthController(this.databaseService, this.node));
        logger_1.logger.info(this.node, `Initialized ${this.controllers.size} controllers`);
    }
    /**
     * Register all API routes with Node-RED's Express server
     */
    async registerRoutes(RED, config) {
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
            logger_1.logger.info(this.node, `All API routes registered successfully with prefix: ${config.apiPrefix}`);
        }
        catch (error) {
            logger_1.logger.error(this.node, `Failed to register API routes: ${error.message}`);
            throw error;
        }
    }
    /**
     * Setup body parsing middleware
     */
    setupBodyParsing(RED, config) {
        RED.httpNode.use(config.apiPrefix, bodyParser.json({
            limit: '10mb',
            strict: true
        }));
        RED.httpNode.use(config.apiPrefix, bodyParser.urlencoded({
            extended: true,
            limit: '10mb'
        }));
        logger_1.logger.debug(this.node, "Body parsing middleware configured");
    }
    /**
     * Setup global middleware
     */
    setupGlobalMiddleware(RED, config) {
        // Request logging middleware
        if (config.enableLogging) {
            RED.httpNode.use(config.apiPrefix, (req, res, next) => {
                const startTime = Date.now();
                logger_1.logger.info(this.node, `${req.method} ${req.path}`, {
                    ip: req.ip,
                    userAgent: req.get('User-Agent')
                });
                // Log response when finished
                res.on('finish', () => {
                    const duration = Date.now() - startTime;
                    logger_1.logger.info(this.node, `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
                });
                next();
            });
        }
        logger_1.logger.debug(this.node, "Global middleware configured");
    }
    /**
     * Register routes from all controllers
     */
    registerControllerRoutes(RED, config) {
        logger_1.logger.info(this.node, `Starting route registration for ${this.controllers.size} controllers...`);
        this.controllers.forEach((controller, controllerName) => {
            const routes = controller.getRoutes();
            logger_1.logger.info(this.node, `Controller '${controllerName}' has ${routes.length} routes`);
            routes.forEach(route => {
                this.registerRoute(RED, config, controller, route, controllerName);
            });
            logger_1.logger.info(this.node, `✓ Registered ${routes.length} routes for ${controllerName} controller`);
        });
        logger_1.logger.info(this.node, `Route registration completed!`);
    }
    /**
     * Add debug routes for troubleshooting
     */
    addDebugRoutes(RED, config) {
        // Debug route to list all registered routes
        RED.httpNode.get(`${config.apiPrefix}/debug/routes`, (_req, res) => {
            const routeList = [];
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
            response_helper_1.ResponseHelper.success(res, {
                totalRoutes: routeList.length,
                apiPrefix: config.apiPrefix,
                routes: routeList
            }, 200, 'Registered routes');
        });
        logger_1.logger.info(this.node, `✓ Added debug route: GET ${config.apiPrefix}/debug/routes`);
    }
    /**
     * Register a single route
     */
    registerRoute(RED, config, controller, route, controllerName) {
        const fullPath = `${config.apiPrefix}${route.path}`;
        const middlewares = [];
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
            logger_1.logger.error(this.node, `Handler ${route.handler} not found in ${controllerName} controller`);
            return;
        }
        // Register route with Express
        const method = route.method.toLowerCase();
        const expressMethod = RED.httpNode[method];
        if (!expressMethod) {
            logger_1.logger.error(this.node, `HTTP method ${route.method} not supported`);
            return;
        }
        // Register the route with proper context binding
        expressMethod.call(RED.httpNode, fullPath, ...middlewares, handler.bind(controller));
        logger_1.logger.info(this.node, `✓ Registered ${route.method} ${fullPath} -> ${controllerName}.${route.handler}`);
    }
    /**
     * Get middleware by name
     */
    getMiddleware(middlewareName) {
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
                logger_1.logger.warn(this.node, `Unknown middleware: ${middlewareName}`);
                return null;
        }
    }
    /**
     * Setup error handling middleware
     */
    setupErrorHandling(RED, config) {
        // Global error handler (should be last middleware)
        RED.httpNode.use(config.apiPrefix, (error, req, res, next) => {
            logger_1.logger.error(this.node, `Unhandled error in API: ${error.message}`, {
                path: req.path,
                method: req.method,
                stack: error.stack
            });
            response_helper_1.ResponseHelper.error(res, error, undefined, undefined, this.node);
        });
        // 404 handler for API routes
        RED.httpNode.use(config.apiPrefix, (req, res) => {
            response_helper_1.ResponseHelper.notFoundError(res, `API endpoint not found: ${req.method} ${req.path}`, this.node);
        });
        logger_1.logger.debug(this.node, "Error handling middleware configured");
    }
    /**
     * Add a new controller
     */
    addController(name, controller) {
        this.controllers.set(name, controller);
        logger_1.logger.info(this.node, `Added controller: ${name}`);
    }
    /**
     * Remove a controller
     */
    removeController(name) {
        const removed = this.controllers.delete(name);
        if (removed) {
            logger_1.logger.info(this.node, `Removed controller: ${name}`);
        }
        return removed;
    }
    /**
     * Get all registered controllers
     */
    getControllers() {
        return new Map(this.controllers);
    }
}
exports.ApiRoutes = ApiRoutes;

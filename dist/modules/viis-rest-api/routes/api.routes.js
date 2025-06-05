"use strict";
/**
 * @fileoverview API Routes Registry for VIIS REST API
 * Registers all API endpoints with Node-RED's Express server using controllers
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiRoutes = void 0;
const typedi_1 = __importDefault(require("typedi"));
const user_controller_1 = require("../controllers/user.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const logger_1 = require("../utils/logger");
const response_helper_1 = require("../utils/response.helper");
const dev_utils_1 = require("../utils/dev.utils");
const hybrid_routes_1 = require("./hybrid.routes");
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
class ApiRoutes {
    constructor(databaseService, authService, node, configManager) {
        this.controllers = new Map();
        this.databaseService = databaseService;
        this.authService = authService;
        this.node = node;
        this.configManager = configManager;
        this.authMiddleware = new auth_middleware_1.AuthMiddleware(authService, node);
        this.validationMiddleware = typedi_1.default.get(validation_middleware_1.ValidationMiddleware);
        this.devUtils = dev_utils_1.DevUtils.getInstance(node, configManager);
        // Initialize hybrid routes for routing-controllers integration
        this.hybridRoutes = new hybrid_routes_1.HybridRoutes(node, configManager, authService, databaseService);
        // Initialize controllers using TypeDI container
        this.initializeControllers();
    }
    /**
     * Initialize all controllers using TypeDI container
     *
     * This method demonstrates how to resolve controllers from the DI container.
     * Controllers are automatically instantiated with their dependencies injected.
     */
    initializeControllers() {
        try {
            // Get controllers from TypeDI container
            // The @Controller decorator and @Inject decorators handle dependency injection
            this.controllers.set('user', typedi_1.default.get(user_controller_1.UserController));
            // Note: HealthController and AuthController are now handled by routing-controllers in hybrid setup
            logger_1.logger.info(this.node, `Initialized ${this.controllers.size} controllers using TypeDI container`);
        }
        catch (error) {
            logger_1.logger.error(this.node, `Failed to initialize controllers: ${error.message}`);
            throw error;
        }
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
            // Setup hybrid routing-controllers integration (Proof of Concept)
            await this.setupHybridRoutes(RED);
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
        // Development utilities middleware
        if (this.configManager.isEnabled('enableRequestTracing')) {
            RED.httpNode.use(config.apiPrefix, this.devUtils.createRequestTracingMiddleware());
        }
        if (this.configManager.isEnabled('enableDebugMode')) {
            RED.httpNode.use(config.apiPrefix, this.devUtils.createPerformanceMiddleware());
        }
        // Request logging middleware (simplified since tracing handles detailed logging)
        if (config.enableLogging) {
            RED.httpNode.use(config.apiPrefix, (req, res, next) => {
                var _a;
                logger_1.logger.info(this.node, `${req.method} ${req.path}`, {
                    ip: req.ip,
                    userAgent: (_a = req.get('User-Agent')) === null || _a === void 0 ? void 0 : _a.substring(0, 100) // Truncate long user agents
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
        // Only add debug routes in development mode
        if (!this.configManager.isEnabled('enableDebugMode')) {
            return;
        }
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
        // Development dashboard
        RED.httpNode.get(`${config.apiPrefix}/debug/dashboard`, (_req, res) => {
            const dashboardData = this.devUtils.getDashboardData();
            response_helper_1.ResponseHelper.success(res, dashboardData, 200, 'Development dashboard');
        });
        // Performance metrics
        RED.httpNode.get(`${config.apiPrefix}/debug/metrics`, (_req, res) => {
            const metrics = this.devUtils.getMetrics();
            response_helper_1.ResponseHelper.success(res, metrics, 200, 'Performance metrics');
        });
        // API documentation
        RED.httpNode.get(`${config.apiPrefix}/debug/docs`, (_req, res) => {
            const docs = this.devUtils.generateApiDocs(this.controllers);
            response_helper_1.ResponseHelper.success(res, docs, 200, 'API documentation');
        });
        logger_1.logger.info(this.node, `✓ Added debug routes: routes, dashboard, metrics, docs`);
    }
    /**
     * Setup hybrid routing-controllers integration (Proof of Concept)
     */
    async setupHybridRoutes(RED) {
        try {
            logger_1.logger.info(this.node, 'Setting up hybrid routing-controllers integration...');
            await this.hybridRoutes.setupRoutingControllers(RED);
            // Add hybrid routes status to debug dashboard
            if (this.configManager.isEnabled('enableDebugMode')) {
                RED.httpNode.get(`${this.configManager.get('apiPrefix')}/debug/hybrid-status`, (_req, res) => {
                    const status = this.hybridRoutes.getStatus();
                    response_helper_1.ResponseHelper.success(res, status, 200, 'Hybrid routing status');
                });
            }
            logger_1.logger.info(this.node, '✅ Hybrid routing-controllers integration completed');
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to setup hybrid routing-controllers', {
                error: error.message
            });
            // Don't throw - allow the rest of the API to work even if hybrid setup fails
        }
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
                // For pagination, use GetUsersQueryDto or create a specific pagination DTO
                logger_1.logger.warn(this.node, `Pagination middleware should use DTO validation instead`);
                return null;
            case 'dateRange':
                // For date range, create a specific DTO with date validation
                logger_1.logger.warn(this.node, `Date range middleware should use DTO validation instead`);
                return null;
            default:
                logger_1.logger.warn(this.node, `Unknown middleware: ${middlewareName}`);
                return null;
        }
    }
    /**
     * Setup error handling middleware
     */
    setupErrorHandling(RED, config) {
        // Development error details middleware
        if (this.configManager.isEnabled('enableDetailedErrors')) {
            RED.httpNode.use(config.apiPrefix, this.devUtils.createErrorDetailsMiddleware());
        }
        // Global error handler (should be last middleware)
        RED.httpNode.use(config.apiPrefix, (error, req, res, next) => {
            logger_1.logger.error(this.node, `Unhandled error in API: ${error.message}`, {
                path: req.path,
                method: req.method,
                traceId: req.traceId,
                stack: this.configManager.isEnabled('enableDebugMode') ? error.stack : undefined
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

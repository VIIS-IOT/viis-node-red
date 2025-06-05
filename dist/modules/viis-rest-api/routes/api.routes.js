"use strict";
/**
 * @fileoverview API Routes Registry for VIIS REST API
 * Registers all API endpoints with Node-RED's Express server using controllers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiRoutes = void 0;
const logger_1 = require("../utils/logger");
const response_helper_1 = require("../utils/response.helper");
const dev_utils_1 = require("../utils/dev.utils");
const routing_controllers_routes_1 = require("./routing-controllers.routes");
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
        this.node = node;
        this.configManager = configManager;
        this.devUtils = dev_utils_1.DevUtils.getInstance(node, configManager);
        // Initialize routing-controllers integration
        this.routingControllersRoutes = new routing_controllers_routes_1.RoutingControllersRoutes(node, configManager, authService, databaseService);
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
            // Add debug routes for routing-controllers
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
     * Add debug routes for troubleshooting
     */
    addDebugRoutes(RED, config) {
        // Only add debug routes in development mode
        if (!this.configManager.isEnabled('enableDebugMode')) {
            return;
        }
        // Debug route to list all registered routes (now handled by routing-controllers)
        RED.httpNode.get(`${config.apiPrefix}/debug/routes`, (_req, res) => {
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
                { controller: 'UserController', method: 'GET', path: `${config.apiPrefix}/users/:userId`, handler: 'getUserById' }
            ];
            response_helper_1.ResponseHelper.success(res, {
                totalRoutes: routeList.length,
                apiPrefix: config.apiPrefix,
                routes: routeList,
                note: 'All routes now handled by routing-controllers'
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
                    { path: '/users/:userId', method: 'GET', description: 'Get user by ID' }
                ]
            };
            response_helper_1.ResponseHelper.success(res, docs, 200, 'API documentation');
        });
        logger_1.logger.info(this.node, `✓ Added debug routes: routes, dashboard, metrics, docs`);
    }
    /**
     * Setup hybrid routing-controllers integration (Proof of Concept)
     */
    async setupHybridRoutes(RED) {
        try {
            logger_1.logger.info(this.node, 'Setting up routing-controllers integration...');
            await this.routingControllersRoutes.setupRoutingControllers(RED);
            // Add hybrid routes status to debug dashboard
            if (this.configManager.isEnabled('enableDebugMode')) {
                RED.httpNode.get(`${this.configManager.get('apiPrefix')}/debug/routing-status`, (_req, res) => {
                    const status = this.routingControllersRoutes.getStatus();
                    response_helper_1.ResponseHelper.success(res, status, 200, 'Routing controllers status');
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
}
exports.ApiRoutes = ApiRoutes;

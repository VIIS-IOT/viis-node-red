"use strict";
/**
 * @fileoverview Hybrid Routes Setup - Proof of Concept
 * Integrates routing-controllers with existing Node-RED Express server
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoutingControllersRoutes = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const logger_1 = require("../utils/logger");
const auth_service_1 = require("../services/auth.service");
const database_service_1 = require("../services/database.service");
const thingsboard_service_1 = require("../services/thingsboard.service");
const enhanced_validation_middleware_1 = require("../middleware/enhanced-validation.middleware");
const path = __importStar(require("path"));
// Fallback imports for manual registration if glob patterns fail
const health_controller_1 = require("../controllers/health.controller");
const auth_controller_1 = require("../controllers/auth.controller");
const user_controller_1 = require("../controllers/user.controller");
const device_controller_1 = require("../controllers/device.controller");
const thingsboard_controller_1 = require("../controllers/thingsboard.controller");
/**
 * Routing Controllers Routes - Main routing system using routing-controllers
 *
 * This class integrates routing-controllers with Node-RED's Express server
 * and handles all API routing for the VIIS REST API module.
 */
class RoutingControllersRoutes {
    constructor(node, configManager, authService, databaseService) {
        this.node = node;
        this.configManager = configManager;
        this.authService = authService;
        this.databaseService = databaseService;
    }
    /**
     * Setup routing-controllers integration with Node-RED Express server
     */
    async setupRoutingControllers(RED) {
        try {
            logger_1.logger.info(this.node, 'Setting up routing-controllers integration...');
            // Ensure TypeDI container has all required dependencies
            this.ensureContainerSetup();
            // CRITICAL: Tell routing-controllers to use TypeDI for dependency injection
            (0, routing_controllers_1.useContainer)(typedi_1.Container);
            logger_1.logger.info(this.node, 'Configured routing-controllers to use TypeDI container');
            // Get controllers using glob patterns with fallback
            const controllers = this.getControllers();
            // Configure routing-controllers with Node-RED's Express server
            const app = (0, routing_controllers_1.useExpressServer)(RED.httpNode, {
                // Route configuration - now using main API prefix
                routePrefix: this.configManager.get('apiPrefix'),
                // Controllers to register (auto-discovered via glob patterns)
                controllers: controllers,
                // Enhanced middleware integration
                middlewares: [enhanced_validation_middleware_1.EnhancedValidationMiddleware],
                // Enhanced validation and transformation
                validation: {
                    enableDebugMessages: this.configManager.isEnabled('enableDebugMode'),
                    skipMissingProperties: false,
                    whitelist: true,
                    forbidNonWhitelisted: true,
                    stopAtFirstError: false, // Show all validation errors
                    dismissDefaultMessages: false,
                    validationError: {
                        target: false,
                        value: true
                    }
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
            logger_1.logger.info(this.node, '✅ routing-controllers integration completed successfully');
            // Log registered routes for debugging
            this.logRegisteredRoutes();
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to setup routing-controllers integration', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
    /**
     * Get controllers using routing-controllers glob patterns with fallback
     */
    getControllers() {
        try {
            // Use routing-controllers built-in glob pattern support
            const controllersDir = path.join(__dirname, '../controllers');
            logger_1.logger.info(this.node, 'Using routing-controllers glob pattern for automatic controller discovery', {
                controllersDir,
                pattern: '*.controller.{ts,js}'
            });
            // routing-controllers will automatically discover and load controllers matching these patterns
            const globPatterns = [
                path.join(controllersDir, '*.controller.ts'),
                path.join(controllersDir, '*.controller.js')
            ];
            logger_1.logger.debug(this.node, 'Controller glob patterns configured', {
                patterns: globPatterns
            });
            return globPatterns;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to setup controller glob patterns, using fallback registration', {
                error: error.message
            });
            return this.getFallbackControllers();
        }
    }
    /**
     * Get fallback controllers for manual registration
     */
    getFallbackControllers() {
        const fallbackControllers = [
            health_controller_1.HealthController,
            auth_controller_1.AuthController,
            user_controller_1.UserController,
            device_controller_1.DeviceController,
            thingsboard_controller_1.ThingsBoardController
        ];
        logger_1.logger.info(this.node, 'Using fallback manual controller registration', {
            controllersCount: fallbackControllers.length,
            controllerNames: fallbackControllers.map(ctrl => ctrl.name)
        });
        return fallbackControllers;
    }
    /**
     * Ensure TypeDI container has all required dependencies
     */
    ensureContainerSetup() {
        // Verify all required services are in the container
        if (!typedi_1.Container.has('node')) {
            typedi_1.Container.set('node', this.node);
            logger_1.logger.debug(this.node, 'Node registered in TypeDI container');
        }
        else {
            // Verify the existing node is valid
            const existingNode = typedi_1.Container.get('node');
            if (!existingNode || typeof existingNode.log !== 'function') {
                typedi_1.Container.set('node', this.node);
                logger_1.logger.debug(this.node, 'Node re-registered in TypeDI container (previous was invalid)');
            }
        }
        if (!typedi_1.Container.has('configManager')) {
            typedi_1.Container.set('configManager', this.configManager);
            logger_1.logger.debug(this.node, 'ConfigManager registered in TypeDI container');
        }
        if (!typedi_1.Container.has(auth_service_1.AuthService)) {
            typedi_1.Container.set(auth_service_1.AuthService, this.authService);
            logger_1.logger.debug(this.node, 'AuthService registered in TypeDI container');
        }
        if (!typedi_1.Container.has(database_service_1.DatabaseService)) {
            typedi_1.Container.set(database_service_1.DatabaseService, this.databaseService);
            logger_1.logger.debug(this.node, 'DatabaseService registered in TypeDI container');
        }
        // ThingsBoard service will be auto-created by TypeDI since it's decorated with @Service()
        // We just need to ensure its dependencies are available
        if (!typedi_1.Container.has(thingsboard_service_1.ThingsBoardService)) {
            // Create service context for ThingsBoard service
            const serviceContext = {
                node: this.node,
                databaseService: this.databaseService,
                configManager: this.configManager
            };
            const thingsBoardService = new thingsboard_service_1.ThingsBoardService(serviceContext);
            typedi_1.Container.set(thingsboard_service_1.ThingsBoardService, thingsBoardService);
            logger_1.logger.debug(this.node, 'ThingsBoardService registered in TypeDI container');
        }
        logger_1.logger.debug(this.node, 'TypeDI container setup verified and all dependencies registered');
    }
    /**
     * Create authorization checker for routing-controllers
     */
    createAuthorizationChecker() {
        return async (action, roles) => {
            try {
                // Extract token from request
                const token = this.extractTokenFromRequest(action.request);
                if (!token) {
                    logger_1.logger.debug(this.node, 'Authorization failed: No token provided');
                    return false;
                }
                // Verify token using our existing auth service
                const payload = await this.authService.verifyToken(token);
                if (!payload) {
                    logger_1.logger.debug(this.node, 'Authorization failed: Invalid token');
                    return false;
                }
                // Store user in request for currentUserChecker
                action.request.user = payload;
                // If no specific roles required, just check if authenticated
                if (!roles || roles.length === 0) {
                    logger_1.logger.debug(this.node, 'Authorization successful: User authenticated');
                    return true;
                }
                // Check roles if specified
                const hasRequiredRole = this.checkUserRoles(payload, roles);
                logger_1.logger.debug(this.node, 'Authorization check completed', {
                    userId: payload.user_id,
                    requiredRoles: roles,
                    hasAccess: hasRequiredRole
                });
                return hasRequiredRole;
            }
            catch (error) {
                logger_1.logger.warn(this.node, 'Authorization check failed', {
                    error: error.message
                });
                return false;
            }
        };
    }
    /**
     * Create current user checker for routing-controllers
     */
    createCurrentUserChecker() {
        return async (action) => {
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
            }
            catch (error) {
                logger_1.logger.warn(this.node, 'Current user check failed', {
                    error: error.message
                });
                return null;
            }
        };
    }
    /**
     * Extract JWT token from request headers
     */
    extractTokenFromRequest(request) {
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        return null;
    }
    /**
     * Check if user has required roles
     */
    checkUserRoles(user, requiredRoles) {
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
    setupCustomErrorHandling(RED) {
        RED.httpNode.use(this.configManager.get('apiPrefix'), (error, req, res, next) => {
            logger_1.logger.error(this.node, 'routing-controllers error', {
                error: error.message,
                path: req.path,
                method: req.method,
                errorType: error.constructor.name,
                stack: this.configManager.isEnabled('enableDebugMode') ? error.stack : undefined
            });
            // Handle ApiError instances (our custom authentication/business logic errors)
            if (error.name === 'ApiError' && error.statusCode) {
                return res.status(error.statusCode).json(Object.assign({ error: error.type, message: error.message, timestamp: new Date().toISOString() }, (error.details && { details: error.details })));
            }
            // Handle routing-controllers validation errors (with httpCode)
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
            // Generic error handler for unexpected errors
            logger_1.logger.error(this.node, 'Unhandled error in routing-controllers', {
                errorName: error.name,
                errorMessage: error.message,
                path: req.path,
                method: req.method
            });
            res.status(500).json({
                error: 'INTERNAL_ERROR',
                message: 'An unexpected error occurred',
                timestamp: new Date().toISOString()
            });
        });
        logger_1.logger.debug(this.node, 'Custom error handling setup completed');
    }
    /**
     * Log registered routes for debugging
     */
    logRegisteredRoutes() {
        if (this.configManager.isEnabled('enableDebugMode')) {
            logger_1.logger.info(this.node, 'routing-controllers routes registered:', {
                prefix: this.configManager.get('apiPrefix'),
                controllers: 'Auto-discovered via glob patterns',
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
                    'DELETE /devices/:id',
                    'POST /thingsboard/rpc/oneway/:id',
                    'POST /thingsboard/rpc/telemetry/:id',
                    'POST /thingsboard/rpc/control/:id',
                    'POST /thingsboard/rpc/custom/:id',
                    'GET /thingsboard/health',
                    'GET /thingsboard/stats'
                ]
            });
        }
    }
    /**
     * Get integration status for monitoring
     */
    getStatus() {
        return {
            enabled: true,
            routePrefix: this.configManager.get('apiPrefix'),
            controllersRegistered: 'Auto-discovered via glob patterns',
            authorizationEnabled: true,
            validationEnabled: true,
            errorHandlingEnabled: true
        };
    }
}
exports.RoutingControllersRoutes = RoutingControllersRoutes;

"use strict";
/**
 * @fileoverview Hybrid Routes Setup - Proof of Concept
 * Integrates routing-controllers with existing Node-RED Express server
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoutingControllersRoutes = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const logger_1 = require("../utils/logger");
const auth_service_1 = require("../services/auth.service");
const database_service_1 = require("../services/database.service");
const health_controller_1 = require("../controllers/health.controller");
const auth_controller_1 = require("../controllers/auth.controller");
const user_controller_1 = require("../controllers/user.controller");
const device_controller_1 = require("../controllers/device.controller");
const enhanced_validation_middleware_1 = require("../middleware/enhanced-validation.middleware");
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
            // Configure routing-controllers with Node-RED's Express server
            const app = (0, routing_controllers_1.useExpressServer)(RED.httpNode, {
                // Route configuration - now using main API prefix
                routePrefix: this.configManager.get('apiPrefix'),
                // Controllers to register
                controllers: [health_controller_1.HealthController, auth_controller_1.AuthController, user_controller_1.UserController, device_controller_1.DeviceController],
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
     * Ensure TypeDI container has all required dependencies
     */
    ensureContainerSetup() {
        // Verify all required services are in the container
        if (!typedi_1.Container.has('node')) {
            typedi_1.Container.set('node', this.node);
        }
        if (!typedi_1.Container.has('configManager')) {
            typedi_1.Container.set('configManager', this.configManager);
        }
        if (!typedi_1.Container.has(auth_service_1.AuthService)) {
            typedi_1.Container.set(auth_service_1.AuthService, this.authService);
        }
        if (!typedi_1.Container.has(database_service_1.DatabaseService)) {
            typedi_1.Container.set(database_service_1.DatabaseService, this.databaseService);
        }
        logger_1.logger.debug(this.node, 'TypeDI container setup verified');
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
        logger_1.logger.debug(this.node, 'Custom error handling setup completed');
    }
    /**
     * Log registered routes for debugging
     */
    logRegisteredRoutes() {
        if (this.configManager.isEnabled('enableDebugMode')) {
            logger_1.logger.info(this.node, 'routing-controllers routes registered:', {
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
    getStatus() {
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
exports.RoutingControllersRoutes = RoutingControllersRoutes;

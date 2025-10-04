"use strict";
/**
 * @fileoverview Authentication middleware
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthMiddleware = void 0;
const auth_validator_1 = require("../validators/auth.validator");
const response_helper_1 = require("../utils/response.helper");
const logger_1 = require("../utils/logger");
/**
 * Authentication middleware class
 */
class AuthMiddleware {
    constructor(authService, node) {
        /**
         * JWT authentication middleware
         */
        this.authenticate = async (req, res, next) => {
            try {
                // Extract token from authorization header
                const token = await this.authValidator.validateAndExtractToken(req.headers);
                // Verify token
                const decoded = await this.authService.verifyToken(token);
                // Attach user to request
                req.user = decoded;
                req.token = token;
                logger_1.logger.debug(this.node, `User authenticated: ${decoded.user_id}`);
                next();
            }
            catch (error) {
                logger_1.logger.warn(this.node, `Authentication failed: ${error.message}`);
                response_helper_1.ResponseHelper.authenticationError(res, error.message, this.node);
            }
        };
        /**
         * Admin authorization middleware
         */
        this.requireAdmin = (req, res, next) => {
            const user = req.user;
            if (!user) {
                return response_helper_1.ResponseHelper.authenticationError(res, 'Authentication required', this.node);
            }
            if (user.is_admin !== 1) {
                return response_helper_1.ResponseHelper.authorizationError(res, 'Admin access required', this.node);
            }
            logger_1.logger.debug(this.node, `Admin access granted to user: ${user.user_id}`);
            next();
        };
        /**
         * Customer access middleware (user can only access their own customer data)
         */
        this.requireCustomerAccess = (req, res, next) => {
            const user = req.user;
            if (!user) {
                return response_helper_1.ResponseHelper.authenticationError(res, 'Authentication required', this.node);
            }
            const requestedCustomerId = req.params.customerId || req.query.customer_id;
            // Admin can access any customer
            if (user.is_admin === 1) {
                logger_1.logger.debug(this.node, `Admin access granted to customer: ${requestedCustomerId}`);
                return next();
            }
            // Regular user can only access their own customer
            if (requestedCustomerId && requestedCustomerId !== user.customer_id) {
                logger_1.logger.warn(this.node, `User ${user.user_id} attempted to access customer ${requestedCustomerId}`);
                return response_helper_1.ResponseHelper.authorizationError(res, 'Access denied: You can only access your own customer data', this.node);
            }
            logger_1.logger.debug(this.node, `Customer access granted to user: ${user.user_id}`);
            next();
        };
        /**
         * Optional authentication middleware (doesn't fail if no token)
         */
        this.optionalAuth = async (req, _res, next) => {
            try {
                const authHeader = req.headers.authorization;
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    // No token provided, continue without authentication
                    return next();
                }
                const token = this.authValidator.extractTokenFromHeader(authHeader);
                const decoded = await this.authService.verifyToken(token);
                // Attach user to request
                req.user = decoded;
                req.token = token;
                logger_1.logger.debug(this.node, `Optional auth: User authenticated: ${decoded.user_id}`);
            }
            catch (error) {
                // Log warning but don't fail the request
                logger_1.logger.warn(this.node, `Optional auth failed: ${error.message}`);
            }
            next();
        };
        /**
         * Role-based access middleware
         */
        this.requireRole = (allowedRoles) => {
            return (req, res, next) => {
                const user = req.user;
                if (!user) {
                    return response_helper_1.ResponseHelper.authenticationError(res, 'Authentication required', this.node);
                }
                const userRole = user.iot_dynamic_role;
                if (!allowedRoles.includes(userRole)) {
                    logger_1.logger.warn(this.node, `User ${user.user_id} with role ${userRole} denied access. Required roles: ${allowedRoles.join(', ')}`);
                    return response_helper_1.ResponseHelper.authorizationError(res, `Access denied: Required role(s): ${allowedRoles.join(', ')}`, this.node);
                }
                logger_1.logger.debug(this.node, `Role-based access granted to user: ${user.user_id} with role: ${userRole}`);
                next();
            };
        };
        this.authService = authService;
        this.authValidator = new auth_validator_1.AuthValidator();
        this.node = node;
    }
}
exports.AuthMiddleware = AuthMiddleware;

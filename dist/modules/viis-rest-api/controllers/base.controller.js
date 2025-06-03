"use strict";
/**
 * @fileoverview Base controller class with common functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseController = void 0;
const response_helper_1 = require("../utils/response.helper");
const logger_1 = require("../utils/logger");
/**
 * Base controller class that all controllers should extend
 */
class BaseController {
    constructor(node) {
        this.node = node;
        this.context = { node };
    }
    /**
     * Create request context
     */
    createContext(req) {
        return {
            node: this.node,
            user: req.user,
            requestId: this.generateRequestId(),
            startTime: Date.now()
        };
    }
    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * Async handler wrapper for error handling
     */
    asyncHandler(fn) {
        return (req, res, next) => {
            const context = this.createContext(req);
            // Log request
            logger_1.logger.info(this.node, `${req.method} ${req.path}`, {
                requestId: context.requestId,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            Promise.resolve(fn(req, res, next))
                .then(() => {
                // Log response time
                const duration = Date.now() - (context.startTime || 0);
                logger_1.logger.info(this.node, `Request completed in ${duration}ms`, {
                    requestId: context.requestId,
                    statusCode: res.statusCode
                });
            })
                .catch((error) => {
                logger_1.logger.error(this.node, `Request failed: ${error.message}`, {
                    requestId: context.requestId,
                    error: error.stack
                });
                response_helper_1.ResponseHelper.error(res, error, undefined, undefined, this.node);
            });
        };
    }
    /**
     * Success response helper
     */
    success(res, data, statusCode = 200, message) {
        response_helper_1.ResponseHelper.success(res, data, statusCode, message);
    }
    /**
     * Error response helper
     */
    error(res, error, statusCode = 500, details) {
        response_helper_1.ResponseHelper.error(res, error, statusCode, details, this.node);
    }
    /**
     * Validation error helper
     */
    validationError(res, message, details) {
        response_helper_1.ResponseHelper.validationError(res, message, details, this.node);
    }
    /**
     * Authentication error helper
     */
    authenticationError(res, message) {
        response_helper_1.ResponseHelper.authenticationError(res, message, this.node);
    }
    /**
     * Authorization error helper
     */
    authorizationError(res, message) {
        response_helper_1.ResponseHelper.authorizationError(res, message, this.node);
    }
    /**
     * Not found error helper
     */
    notFoundError(res, message) {
        response_helper_1.ResponseHelper.notFoundError(res, message, this.node);
    }
    /**
     * Extract pagination parameters from query
     */
    getPaginationParams(req) {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 10, 100);
        const offset = (page - 1) * limit;
        return { page, limit, offset };
    }
    /**
     * Extract user from authenticated request
     */
    getAuthenticatedUser(req) {
        return req.user;
    }
    /**
     * Check if user is admin
     */
    isAdmin(req) {
        const user = this.getAuthenticatedUser(req);
        return user && user.is_admin === 1;
    }
    /**
     * Get user's customer ID
     */
    getUserCustomerId(req) {
        const user = this.getAuthenticatedUser(req);
        return user ? user.customer_id : null;
    }
}
exports.BaseController = BaseController;

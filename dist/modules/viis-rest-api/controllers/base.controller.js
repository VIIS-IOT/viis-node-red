"use strict";
/**
 * @fileoverview Base controller class with common functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseController = void 0;
const common_types_1 = require("../types/common.types");
const response_helper_1 = require("../utils/response.helper");
const logger_1 = require("../utils/logger");
/**
 * Base controller class that all controllers should extend
 */
class BaseController {
    constructor(node, configManager) {
        this.node = node;
        this.configManager = configManager;
        this.context = { node };
        this.controllerName = this.constructor.name;
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
     * Async handler wrapper for error handling with improved logging
     */
    asyncHandler(fn, operationName) {
        return (req, res, next) => {
            var _a, _b;
            const context = this.createContext(req);
            const operation = operationName || `${req.method} ${req.path}`;
            // Enhanced logging for development
            if ((_a = this.configManager) === null || _a === void 0 ? void 0 : _a.isEnabled('enableDebugMode')) {
                this.logDebug(`Starting operation: ${operation}`, {
                    requestId: context.requestId,
                    ip: req.ip,
                    userAgent: (_b = req.get('User-Agent')) === null || _b === void 0 ? void 0 : _b.substring(0, 100),
                    body: this.sanitizeLogData(req.body),
                    query: req.query,
                    params: req.params
                });
            }
            else {
                this.logInfo(`${operation}`, {
                    requestId: context.requestId,
                    ip: req.ip
                });
            }
            Promise.resolve(fn(req, res, next))
                .then(() => {
                const duration = Date.now() - (context.startTime || 0);
                this.logInfo(`Operation completed: ${operation} (${duration}ms)`, {
                    requestId: context.requestId,
                    statusCode: res.statusCode,
                    duration
                });
            })
                .catch((error) => {
                var _a;
                const duration = Date.now() - (context.startTime || 0);
                this.logError(`Operation failed: ${operation} (${duration}ms)`, {
                    requestId: context.requestId,
                    error: error.message,
                    stack: ((_a = this.configManager) === null || _a === void 0 ? void 0 : _a.isEnabled('enableDebugMode')) ? error.stack : undefined,
                    duration
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
    /**
     * Validate required parameters
     */
    validateRequired(value, fieldName) {
        if (value === null || value === undefined || value === '') {
            throw new common_types_1.ApiError('VALIDATION_ERROR', `${fieldName} is required`, 400);
        }
    }
    /**
     * Validate string parameter
     */
    validateString(value, fieldName, minLength = 1) {
        this.validateRequired(value, fieldName);
        if (typeof value !== 'string' || value.trim().length < minLength) {
            throw new common_types_1.ApiError('VALIDATION_ERROR', `${fieldName} must be a non-empty string`, 400);
        }
    }
    /**
     * Validate numeric parameter
     */
    validateNumber(value, fieldName, min, max) {
        this.validateRequired(value, fieldName);
        if (typeof value !== 'number' || isNaN(value)) {
            throw new common_types_1.ApiError('VALIDATION_ERROR', `${fieldName} must be a valid number`, 400);
        }
        if (min !== undefined && value < min) {
            throw new common_types_1.ApiError('VALIDATION_ERROR', `${fieldName} must be at least ${min}`, 400);
        }
        if (max !== undefined && value > max) {
            throw new common_types_1.ApiError('VALIDATION_ERROR', `${fieldName} must be at most ${max}`, 400);
        }
    }
    // Enhanced logging methods with controller context
    logInfo(message, data) {
        logger_1.logger.info(this.node, `[${this.controllerName}] ${message}`, data);
    }
    logError(message, data) {
        logger_1.logger.error(this.node, `[${this.controllerName}] ${message}`, data);
    }
    logWarn(message, data) {
        logger_1.logger.warn(this.node, `[${this.controllerName}] ${message}`, data);
    }
    logDebug(message, data) {
        var _a;
        if ((_a = this.configManager) === null || _a === void 0 ? void 0 : _a.isEnabled('enableDebugMode')) {
            logger_1.logger.debug(this.node, `[${this.controllerName}] ${message}`, data);
        }
    }
    /**
     * Sanitize data for logging (remove sensitive information)
     */
    sanitizeLogData(data) {
        if (!data || typeof data !== 'object')
            return data;
        const sanitized = Object.assign({}, data);
        const sensitiveFields = ['password', 'pwd', 'token', 'secret', 'key', 'authorization'];
        sensitiveFields.forEach(field => {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        });
        return sanitized;
    }
    /**
     * Execute operation with standardized error handling and logging
     */
    async executeOperation(operationName, operation, context) {
        const startTime = Date.now();
        this.logDebug(`Starting operation: ${operationName}`, context);
        try {
            const result = await operation();
            const duration = Date.now() - startTime;
            this.logDebug(`Operation completed: ${operationName} (${duration}ms)`, { context, duration });
            return result;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            this.logError(`Operation failed: ${operationName} (${duration}ms)`, {
                error: error.message,
                context,
                duration
            });
            throw error;
        }
    }
}
exports.BaseController = BaseController;

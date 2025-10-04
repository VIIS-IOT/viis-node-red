"use strict";
/**
 * @fileoverview Response helper utilities for consistent API responses
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseHelper = void 0;
const common_types_1 = require("../types/common.types");
const logger_1 = require("./logger");
/**
 * Response helper class for standardized API responses
 */
class ResponseHelper {
    /**
     * Send success response
     */
    static success(res, data, statusCode = 200, message) {
        const response = {
            result: data,
            timestamp: new Date().toISOString()
        };
        if (message) {
            response.message = message;
        }
        res.status(statusCode).json(response);
    }
    /**
     * Send error response
     */
    static error(res, error, statusCode, details, node) {
        let response;
        if (error instanceof common_types_1.ApiError) {
            response = {
                error: error.type,
                message: error.message,
                timestamp: new Date().toISOString()
            };
            if (error.details) {
                response.details = error.details;
            }
            statusCode = error.statusCode;
        }
        else {
            response = {
                error: common_types_1.ErrorType.INTERNAL_ERROR,
                message: error,
                timestamp: new Date().toISOString()
            };
            if (details) {
                response.details = details;
            }
            statusCode = statusCode || 500;
        }
        // Log error if node is provided
        if (node) {
            logger_1.logger.error(node, `API Error: ${response.message}`, response.details);
        }
        res.status(statusCode).json(response);
    }
    /**
     * Send validation error response
     */
    static validationError(res, message, details, node) {
        const error = new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, message, 400, details);
        this.error(res, error, undefined, undefined, node);
    }
    /**
     * Send authentication error response
     */
    static authenticationError(res, message = 'Authentication required', node) {
        const error = new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, message, 401);
        this.error(res, error, undefined, undefined, node);
    }
    /**
     * Send authorization error response
     */
    static authorizationError(res, message = 'Insufficient permissions', node) {
        const error = new common_types_1.ApiError(common_types_1.ErrorType.AUTHORIZATION_ERROR, message, 403);
        this.error(res, error, undefined, undefined, node);
    }
    /**
     * Send not found error response
     */
    static notFoundError(res, message = 'Resource not found', node) {
        const error = new common_types_1.ApiError(common_types_1.ErrorType.NOT_FOUND_ERROR, message, 404);
        this.error(res, error, undefined, undefined, node);
    }
    /**
     * Send rate limit error response
     */
    static rateLimitError(res, message = 'Rate limit exceeded', node) {
        const error = new common_types_1.ApiError(common_types_1.ErrorType.RATE_LIMIT_ERROR, message, 429);
        this.error(res, error, undefined, undefined, node);
    }
    /**
     * Send database error response
     */
    static databaseError(res, message = 'Database operation failed', node) {
        const error = new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, message, 500);
        this.error(res, error, undefined, undefined, node);
    }
}
exports.ResponseHelper = ResponseHelper;

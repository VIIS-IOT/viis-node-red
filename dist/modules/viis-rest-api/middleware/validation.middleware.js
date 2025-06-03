"use strict";
/**
 * @fileoverview Validation middleware
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationMiddleware = void 0;
const joi_1 = __importDefault(require("joi"));
const response_helper_1 = require("../utils/response.helper");
const logger_1 = require("../utils/logger");
/**
 * Validation middleware class
 */
class ValidationMiddleware {
    constructor(node) {
        /**
         * Validate request body
         */
        this.validateBody = (schema) => {
            return (req, res, next) => {
                try {
                    const { error, value } = schema.validate(req.body, {
                        abortEarly: false,
                        stripUnknown: true,
                        convert: true
                    });
                    if (error) {
                        const details = error.details.map(detail => {
                            var _a;
                            return ({
                                field: detail.path.join('.'),
                                message: detail.message,
                                value: (_a = detail.context) === null || _a === void 0 ? void 0 : _a.value
                            });
                        });
                        logger_1.logger.warn(this.node, `Body validation failed: ${error.message}`);
                        return response_helper_1.ResponseHelper.validationError(res, 'Request body validation failed', details, this.node);
                    }
                    // Replace request body with validated and sanitized data
                    req.body = value;
                    next();
                }
                catch (error) {
                    logger_1.logger.error(this.node, `Body validation error: ${error.message}`);
                    response_helper_1.ResponseHelper.validationError(res, 'Body validation error occurred', undefined, this.node);
                }
            };
        };
        /**
         * Validate request query parameters
         */
        this.validateQuery = (schema) => {
            return (req, res, next) => {
                try {
                    const { error, value } = schema.validate(req.query, {
                        abortEarly: false,
                        stripUnknown: true,
                        convert: true
                    });
                    if (error) {
                        const details = error.details.map(detail => {
                            var _a;
                            return ({
                                field: detail.path.join('.'),
                                message: detail.message,
                                value: (_a = detail.context) === null || _a === void 0 ? void 0 : _a.value
                            });
                        });
                        logger_1.logger.warn(this.node, `Query validation failed: ${error.message}`);
                        return response_helper_1.ResponseHelper.validationError(res, 'Query parameters validation failed', details, this.node);
                    }
                    // Replace request query with validated and sanitized data
                    req.query = value;
                    next();
                }
                catch (error) {
                    logger_1.logger.error(this.node, `Query validation error: ${error.message}`);
                    response_helper_1.ResponseHelper.validationError(res, 'Query validation error occurred', undefined, this.node);
                }
            };
        };
        /**
         * Validate request parameters
         */
        this.validateParams = (schema) => {
            return (req, res, next) => {
                try {
                    const { error, value } = schema.validate(req.params, {
                        abortEarly: false,
                        stripUnknown: true,
                        convert: true
                    });
                    if (error) {
                        const details = error.details.map(detail => {
                            var _a;
                            return ({
                                field: detail.path.join('.'),
                                message: detail.message,
                                value: (_a = detail.context) === null || _a === void 0 ? void 0 : _a.value
                            });
                        });
                        logger_1.logger.warn(this.node, `Params validation failed: ${error.message}`);
                        return response_helper_1.ResponseHelper.validationError(res, 'URL parameters validation failed', details, this.node);
                    }
                    // Replace request params with validated and sanitized data
                    req.params = value;
                    next();
                }
                catch (error) {
                    logger_1.logger.error(this.node, `Params validation error: ${error.message}`);
                    response_helper_1.ResponseHelper.validationError(res, 'Parameters validation error occurred', undefined, this.node);
                }
            };
        };
        /**
         * Validate pagination parameters
         */
        this.validatePagination = (req, res, next) => {
            const paginationSchema = joi_1.default.object({
                page: joi_1.default.number().integer().min(1).default(1),
                limit: joi_1.default.number().integer().min(1).max(100).default(10),
                offset: joi_1.default.number().integer().min(0).optional()
            });
            this.validateQuery(paginationSchema)(req, res, next);
        };
        /**
         * Validate common ID parameter
         */
        this.validateIdParam = (paramName = 'id') => {
            const schema = joi_1.default.object({
                [paramName]: joi_1.default.string().required().min(1).max(255).messages({
                    'string.empty': `${paramName} is required`,
                    'string.min': `${paramName} must be at least 1 character`,
                    'string.max': `${paramName} must not exceed 255 characters`,
                    'any.required': `${paramName} is required`
                })
            });
            return this.validateParams(schema);
        };
        /**
         * Validate date range parameters
         */
        this.validateDateRange = (req, res, next) => {
            const dateRangeSchema = joi_1.default.object({
                startDate: joi_1.default.date().iso().optional(),
                endDate: joi_1.default.date().iso().optional(),
                start_date: joi_1.default.date().iso().optional(),
                end_date: joi_1.default.date().iso().optional()
            }).custom((value, helpers) => {
                const startDate = value.startDate || value.start_date;
                const endDate = value.endDate || value.end_date;
                if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
                    return helpers.error('date.range', {
                        message: 'Start date must be before end date'
                    });
                }
                return value;
            });
            this.validateQuery(dateRangeSchema)(req, res, next);
        };
        this.node = node;
    }
}
exports.ValidationMiddleware = ValidationMiddleware;

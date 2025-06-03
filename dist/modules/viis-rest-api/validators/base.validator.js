"use strict";
/**
 * @fileoverview Base validator class using Joi for validation
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseValidator = void 0;
const joi_1 = __importDefault(require("joi"));
const common_types_1 = require("../types/common.types");
/**
 * Base validator class that all validators should extend
 */
class BaseValidator {
    /**
     * Validate data against schema
     */
    async validate(data, schema) {
        if (!schema) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, 'Validation schema not provided', 500);
        }
        try {
            const { error, value } = schema.validate(data, {
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
                throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Validation failed', 400, details);
            }
            return value;
        }
        catch (error) {
            if (error instanceof common_types_1.ApiError) {
                throw error;
            }
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Validation error occurred', 400, { originalError: error.message });
        }
    }
    /**
     * Validate pagination parameters
     */
    validatePagination(data) {
        return this.validate(data, BaseValidator.commonSchemas.pagination);
    }
    /**
     * Validate ID parameter
     */
    validateId(id) {
        return this.validate({ id }, joi_1.default.object({ id: BaseValidator.commonSchemas.id }));
    }
    /**
     * Validate email
     */
    validateEmail(email) {
        return this.validate({ email }, joi_1.default.object({ email: BaseValidator.commonSchemas.email }));
    }
    /**
     * Create custom validation schema
     */
    createSchema(schemaDefinition) {
        return joi_1.default.object(schemaDefinition);
    }
    /**
     * Validate query parameters
     */
    async validateQuery(query, schema) {
        return this.validate(query, schema);
    }
    /**
     * Validate request body
     */
    async validateBody(body, schema) {
        return this.validate(body, schema);
    }
    /**
     * Validate request parameters
     */
    async validateParams(params, schema) {
        return this.validate(params, schema);
    }
}
exports.BaseValidator = BaseValidator;
/**
 * Common validation schemas
 */
BaseValidator.commonSchemas = {
    id: joi_1.default.string().required().min(1).max(255),
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string().min(6).max(255).required(),
    name: joi_1.default.string().min(1).max(255).required(),
    optionalName: joi_1.default.string().min(1).max(255).optional(),
    phone: joi_1.default.string().pattern(/^[+]?[\d\s\-()]+$/).optional(),
    boolean: joi_1.default.boolean().optional(),
    number: joi_1.default.number().integer().min(0).optional(),
    positiveNumber: joi_1.default.number().integer().min(1).optional(),
    pagination: joi_1.default.object({
        page: joi_1.default.number().integer().min(1).default(1),
        limit: joi_1.default.number().integer().min(1).max(100).default(10)
    }).optional(),
    search: joi_1.default.string().min(1).max(255).optional(),
    customerId: joi_1.default.string().min(1).max(255).optional(),
    deviceId: joi_1.default.string().min(1).max(255).required(),
    timestamp: joi_1.default.date().iso().optional(),
    dateRange: joi_1.default.object({
        startDate: joi_1.default.date().iso().optional(),
        endDate: joi_1.default.date().iso().optional()
    }).optional()
};

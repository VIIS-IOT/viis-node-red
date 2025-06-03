"use strict";
/**
 * @fileoverview User validator
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserValidator = void 0;
const joi_1 = __importDefault(require("joi"));
const base_validator_1 = require("./base.validator");
/**
 * User validator class
 */
class UserValidator extends base_validator_1.BaseValidator {
    /**
     * Validate user query parameters
     */
    async validateUserQuery(data) {
        return this.validate(data, UserValidator.userQuerySchema);
    }
    /**
     * Validate user ID parameter
     */
    async validateUserIdParam(data) {
        return this.validate(data, UserValidator.userIdParamSchema);
    }
    /**
     * Validate create user request
     */
    async validateCreateUser(data) {
        return this.validate(data, UserValidator.createUserSchema);
    }
    /**
     * Validate update user request
     */
    async validateUpdateUser(data) {
        return this.validate(data, UserValidator.updateUserSchema);
    }
    /**
     * Validate email uniqueness (for create/update operations)
     */
    async validateEmailFormat(email) {
        const emailSchema = joi_1.default.string().email().required();
        try {
            await emailSchema.validateAsync(email);
            return true;
        }
        catch (_a) {
            return false;
        }
    }
    /**
     * Validate username format
     */
    async validateUsernameFormat(username) {
        const usernameSchema = joi_1.default.string().min(1).max(255).pattern(/^[a-zA-Z0-9_.-]+$/).required();
        try {
            await usernameSchema.validateAsync(username);
            return true;
        }
        catch (_a) {
            return false;
        }
    }
    /**
     * Validate password strength
     */
    async validatePasswordStrength(password) {
        const passwordSchema = joi_1.default.string()
            .min(6)
            .max(255)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
            .required()
            .messages({
            'string.min': 'Password must be at least 6 characters',
            'string.max': 'Password must not exceed 255 characters',
            'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, and one number'
        });
        try {
            await passwordSchema.validateAsync(password);
            return { valid: true };
        }
        catch (error) {
            return { valid: false, message: error.message };
        }
    }
}
exports.UserValidator = UserValidator;
/**
 * User query parameters validation schema
 */
UserValidator.userQuerySchema = joi_1.default.object({
    page: joi_1.default.number().integer().min(1).default(1),
    limit: joi_1.default.number().integer().min(1).max(100).default(10),
    customer_id: joi_1.default.string().min(1).max(255).optional(),
    is_admin: joi_1.default.number().integer().valid(0, 1).optional(),
    iot_dynamic_role: joi_1.default.string().min(1).max(255).optional(),
    search: joi_1.default.string().min(1).max(255).optional(),
    is_deactivated: joi_1.default.number().integer().valid(0, 1).optional()
});
/**
 * User ID parameter validation schema
 */
UserValidator.userIdParamSchema = joi_1.default.object({
    userId: joi_1.default.string().required().min(1).max(255).messages({
        'string.empty': 'User ID is required',
        'string.min': 'User ID must be at least 1 character',
        'string.max': 'User ID must not exceed 255 characters',
        'any.required': 'User ID is required'
    })
});
/**
 * Create user request validation schema
 */
UserValidator.createUserSchema = joi_1.default.object({
    name: joi_1.default.string().required().min(1).max(255).messages({
        'string.empty': 'Username is required',
        'string.min': 'Username must be at least 1 character',
        'string.max': 'Username must not exceed 255 characters',
        'any.required': 'Username is required'
    }),
    first_name: joi_1.default.string().min(1).max(255).optional(),
    last_name: joi_1.default.string().min(1).max(255).optional(),
    email: joi_1.default.string().email().required().messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
    }),
    customer_id: joi_1.default.string().required().min(1).max(255).messages({
        'string.empty': 'Customer ID is required',
        'any.required': 'Customer ID is required'
    }),
    is_admin: joi_1.default.number().integer().valid(0, 1).default(0),
    iot_dynamic_role: joi_1.default.string().min(1).max(255).optional(),
    phone_number: joi_1.default.string().pattern(/^[+]?[\d\s\-()]+$/).optional().messages({
        'string.pattern.base': 'Please provide a valid phone number'
    }),
    password: joi_1.default.string().min(6).max(255).required().messages({
        'string.min': 'Password must be at least 6 characters',
        'string.max': 'Password must not exceed 255 characters',
        'any.required': 'Password is required'
    })
});
/**
 * Update user request validation schema
 */
UserValidator.updateUserSchema = joi_1.default.object({
    first_name: joi_1.default.string().min(1).max(255).optional(),
    last_name: joi_1.default.string().min(1).max(255).optional(),
    email: joi_1.default.string().email().optional().messages({
        'string.email': 'Please provide a valid email address'
    }),
    customer_id: joi_1.default.string().min(1).max(255).optional(),
    is_admin: joi_1.default.number().integer().valid(0, 1).optional(),
    iot_dynamic_role: joi_1.default.string().min(1).max(255).optional(),
    phone_number: joi_1.default.string().pattern(/^[+]?[\d\s\-()]+$/).optional().messages({
        'string.pattern.base': 'Please provide a valid phone number'
    }),
    is_deactivated: joi_1.default.number().integer().valid(0, 1).optional()
}).min(1).messages({
    'object.min': 'At least one field must be provided for update'
});

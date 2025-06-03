"use strict";
/**
 * @fileoverview Authentication validator
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthValidator = void 0;
const joi_1 = __importDefault(require("joi"));
const base_validator_1 = require("./base.validator");
/**
 * Authentication validator class
 */
class AuthValidator extends base_validator_1.BaseValidator {
    /**
     * Validate login request
     */
    async validateLogin(data) {
        return this.validate(data, AuthValidator.loginSchema);
    }
    /**
     * Validate token
     */
    async validateToken(data) {
        return this.validate(data, AuthValidator.tokenSchema);
    }
    /**
     * Validate authorization header
     */
    async validateAuthHeader(headers) {
        return this.validate(headers, AuthValidator.authHeaderSchema);
    }
    /**
     * Extract token from authorization header
     */
    extractTokenFromHeader(authHeader) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Invalid authorization header format');
        }
        return authHeader.substring(7); // Remove 'Bearer ' prefix
    }
    /**
     * Validate and extract token from request headers
     */
    async validateAndExtractToken(headers) {
        const validated = await this.validateAuthHeader(headers);
        return this.extractTokenFromHeader(validated.authorization);
    }
}
exports.AuthValidator = AuthValidator;
/**
 * Login request validation schema
 */
AuthValidator.loginSchema = joi_1.default.object({
    usr: joi_1.default.string().required().min(1).max(255).messages({
        'string.empty': 'Username or email is required',
        'string.min': 'Username or email must be at least 1 character',
        'string.max': 'Username or email must not exceed 255 characters',
        'any.required': 'Username or email is required'
    }),
    pwd: joi_1.default.string().required().min(1).max(255).messages({
        'string.empty': 'Password is required',
        'string.min': 'Password must be at least 1 character',
        'string.max': 'Password must not exceed 255 characters',
        'any.required': 'Password is required'
    })
});
/**
 * Token validation schema
 */
AuthValidator.tokenSchema = joi_1.default.object({
    token: joi_1.default.string().required().min(1).messages({
        'string.empty': 'Token is required',
        'string.min': 'Token must be at least 1 character',
        'any.required': 'Token is required'
    })
});
/**
 * Authorization header validation schema
 */
AuthValidator.authHeaderSchema = joi_1.default.object({
    authorization: joi_1.default.string()
        .pattern(/^Bearer\s+.+/)
        .required()
        .messages({
        'string.pattern.base': 'Authorization header must be in format "Bearer <token>"',
        'any.required': 'Authorization header is required'
    })
});

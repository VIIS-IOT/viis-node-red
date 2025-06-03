/**
 * @fileoverview Authentication validator
 */

import Joi from 'joi';
import { BaseValidator } from './base.validator';
import { LoginRequest } from '../types/auth.types';

/**
 * Authentication validator class
 */
export class AuthValidator extends BaseValidator {
    /**
     * Login request validation schema
     */
    private static loginSchema = Joi.object({
        usr: Joi.string().required().min(1).max(255).messages({
            'string.empty': 'Username or email is required',
            'string.min': 'Username or email must be at least 1 character',
            'string.max': 'Username or email must not exceed 255 characters',
            'any.required': 'Username or email is required'
        }),
        pwd: Joi.string().required().min(1).max(255).messages({
            'string.empty': 'Password is required',
            'string.min': 'Password must be at least 1 character',
            'string.max': 'Password must not exceed 255 characters',
            'any.required': 'Password is required'
        })
    });

    /**
     * Token validation schema
     */
    private static tokenSchema = Joi.object({
        token: Joi.string().required().min(1).messages({
            'string.empty': 'Token is required',
            'string.min': 'Token must be at least 1 character',
            'any.required': 'Token is required'
        })
    });

    /**
     * Authorization header validation schema
     */
    private static authHeaderSchema = Joi.object({
        authorization: Joi.string()
            .pattern(/^Bearer\s+.+/)
            .required()
            .messages({
                'string.pattern.base': 'Authorization header must be in format "Bearer <token>"',
                'any.required': 'Authorization header is required'
            })
    });

    /**
     * Validate login request
     */
    async validateLogin(data: any): Promise<LoginRequest> {
        return this.validate(data, AuthValidator.loginSchema);
    }

    /**
     * Validate token
     */
    async validateToken(data: any): Promise<{ token: string }> {
        return this.validate(data, AuthValidator.tokenSchema);
    }

    /**
     * Validate authorization header
     */
    async validateAuthHeader(headers: any): Promise<{ authorization: string }> {
        return this.validate(headers, AuthValidator.authHeaderSchema);
    }

    /**
     * Extract token from authorization header
     */
    extractTokenFromHeader(authHeader: string): string {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Invalid authorization header format');
        }
        return authHeader.substring(7); // Remove 'Bearer ' prefix
    }

    /**
     * Validate and extract token from request headers
     */
    async validateAndExtractToken(headers: any): Promise<string> {
        const validated = await this.validateAuthHeader(headers);
        return this.extractTokenFromHeader(validated.authorization);
    }
}

/**
 * @fileoverview User validator
 */

import Joi from 'joi';
import { BaseValidator } from './base.validator';
import { UserQueryParams, CreateUserRequest, UpdateUserRequest } from '../types/user.types';

/**
 * User validator class
 */
export class UserValidator extends BaseValidator {
    /**
     * User query parameters validation schema
     */
    private static userQuerySchema = Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(10),
        customer_id: Joi.string().min(1).max(255).optional(),
        is_admin: Joi.number().integer().valid(0, 1).optional(),
        iot_dynamic_role: Joi.string().min(1).max(255).optional(),
        search: Joi.string().min(1).max(255).optional(),
        is_deactivated: Joi.number().integer().valid(0, 1).optional()
    });

    /**
     * User ID parameter validation schema
     */
    private static userIdParamSchema = Joi.object({
        userId: Joi.string().required().min(1).max(255).messages({
            'string.empty': 'User ID is required',
            'string.min': 'User ID must be at least 1 character',
            'string.max': 'User ID must not exceed 255 characters',
            'any.required': 'User ID is required'
        })
    });

    /**
     * Create user request validation schema
     */
    private static createUserSchema = Joi.object({
        name: Joi.string().required().min(1).max(255).messages({
            'string.empty': 'Username is required',
            'string.min': 'Username must be at least 1 character',
            'string.max': 'Username must not exceed 255 characters',
            'any.required': 'Username is required'
        }),
        first_name: Joi.string().min(1).max(255).optional(),
        last_name: Joi.string().min(1).max(255).optional(),
        email: Joi.string().email().required().messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required'
        }),
        customer_id: Joi.string().required().min(1).max(255).messages({
            'string.empty': 'Customer ID is required',
            'any.required': 'Customer ID is required'
        }),
        is_admin: Joi.number().integer().valid(0, 1).default(0),
        iot_dynamic_role: Joi.string().min(1).max(255).optional(),
        phone_number: Joi.string().pattern(/^[+]?[\d\s\-()]+$/).optional().messages({
            'string.pattern.base': 'Please provide a valid phone number'
        }),
        password: Joi.string().min(6).max(255).required().messages({
            'string.min': 'Password must be at least 6 characters',
            'string.max': 'Password must not exceed 255 characters',
            'any.required': 'Password is required'
        })
    });

    /**
     * Update user request validation schema
     */
    private static updateUserSchema = Joi.object({
        first_name: Joi.string().min(1).max(255).optional(),
        last_name: Joi.string().min(1).max(255).optional(),
        email: Joi.string().email().optional().messages({
            'string.email': 'Please provide a valid email address'
        }),
        customer_id: Joi.string().min(1).max(255).optional(),
        is_admin: Joi.number().integer().valid(0, 1).optional(),
        iot_dynamic_role: Joi.string().min(1).max(255).optional(),
        phone_number: Joi.string().pattern(/^[+]?[\d\s\-()]+$/).optional().messages({
            'string.pattern.base': 'Please provide a valid phone number'
        }),
        is_deactivated: Joi.number().integer().valid(0, 1).optional()
    }).min(1).messages({
        'object.min': 'At least one field must be provided for update'
    });

    /**
     * Validate user query parameters
     */
    async validateUserQuery(data: any): Promise<UserQueryParams> {
        return this.validate(data, UserValidator.userQuerySchema);
    }

    /**
     * Validate user ID parameter
     */
    async validateUserIdParam(data: any): Promise<{ userId: string }> {
        return this.validate(data, UserValidator.userIdParamSchema);
    }

    /**
     * Validate create user request
     */
    async validateCreateUser(data: any): Promise<CreateUserRequest> {
        return this.validate(data, UserValidator.createUserSchema);
    }

    /**
     * Validate update user request
     */
    async validateUpdateUser(data: any): Promise<UpdateUserRequest> {
        return this.validate(data, UserValidator.updateUserSchema);
    }

    /**
     * Validate email uniqueness (for create/update operations)
     */
    async validateEmailFormat(email: string): Promise<boolean> {
        const emailSchema = Joi.string().email().required();
        try {
            await emailSchema.validateAsync(email);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate username format
     */
    async validateUsernameFormat(username: string): Promise<boolean> {
        const usernameSchema = Joi.string().min(1).max(255).pattern(/^[a-zA-Z0-9_.-]+$/).required();
        try {
            await usernameSchema.validateAsync(username);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate password strength
     */
    async validatePasswordStrength(password: string): Promise<{ valid: boolean; message?: string }> {
        const passwordSchema = Joi.string()
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
        } catch (error: any) {
            return { valid: false, message: error.message };
        }
    }
}

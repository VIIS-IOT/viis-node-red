/**
 * @fileoverview User validator using class-validator
 *
 * Demonstrates comprehensive user validation patterns that can be reused
 * across different API modules for user management functionality.
 */

import { Service } from 'typedi';
import { BaseValidator } from './base.validator';
import { GetUsersQueryDto, UserParamsDto, CreateUserDto, UpdateUserDto } from '../dto/user.dto';
import { UserQueryParams, CreateUserRequest, UpdateUserRequest } from '../types/user.types';

/**
 * User validator class using class-validator
 *
 * Provides validation methods for all user-related operations.
 * This serves as a template for user validation in other API modules.
 */
@Service()
export class UserValidator extends BaseValidator {

    /**
     * Validate user query parameters
     */
    async validateUserQuery(data: any): Promise<GetUsersQueryDto> {
        return this.validate(GetUsersQueryDto, data);
    }

    /**
     * Validate user ID parameter
     */
    async validateUserIdParam(data: any): Promise<UserParamsDto> {
        return this.validate(UserParamsDto, data);
    }

    /**
     * Validate create user request
     */
    async validateCreateUser(data: any): Promise<CreateUserDto> {
        return this.validate(CreateUserDto, data);
    }

    /**
     * Validate update user request
     */
    async validateUpdateUser(data: any): Promise<UpdateUserDto> {
        return this.validate(UpdateUserDto, data);
    }

    /**
     * Validate email format
     *
     * Simple email format validation using regex.
     * For production use, consider more sophisticated email validation.
     */
    validateEmailFormat(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Validate username format
     *
     * Ensures username contains only allowed characters.
     */
    validateUsernameFormat(username: string): boolean {
        const usernameRegex = /^[a-zA-Z0-9_.-]+$/;
        return usernameRegex.test(username) && username.length >= 1 && username.length <= 255;
    }

    /**
     * Validate password strength
     *
     * Checks for minimum security requirements.
     * Can be extended with more sophisticated password policies.
     */
    validatePasswordStrength(password: string): { valid: boolean; message?: string } {
        if (password.length < 6) {
            return { valid: false, message: 'Password must be at least 6 characters' };
        }

        if (password.length > 255) {
            return { valid: false, message: 'Password must not exceed 255 characters' };
        }

        // Check for at least one lowercase, uppercase, and digit
        const hasLowercase = /[a-z]/.test(password);
        const hasUppercase = /[A-Z]/.test(password);
        const hasDigit = /\d/.test(password);

        if (!hasLowercase || !hasUppercase || !hasDigit) {
            return {
                valid: false,
                message: 'Password must contain at least one lowercase letter, one uppercase letter, and one number'
            };
        }

        return { valid: true };
    }

    /**
     * Validate user permissions
     *
     * Helper method to validate user role and permission combinations.
     * Useful for authorization checks in user management endpoints.
     */
    validateUserPermissions(isAdmin: boolean, dynamicRole?: string): { valid: boolean; message?: string } {
        // Admin users don't need dynamic roles
        if (isAdmin) {
            return { valid: true };
        }

        // Non-admin users should have a dynamic role
        if (!dynamicRole || dynamicRole.trim().length === 0) {
            return {
                valid: false,
                message: 'Non-admin users must have a dynamic role assigned'
            };
        }

        return { valid: true };
    }
}

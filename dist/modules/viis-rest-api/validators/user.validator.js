"use strict";
/**
 * @fileoverview User validator using class-validator
 *
 * Demonstrates comprehensive user validation patterns that can be reused
 * across different API modules for user management functionality.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserValidator = void 0;
const typedi_1 = require("typedi");
const base_validator_1 = require("./base.validator");
const user_dto_1 = require("../dto/user.dto");
/**
 * User validator class using class-validator
 *
 * Provides validation methods for all user-related operations.
 * This serves as a template for user validation in other API modules.
 */
let UserValidator = class UserValidator extends base_validator_1.BaseValidator {
    /**
     * Validate user query parameters
     */
    async validateUserQuery(data) {
        return this.validate(user_dto_1.GetUsersQueryDto, data);
    }
    /**
     * Validate user ID parameter
     */
    async validateUserIdParam(data) {
        return this.validate(user_dto_1.UserParamsDto, data);
    }
    /**
     * Validate create user request
     */
    async validateCreateUser(data) {
        return this.validate(user_dto_1.CreateUserDto, data);
    }
    /**
     * Validate update user request
     */
    async validateUpdateUser(data) {
        return this.validate(user_dto_1.UpdateUserDto, data);
    }
    /**
     * Validate email format
     *
     * Simple email format validation using regex.
     * For production use, consider more sophisticated email validation.
     */
    validateEmailFormat(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    /**
     * Validate username format
     *
     * Ensures username contains only allowed characters.
     */
    validateUsernameFormat(username) {
        const usernameRegex = /^[a-zA-Z0-9_.-]+$/;
        return usernameRegex.test(username) && username.length >= 1 && username.length <= 255;
    }
    /**
     * Validate password strength
     *
     * Checks for minimum security requirements.
     * Can be extended with more sophisticated password policies.
     */
    validatePasswordStrength(password) {
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
    validateUserPermissions(isAdmin, dynamicRole) {
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
};
exports.UserValidator = UserValidator;
exports.UserValidator = UserValidator = __decorate([
    (0, typedi_1.Service)()
], UserValidator);

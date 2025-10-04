"use strict";
/**
 * @fileoverview Authentication DTOs with enhanced class-validator decorators
 *
 * This module provides comprehensive validation DTOs for authentication operations
 * using advanced class-validator decorators and routing-controllers integration.
 *
 * Features:
 * - Enhanced validation with custom error messages
 * - Support for nested object validation
 * - Enum validation for role-based access
 * - Array validation with proper type transformation
 * - Custom validation decorators for business logic
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefreshTokenDto = exports.PasswordResetDto = exports.PasswordResetRequestDto = exports.ChangePasswordDto = exports.RegisterDto = exports.UserProfileDto = exports.TokenDto = exports.LoginDto = exports.AuthMethod = exports.UserRole = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const custom_validators_1 = require("../validators/custom.validators");
/**
 * User role enumeration for validation
 */
var UserRole;
(function (UserRole) {
    UserRole["ADMIN"] = "admin";
    UserRole["USER"] = "user";
    UserRole["VIEWER"] = "viewer";
    UserRole["OPERATOR"] = "operator";
})(UserRole || (exports.UserRole = UserRole = {}));
/**
 * Authentication method enumeration
 */
var AuthMethod;
(function (AuthMethod) {
    AuthMethod["PASSWORD"] = "password";
    AuthMethod["TOKEN"] = "token";
    AuthMethod["REFRESH"] = "refresh";
})(AuthMethod || (exports.AuthMethod = AuthMethod = {}));
/**
 * Enhanced login request DTO with comprehensive validation
 *
 * @example
 * ```json
 * {
 *   "usr": "admin@example.com",
 *   "pwd": "SecurePass123!",
 *   "rememberMe": true,
 *   "authMethod": "password"
 * }
 * ```
 */
class LoginDto {
    constructor() {
        /**
         * Remember me option for extended session
         */
        this.rememberMe = false;
        /**
         * Authentication method selection
         */
        this.authMethod = AuthMethod.PASSWORD;
    }
}
exports.LoginDto = LoginDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Username is required' }),
    (0, class_validator_1.IsString)({ message: 'Username must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Username cannot be empty' }),
    (0, class_validator_1.MinLength)(3, { message: 'Username must be at least 3 characters long' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Username must not exceed 100 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value),
    __metadata("design:type", String)
], LoginDto.prototype, "usr", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Password is required' }),
    (0, class_validator_1.IsString)({ message: 'Password must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Password cannot be empty' }),
    (0, class_validator_1.MinLength)(6, { message: 'Password must be at least 6 characters long' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Password must not exceed 255 characters' }),
    __metadata("design:type", String)
], LoginDto.prototype, "pwd", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: 'Remember me must be a boolean value' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    }),
    __metadata("design:type", Boolean)
], LoginDto.prototype, "rememberMe", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(AuthMethod, {
        message: 'Authentication method must be one of: password, token, refresh'
    }),
    __metadata("design:type", String)
], LoginDto.prototype, "authMethod", void 0);
/**
 * Enhanced token verification DTO with JWT format validation
 *
 * @example
 * ```json
 * {
 *   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   "tokenType": "access"
 * }
 * ```
 */
class TokenDto {
    constructor() {
        /**
         * Token type for validation context
         */
        this.tokenType = 'access';
    }
}
exports.TokenDto = TokenDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Token is required' }),
    (0, class_validator_1.IsString)({ message: 'Token must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Token cannot be empty' }),
    (0, class_validator_1.Matches)(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/, {
        message: 'Token must be a valid JWT format'
    }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], TokenDto.prototype, "token", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['access', 'refresh', 'reset'], {
        message: 'Token type must be one of: access, refresh, reset'
    }),
    __metadata("design:type", String)
], TokenDto.prototype, "tokenType", void 0);
/**
 * User profile nested DTO for registration
 */
class UserProfileDto {
}
exports.UserProfileDto = UserProfileDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'First name must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'First name must not exceed 50 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], UserProfileDto.prototype, "firstName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Last name must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Last name must not exceed 50 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], UserProfileDto.prototype, "lastName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Phone number must be a string' }),
    (0, class_validator_1.Matches)(/^\+?[\d\s\-\(\)]+$/, { message: 'Phone number format is invalid' }),
    (0, class_validator_1.MaxLength)(20, { message: 'Phone number must not exceed 20 characters' }),
    __metadata("design:type", String)
], UserProfileDto.prototype, "phoneNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Organization must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Organization must not exceed 100 characters' }),
    __metadata("design:type", String)
], UserProfileDto.prototype, "organization", void 0);
/**
 * Enhanced user registration DTO with nested validation and role assignment
 *
 * @example
 * ```json
 * {
 *   "username": "newuser123",
 *   "password": "SecurePass123!",
 *   "email": "user@example.com",
 *   "profile": {
 *     "firstName": "John",
 *     "lastName": "Doe",
 *     "phoneNumber": "+1-555-0123"
 *   },
 *   "roles": ["user"],
 *   "acceptTerms": true
 * }
 * ```
 */
class RegisterDto {
    constructor() {
        /**
         * User roles assignment with enum validation
         */
        this.roles = [UserRole.USER];
    }
}
exports.RegisterDto = RegisterDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Username is required' }),
    (0, class_validator_1.IsString)({ message: 'Username must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Username cannot be empty' }),
    (0, class_validator_1.MinLength)(3, { message: 'Username must be at least 3 characters long' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Username must not exceed 50 characters' }),
    (0, class_validator_1.Matches)(/^[a-zA-Z0-9_.-]+$/, {
        message: 'Username can only contain letters, numbers, dots, hyphens, and underscores'
    }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value),
    __metadata("design:type", String)
], RegisterDto.prototype, "username", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Password is required' }),
    (0, class_validator_1.IsString)({ message: 'Password must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Password cannot be empty' }),
    (0, class_validator_1.MinLength)(8, { message: 'Password must be at least 8 characters long' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Password must not exceed 255 characters' }),
    (0, class_validator_1.Matches)(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message: 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    }),
    __metadata("design:type", String)
], RegisterDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Email is required' }),
    (0, class_validator_1.IsEmail)({}, { message: 'Please provide a valid email address' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Email cannot be empty' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Email must not exceed 255 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value),
    __metadata("design:type", String)
], RegisterDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)({ message: 'Profile information is invalid' }),
    (0, class_transformer_1.Type)(() => UserProfileDto),
    __metadata("design:type", UserProfileDto)
], RegisterDto.prototype, "profile", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Roles must be an array' }),
    (0, class_validator_1.IsEnum)(UserRole, {
        each: true,
        message: 'Each role must be one of: admin, user, viewer, operator'
    }),
    __metadata("design:type", Array)
], RegisterDto.prototype, "roles", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Terms acceptance is required' }),
    (0, class_validator_1.IsBoolean)({ message: 'Terms acceptance must be a boolean' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    }),
    __metadata("design:type", Boolean)
], RegisterDto.prototype, "acceptTerms", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(4, { message: 'Customer ID must be a valid UUID' }),
    __metadata("design:type", String)
], RegisterDto.prototype, "customerId", void 0);
/**
 * Enhanced change password DTO with password confirmation validation
 *
 * @example
 * ```json
 * {
 *   "currentPassword": "OldPass123!",
 *   "newPassword": "NewSecurePass456!",
 *   "confirmPassword": "NewSecurePass456!"
 * }
 * ```
 */
class ChangePasswordDto {
}
exports.ChangePasswordDto = ChangePasswordDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Current password is required' }),
    (0, class_validator_1.IsString)({ message: 'Current password must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Current password cannot be empty' }),
    __metadata("design:type", String)
], ChangePasswordDto.prototype, "currentPassword", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'New password is required' }),
    (0, class_validator_1.IsString)({ message: 'New password must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'New password cannot be empty' }),
    (0, class_validator_1.MinLength)(8, { message: 'New password must be at least 8 characters long' }),
    (0, class_validator_1.MaxLength)(255, { message: 'New password must not exceed 255 characters' }),
    (0, class_validator_1.Matches)(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message: 'New password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    }),
    __metadata("design:type", String)
], ChangePasswordDto.prototype, "newPassword", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Password confirmation is required' }),
    (0, class_validator_1.IsString)({ message: 'Password confirmation must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Password confirmation cannot be empty' }),
    (0, custom_validators_1.PasswordMatch)('newPassword', { message: 'Password confirmation must match new password' }),
    __metadata("design:type", String)
], ChangePasswordDto.prototype, "confirmPassword", void 0);
/**
 * Password reset request DTO
 *
 * @example
 * ```json
 * {
 *   "email": "user@example.com"
 * }
 * ```
 */
class PasswordResetRequestDto {
}
exports.PasswordResetRequestDto = PasswordResetRequestDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Email is required' }),
    (0, class_validator_1.IsEmail)({}, { message: 'Please provide a valid email address' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Email cannot be empty' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value),
    __metadata("design:type", String)
], PasswordResetRequestDto.prototype, "email", void 0);
/**
 * Password reset confirmation DTO
 *
 * @example
 * ```json
 * {
 *   "token": "reset-token-here",
 *   "newPassword": "NewSecurePass123!",
 *   "confirmPassword": "NewSecurePass123!"
 * }
 * ```
 */
class PasswordResetDto {
}
exports.PasswordResetDto = PasswordResetDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Reset token is required' }),
    (0, class_validator_1.IsString)({ message: 'Reset token must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Reset token cannot be empty' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], PasswordResetDto.prototype, "token", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'New password is required' }),
    (0, class_validator_1.IsString)({ message: 'New password must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'New password cannot be empty' }),
    (0, class_validator_1.MinLength)(8, { message: 'New password must be at least 8 characters long' }),
    (0, class_validator_1.MaxLength)(255, { message: 'New password must not exceed 255 characters' }),
    (0, class_validator_1.Matches)(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message: 'New password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    }),
    __metadata("design:type", String)
], PasswordResetDto.prototype, "newPassword", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Password confirmation is required' }),
    (0, class_validator_1.IsString)({ message: 'Password confirmation must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Password confirmation cannot be empty' }),
    (0, custom_validators_1.PasswordMatch)('newPassword', { message: 'Password confirmation must match new password' }),
    __metadata("design:type", String)
], PasswordResetDto.prototype, "confirmPassword", void 0);
/**
 * Refresh token DTO for token renewal
 *
 * @example
 * ```json
 * {
 *   "refreshToken": "refresh-token-here"
 * }
 * ```
 */
class RefreshTokenDto {
}
exports.RefreshTokenDto = RefreshTokenDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Refresh token is required' }),
    (0, class_validator_1.IsString)({ message: 'Refresh token must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Refresh token cannot be empty' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], RefreshTokenDto.prototype, "refreshToken", void 0);

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

import {
    IsString,
    IsNotEmpty,
    MinLength,
    MaxLength,
    IsEmail,
    IsOptional,
    IsEnum,
    IsIn,
    ValidateNested,
    IsArray,
    IsBoolean,
    Matches,
    IsUUID,
    IsDefined
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PasswordMatch } from '../validators/custom.validators';

/**
 * User role enumeration for validation
 */
export enum UserRole {
    ADMIN = 'admin',
    USER = 'user',
    VIEWER = 'viewer',
    OPERATOR = 'operator'
}

/**
 * Authentication method enumeration
 */
export enum AuthMethod {
    PASSWORD = 'password',
    TOKEN = 'token',
    REFRESH = 'refresh'
}

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
export class LoginDto {
    /**
     * Username or email address
     * Supports both username and email format validation
     */
    @IsDefined({ message: 'Username is required' })
    @IsString({ message: 'Username must be a string' })
    @IsNotEmpty({ message: 'Username cannot be empty' })
    @MinLength(3, { message: 'Username must be at least 3 characters long' })
    @MaxLength(100, { message: 'Username must not exceed 100 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    usr: string;

    /**
     * User password with strength validation
     */
    @IsDefined({ message: 'Password is required' })
    @IsString({ message: 'Password must be a string' })
    @IsNotEmpty({ message: 'Password cannot be empty' })
    @MinLength(6, { message: 'Password must be at least 6 characters long' })
    @MaxLength(255, { message: 'Password must not exceed 255 characters' })
    pwd: string;

    /**
     * Remember me option for extended session
     */
    @IsOptional()
    @IsBoolean({ message: 'Remember me must be a boolean value' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    })
    rememberMe?: boolean = false;

    /**
     * Authentication method selection
     */
    @IsOptional()
    @IsEnum(AuthMethod, {
        message: 'Authentication method must be one of: password, token, refresh'
    })
    authMethod?: AuthMethod = AuthMethod.PASSWORD;
}

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
export class TokenDto {
    /**
     * JWT token with format validation
     */
    @IsDefined({ message: 'Token is required' })
    @IsString({ message: 'Token must be a string' })
    @IsNotEmpty({ message: 'Token cannot be empty' })
    @Matches(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/, {
        message: 'Token must be a valid JWT format'
    })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    token: string;

    /**
     * Token type for validation context
     */
    @IsOptional()
    @IsIn(['access', 'refresh', 'reset'], {
        message: 'Token type must be one of: access, refresh, reset'
    })
    tokenType?: string = 'access';
}

/**
 * User profile nested DTO for registration
 */
export class UserProfileDto {
    @IsOptional()
    @IsString({ message: 'First name must be a string' })
    @MaxLength(50, { message: 'First name must not exceed 50 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    firstName?: string;

    @IsOptional()
    @IsString({ message: 'Last name must be a string' })
    @MaxLength(50, { message: 'Last name must not exceed 50 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    lastName?: string;

    @IsOptional()
    @IsString({ message: 'Phone number must be a string' })
    @Matches(/^\+?[\d\s\-\(\)]+$/, { message: 'Phone number format is invalid' })
    @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
    phoneNumber?: string;

    @IsOptional()
    @IsString({ message: 'Organization must be a string' })
    @MaxLength(100, { message: 'Organization must not exceed 100 characters' })
    organization?: string;
}

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
export class RegisterDto {
    /**
     * Unique username with format validation
     */
    @IsDefined({ message: 'Username is required' })
    @IsString({ message: 'Username must be a string' })
    @IsNotEmpty({ message: 'Username cannot be empty' })
    @MinLength(3, { message: 'Username must be at least 3 characters long' })
    @MaxLength(50, { message: 'Username must not exceed 50 characters' })
    @Matches(/^[a-zA-Z0-9_.-]+$/, {
        message: 'Username can only contain letters, numbers, dots, hyphens, and underscores'
    })
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    username: string;

    /**
     * Strong password with complexity requirements
     */
    @IsDefined({ message: 'Password is required' })
    @IsString({ message: 'Password must be a string' })
    @IsNotEmpty({ message: 'Password cannot be empty' })
    @MinLength(8, { message: 'Password must be at least 8 characters long' })
    @MaxLength(255, { message: 'Password must not exceed 255 characters' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message: 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    })
    password: string;

    /**
     * Valid email address
     */
    @IsDefined({ message: 'Email is required' })
    @IsEmail({}, { message: 'Please provide a valid email address' })
    @IsNotEmpty({ message: 'Email cannot be empty' })
    @MaxLength(255, { message: 'Email must not exceed 255 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    email: string;

    /**
     * User profile information (nested validation)
     */
    @IsOptional()
    @ValidateNested({ message: 'Profile information is invalid' })
    @Type(() => UserProfileDto)
    profile?: UserProfileDto;

    /**
     * User roles assignment with enum validation
     */
    @IsOptional()
    @IsArray({ message: 'Roles must be an array' })
    @IsEnum(UserRole, {
        each: true,
        message: 'Each role must be one of: admin, user, viewer, operator'
    })
    roles?: UserRole[] = [UserRole.USER];

    /**
     * Terms and conditions acceptance
     */
    @IsDefined({ message: 'Terms acceptance is required' })
    @IsBoolean({ message: 'Terms acceptance must be a boolean' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    })
    acceptTerms: boolean;

    /**
     * Customer ID for organization assignment
     */
    @IsOptional()
    @IsUUID(4, { message: 'Customer ID must be a valid UUID' })
    customerId?: string;
}

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
export class ChangePasswordDto {
    /**
     * Current password for verification
     */
    @IsDefined({ message: 'Current password is required' })
    @IsString({ message: 'Current password must be a string' })
    @IsNotEmpty({ message: 'Current password cannot be empty' })
    currentPassword: string;

    /**
     * New password with strength requirements
     */
    @IsDefined({ message: 'New password is required' })
    @IsString({ message: 'New password must be a string' })
    @IsNotEmpty({ message: 'New password cannot be empty' })
    @MinLength(8, { message: 'New password must be at least 8 characters long' })
    @MaxLength(255, { message: 'New password must not exceed 255 characters' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message: 'New password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    })
    newPassword: string;

    /**
     * Password confirmation (must match newPassword)
     */
    @IsDefined({ message: 'Password confirmation is required' })
    @IsString({ message: 'Password confirmation must be a string' })
    @IsNotEmpty({ message: 'Password confirmation cannot be empty' })
    @PasswordMatch('newPassword', { message: 'Password confirmation must match new password' })
    confirmPassword: string;
}

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
export class PasswordResetRequestDto {
    /**
     * Email address for password reset
     */
    @IsDefined({ message: 'Email is required' })
    @IsEmail({}, { message: 'Please provide a valid email address' })
    @IsNotEmpty({ message: 'Email cannot be empty' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    email: string;
}

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
export class PasswordResetDto {
    /**
     * Password reset token
     */
    @IsDefined({ message: 'Reset token is required' })
    @IsString({ message: 'Reset token must be a string' })
    @IsNotEmpty({ message: 'Reset token cannot be empty' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    token: string;

    /**
     * New password with strength requirements
     */
    @IsDefined({ message: 'New password is required' })
    @IsString({ message: 'New password must be a string' })
    @IsNotEmpty({ message: 'New password cannot be empty' })
    @MinLength(8, { message: 'New password must be at least 8 characters long' })
    @MaxLength(255, { message: 'New password must not exceed 255 characters' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message: 'New password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    })
    newPassword: string;

    /**
     * Password confirmation (must match newPassword)
     */
    @IsDefined({ message: 'Password confirmation is required' })
    @IsString({ message: 'Password confirmation must be a string' })
    @IsNotEmpty({ message: 'Password confirmation cannot be empty' })
    @PasswordMatch('newPassword', { message: 'Password confirmation must match new password' })
    confirmPassword: string;
}

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
export class RefreshTokenDto {
    /**
     * Refresh token for generating new access token
     */
    @IsDefined({ message: 'Refresh token is required' })
    @IsString({ message: 'Refresh token must be a string' })
    @IsNotEmpty({ message: 'Refresh token cannot be empty' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    refreshToken: string;
}

/**
 * @fileoverview Enhanced User DTOs with comprehensive validation
 *
 * This module provides sophisticated validation DTOs for user management operations
 * using advanced class-validator decorators and routing-controllers integration.
 *
 * Features:
 * - User role enum validation with dynamic role support
 * - Nested profile object validation
 * - Array validation for permissions and preferences
 * - Custom validation for business rules
 * - Enhanced query filtering with multiple criteria
 */

import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEmail,
    IsNumber,
    Min,
    Max,
    IsBoolean,
    IsEnum,
    IsIn,
    ValidateNested,
    IsArray,
    IsUUID,
    IsDefined,
    Matches,
    IsDateString,
    MinLength,
    MaxLength,
    IsObject
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * User role enumeration
 */
export enum UserRole {
    ADMIN = 'admin',
    USER = 'user',
    VIEWER = 'viewer',
    OPERATOR = 'operator',
    MANAGER = 'manager'
}

/**
 * User status enumeration
 */
export enum UserStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    SUSPENDED = 'suspended',
    PENDING = 'pending'
}

/**
 * User preferences nested DTO
 */
export class UserPreferencesDto {
    @IsOptional()
    @IsString({ message: 'Language must be a string' })
    @IsIn(['en', 'vi', 'fr', 'es'], { message: 'Language must be one of: en, vi, fr, es' })
    language?: string = 'en';

    @IsOptional()
    @IsString({ message: 'Timezone must be a string' })
    @MaxLength(50, { message: 'Timezone must not exceed 50 characters' })
    timezone?: string = 'UTC';

    @IsOptional()
    @IsString({ message: 'Date format must be a string' })
    @IsIn(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], {
        message: 'Date format must be one of: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD'
    })
    dateFormat?: string = 'YYYY-MM-DD';

    @IsOptional()
    @IsBoolean({ message: 'Email notifications must be a boolean' })
    emailNotifications?: boolean = true;

    @IsOptional()
    @IsBoolean({ message: 'SMS notifications must be a boolean' })
    smsNotifications?: boolean = false;
}

/**
 * Enhanced get users query DTO with comprehensive filtering
 *
 * @example
 * ```json
 * {
 *   "page": 1,
 *   "limit": 20,
 *   "search": "john",
 *   "roles": ["admin", "manager"],
 *   "status": "active",
 *   "customerId": "uuid-here",
 *   "sortBy": "email",
 *   "sortOrder": "ASC"
 * }
 * ```
 */
export class GetUsersQueryDto {
    /**
     * Page number for pagination
     */
    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Page must be a number' })
    @Min(1, { message: 'Page must be at least 1' })
    page?: number = 1;

    /**
     * Number of items per page
     */
    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Limit must be a number' })
    @Min(1, { message: 'Limit must be at least 1' })
    @Max(100, { message: 'Limit must not exceed 100' })
    limit?: number = 10;

    /**
     * Search term for name, email, or username
     */
    @IsOptional()
    @IsString({ message: 'Search term must be a string' })
    @MaxLength(100, { message: 'Search term must not exceed 100 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    search?: string;

    /**
     * Filter by user roles (supports multiple values)
     */
    @IsOptional()
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return [value];
        }
        return Array.isArray(value) ? value : undefined;
    })
    @IsArray({ message: 'Roles filter must be an array' })
    @IsEnum(UserRole, {
        each: true,
        message: 'Each role must be one of: admin, user, viewer, operator, manager'
    })
    roles?: UserRole[];

    /**
     * Filter by user status
     */
    @IsOptional()
    @IsEnum(UserStatus, {
        message: 'Status must be one of: active, inactive, suspended, pending'
    })
    status?: UserStatus;

    /**
     * Filter by customer ID
     */
    @IsOptional()
    @IsUUID(4, { message: 'Customer ID must be a valid UUID' })
    customerId?: string;

    /**
     * Filter by admin status
     */
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean({ message: 'Is admin must be a boolean' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    })
    isAdmin?: boolean;

    /**
     * Filter by deactivated status
     */
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean({ message: 'Is deactivated must be a boolean' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    })
    isDeactivated?: boolean;

    /**
     * Sort field
     */
    @IsOptional()
    @IsIn(['name', 'email', 'firstName', 'lastName', 'createdAt', 'updatedAt'], {
        message: 'Sort field must be one of: name, email, firstName, lastName, createdAt, updatedAt'
    })
    sortBy?: string = 'name';

    /**
     * Sort order
     */
    @IsOptional()
    @IsIn(['ASC', 'DESC'], { message: 'Sort order must be ASC or DESC' })
    sortOrder?: 'ASC' | 'DESC' = 'ASC';

    /**
     * Dynamic role filter
     */
    @IsOptional()
    @IsString({ message: 'Dynamic role must be a string' })
    @MaxLength(50, { message: 'Dynamic role must not exceed 50 characters' })
    iotDynamicRole?: string;
}

/**
 * Enhanced user ID parameter DTO with validation
 */
export class UserParamsDto {
    /**
     * User ID parameter with format validation
     */
    @IsDefined({ message: 'User ID is required' })
    @IsString({ message: 'User ID must be a string' })
    @IsNotEmpty({ message: 'User ID cannot be empty' })
    @MinLength(1, { message: 'User ID must be at least 1 character long' })
    @MaxLength(255, { message: 'User ID must not exceed 255 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    userId: string;
}

/**
 * Enhanced update user DTO with comprehensive validation
 * All fields are optional for partial updates
 *
 * @example
 * ```json
 * {
 *   "firstName": "John",
 *   "lastName": "Doe",
 *   "email": "john.doe@example.com",
 *   "phoneNumber": "+1-555-0123",
 *   "roles": ["manager"],
 *   "preferences": {
 *     "language": "en",
 *     "timezone": "America/New_York"
 *   }
 * }
 * ```
 */
export class UpdateUserDto {
    /**
     * Updated first name
     */
    @IsOptional()
    @IsString({ message: 'First name must be a string' })
    @IsNotEmpty({ message: 'First name cannot be empty' })
    @MaxLength(50, { message: 'First name must not exceed 50 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    firstName?: string;

    /**
     * Updated last name
     */
    @IsOptional()
    @IsString({ message: 'Last name must be a string' })
    @IsNotEmpty({ message: 'Last name cannot be empty' })
    @MaxLength(50, { message: 'Last name must not exceed 50 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    lastName?: string;

    /**
     * Updated email address
     */
    @IsOptional()
    @IsEmail({}, { message: 'Please provide a valid email address' })
    @MaxLength(255, { message: 'Email must not exceed 255 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    email?: string;

    /**
     * Updated phone number with format validation
     */
    @IsOptional()
    @IsString({ message: 'Phone number must be a string' })
    @Matches(/^\+?[\d\s\-\(\)]+$/, { message: 'Phone number format is invalid' })
    @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
    phoneNumber?: string;

    /**
     * Updated admin status
     */
    @IsOptional()
    @IsBoolean({ message: 'Admin status must be a boolean' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    })
    isAdmin?: boolean;

    /**
     * Updated user roles
     */
    @IsOptional()
    @IsArray({ message: 'Roles must be an array' })
    @IsEnum(UserRole, {
        each: true,
        message: 'Each role must be one of: admin, user, viewer, operator, manager'
    })
    roles?: UserRole[];

    /**
     * Updated dynamic role
     */
    @IsOptional()
    @IsString({ message: 'Dynamic role must be a string' })
    @MaxLength(50, { message: 'Dynamic role must not exceed 50 characters' })
    iotDynamicRole?: string;

    /**
     * Updated user status
     */
    @IsOptional()
    @IsEnum(UserStatus, {
        message: 'Status must be one of: active, inactive, suspended, pending'
    })
    status?: UserStatus;

    /**
     * Updated user preferences (nested validation)
     */
    @IsOptional()
    @ValidateNested({ message: 'Preferences are invalid' })
    @Type(() => UserPreferencesDto)
    preferences?: UserPreferencesDto;

    /**
     * Updated deactivated status
     */
    @IsOptional()
    @IsBoolean({ message: 'Deactivated status must be a boolean' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    })
    isDeactivated?: boolean;

    /**
     * Updated organization/department
     */
    @IsOptional()
    @IsString({ message: 'Organization must be a string' })
    @MaxLength(100, { message: 'Organization must not exceed 100 characters' })
    organization?: string;

    /**
     * Updated job title
     */
    @IsOptional()
    @IsString({ message: 'Job title must be a string' })
    @MaxLength(100, { message: 'Job title must not exceed 100 characters' })
    jobTitle?: string;
}

/**
 * Enhanced create user DTO with comprehensive validation
 *
 * @example
 * ```json
 * {
 *   "username": "johndoe123",
 *   "password": "SecurePass123!",
 *   "email": "john.doe@example.com",
 *   "firstName": "John",
 *   "lastName": "Doe",
 *   "phoneNumber": "+1-555-0123",
 *   "roles": ["user"],
 *   "customerId": "uuid-here",
 *   "preferences": {
 *     "language": "en",
 *     "timezone": "America/New_York"
 *   }
 * }
 * ```
 */
export class CreateUserDto {
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
     * User's first name
     */
    @IsOptional()
    @IsString({ message: 'First name must be a string' })
    @MaxLength(50, { message: 'First name must not exceed 50 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    firstName?: string;

    /**
     * User's last name
     */
    @IsOptional()
    @IsString({ message: 'Last name must be a string' })
    @MaxLength(50, { message: 'Last name must not exceed 50 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    lastName?: string;

    /**
     * Phone number with format validation
     */
    @IsOptional()
    @IsString({ message: 'Phone number must be a string' })
    @Matches(/^\+?[\d\s\-\(\)]+$/, { message: 'Phone number format is invalid' })
    @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
    phoneNumber?: string;

    /**
     * Customer ID for organization assignment
     */
    @IsOptional()
    @IsUUID(4, { message: 'Customer ID must be a valid UUID' })
    customerId?: string;

    /**
     * Admin status
     */
    @IsOptional()
    @IsBoolean({ message: 'Admin status must be a boolean' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    })
    isAdmin?: boolean = false;

    /**
     * User roles assignment
     */
    @IsOptional()
    @IsArray({ message: 'Roles must be an array' })
    @IsEnum(UserRole, {
        each: true,
        message: 'Each role must be one of: admin, user, viewer, operator, manager'
    })
    roles?: UserRole[] = [UserRole.USER];

    /**
     * Dynamic role for IoT system
     */
    @IsOptional()
    @IsString({ message: 'Dynamic role must be a string' })
    @MaxLength(50, { message: 'Dynamic role must not exceed 50 characters' })
    iotDynamicRole?: string;

    /**
     * Initial user status
     */
    @IsOptional()
    @IsEnum(UserStatus, {
        message: 'Status must be one of: active, inactive, suspended, pending'
    })
    status?: UserStatus = UserStatus.ACTIVE;

    /**
     * User preferences (nested validation)
     */
    @IsOptional()
    @ValidateNested({ message: 'Preferences are invalid' })
    @Type(() => UserPreferencesDto)
    preferences?: UserPreferencesDto;

    /**
     * Organization/department
     */
    @IsOptional()
    @IsString({ message: 'Organization must be a string' })
    @MaxLength(100, { message: 'Organization must not exceed 100 characters' })
    organization?: string;

    /**
     * Job title
     */
    @IsOptional()
    @IsString({ message: 'Job title must be a string' })
    @MaxLength(100, { message: 'Job title must not exceed 100 characters' })
    jobTitle?: string;
}

/**
 * Bulk user operation DTO
 *
 * @example
 * ```json
 * {
 *   "userIds": ["user1", "user2", "user3"],
 *   "operation": "activate",
 *   "parameters": {
 *     "reason": "Account verification completed"
 *   }
 * }
 * ```
 */
export class BulkUserOperationDto {
    /**
     * Array of user IDs to operate on
     */
    @IsDefined({ message: 'User IDs are required' })
    @IsArray({ message: 'User IDs must be an array' })
    @IsString({ each: true, message: 'Each user ID must be a string' })
    @IsNotEmpty({ each: true, message: 'User IDs cannot be empty' })
    userIds: string[];

    /**
     * Operation to perform
     */
    @IsDefined({ message: 'Operation is required' })
    @IsIn(['activate', 'deactivate', 'suspend', 'delete', 'reset_password'], {
        message: 'Operation must be one of: activate, deactivate, suspend, delete, reset_password'
    })
    operation: string;

    /**
     * Optional parameters for the operation
     */
    @IsOptional()
    @IsObject({ message: 'Parameters must be an object' })
    parameters?: Record<string, any>;
}

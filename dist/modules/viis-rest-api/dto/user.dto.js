"use strict";
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
exports.BulkUserOperationDto = exports.CreateUserDto = exports.UpdateUserDto = exports.UserParamsDto = exports.GetUsersQueryDto = exports.UserPreferencesDto = exports.UserStatus = exports.UserRole = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
/**
 * User role enumeration
 */
var UserRole;
(function (UserRole) {
    UserRole["ADMIN"] = "admin";
    UserRole["USER"] = "user";
    UserRole["VIEWER"] = "viewer";
    UserRole["OPERATOR"] = "operator";
    UserRole["MANAGER"] = "manager";
})(UserRole || (exports.UserRole = UserRole = {}));
/**
 * User status enumeration
 */
var UserStatus;
(function (UserStatus) {
    UserStatus["ACTIVE"] = "active";
    UserStatus["INACTIVE"] = "inactive";
    UserStatus["SUSPENDED"] = "suspended";
    UserStatus["PENDING"] = "pending";
})(UserStatus || (exports.UserStatus = UserStatus = {}));
/**
 * User preferences nested DTO
 */
class UserPreferencesDto {
    constructor() {
        this.language = 'en';
        this.timezone = 'UTC';
        this.dateFormat = 'YYYY-MM-DD';
        this.emailNotifications = true;
        this.smsNotifications = false;
    }
}
exports.UserPreferencesDto = UserPreferencesDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Language must be a string' }),
    (0, class_validator_1.IsIn)(['en', 'vi', 'fr', 'es'], { message: 'Language must be one of: en, vi, fr, es' }),
    __metadata("design:type", String)
], UserPreferencesDto.prototype, "language", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Timezone must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Timezone must not exceed 50 characters' }),
    __metadata("design:type", String)
], UserPreferencesDto.prototype, "timezone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Date format must be a string' }),
    (0, class_validator_1.IsIn)(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], {
        message: 'Date format must be one of: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD'
    }),
    __metadata("design:type", String)
], UserPreferencesDto.prototype, "dateFormat", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: 'Email notifications must be a boolean' }),
    __metadata("design:type", Boolean)
], UserPreferencesDto.prototype, "emailNotifications", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: 'SMS notifications must be a boolean' }),
    __metadata("design:type", Boolean)
], UserPreferencesDto.prototype, "smsNotifications", void 0);
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
class GetUsersQueryDto {
    constructor() {
        /**
         * Page number for pagination
         */
        this.page = 1;
        /**
         * Number of items per page
         */
        this.limit = 10;
        /**
         * Sort field
         */
        this.sortBy = 'name';
        /**
         * Sort order
         */
        this.sortOrder = 'ASC';
    }
}
exports.GetUsersQueryDto = GetUsersQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Page must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Page must be at least 1' }),
    __metadata("design:type", Number)
], GetUsersQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Limit must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Limit must be at least 1' }),
    (0, class_validator_1.Max)(100, { message: 'Limit must not exceed 100' }),
    __metadata("design:type", Number)
], GetUsersQueryDto.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Search term must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Search term must not exceed 100 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], GetUsersQueryDto.prototype, "search", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return [value];
        }
        return Array.isArray(value) ? value : undefined;
    }),
    (0, class_validator_1.IsArray)({ message: 'Roles filter must be an array' }),
    (0, class_validator_1.IsEnum)(UserRole, {
        each: true,
        message: 'Each role must be one of: admin, user, viewer, operator, manager'
    }),
    __metadata("design:type", Array)
], GetUsersQueryDto.prototype, "roles", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(UserStatus, {
        message: 'Status must be one of: active, inactive, suspended, pending'
    }),
    __metadata("design:type", String)
], GetUsersQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(4, { message: 'Customer ID must be a valid UUID' }),
    __metadata("design:type", String)
], GetUsersQueryDto.prototype, "customerId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Boolean),
    (0, class_validator_1.IsBoolean)({ message: 'Is admin must be a boolean' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    }),
    __metadata("design:type", Boolean)
], GetUsersQueryDto.prototype, "isAdmin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Boolean),
    (0, class_validator_1.IsBoolean)({ message: 'Is deactivated must be a boolean' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    }),
    __metadata("design:type", Boolean)
], GetUsersQueryDto.prototype, "isDeactivated", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['name', 'email', 'firstName', 'lastName', 'createdAt', 'updatedAt'], {
        message: 'Sort field must be one of: name, email, firstName, lastName, createdAt, updatedAt'
    }),
    __metadata("design:type", String)
], GetUsersQueryDto.prototype, "sortBy", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['ASC', 'DESC'], { message: 'Sort order must be ASC or DESC' }),
    __metadata("design:type", String)
], GetUsersQueryDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Dynamic role must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Dynamic role must not exceed 50 characters' }),
    __metadata("design:type", String)
], GetUsersQueryDto.prototype, "iotDynamicRole", void 0);
/**
 * Enhanced user ID parameter DTO with validation
 */
class UserParamsDto {
}
exports.UserParamsDto = UserParamsDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'User ID is required' }),
    (0, class_validator_1.IsString)({ message: 'User ID must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'User ID cannot be empty' }),
    (0, class_validator_1.MinLength)(1, { message: 'User ID must be at least 1 character long' }),
    (0, class_validator_1.MaxLength)(255, { message: 'User ID must not exceed 255 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], UserParamsDto.prototype, "userId", void 0);
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
class UpdateUserDto {
}
exports.UpdateUserDto = UpdateUserDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'First name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'First name cannot be empty' }),
    (0, class_validator_1.MaxLength)(50, { message: 'First name must not exceed 50 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "firstName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Last name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Last name cannot be empty' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Last name must not exceed 50 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "lastName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEmail)({}, { message: 'Please provide a valid email address' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Email must not exceed 255 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Phone number must be a string' }),
    (0, class_validator_1.Matches)(/^\+?[\d\s\-\(\)]+$/, { message: 'Phone number format is invalid' }),
    (0, class_validator_1.MaxLength)(20, { message: 'Phone number must not exceed 20 characters' }),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "phoneNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: 'Admin status must be a boolean' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    }),
    __metadata("design:type", Boolean)
], UpdateUserDto.prototype, "isAdmin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Roles must be an array' }),
    (0, class_validator_1.IsEnum)(UserRole, {
        each: true,
        message: 'Each role must be one of: admin, user, viewer, operator, manager'
    }),
    __metadata("design:type", Array)
], UpdateUserDto.prototype, "roles", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Dynamic role must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Dynamic role must not exceed 50 characters' }),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "iotDynamicRole", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(UserStatus, {
        message: 'Status must be one of: active, inactive, suspended, pending'
    }),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)({ message: 'Preferences are invalid' }),
    (0, class_transformer_1.Type)(() => UserPreferencesDto),
    __metadata("design:type", UserPreferencesDto)
], UpdateUserDto.prototype, "preferences", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: 'Deactivated status must be a boolean' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    }),
    __metadata("design:type", Boolean)
], UpdateUserDto.prototype, "isDeactivated", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Organization must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Organization must not exceed 100 characters' }),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "organization", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Job title must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Job title must not exceed 100 characters' }),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "jobTitle", void 0);
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
class CreateUserDto {
    constructor() {
        /**
         * Admin status
         */
        this.isAdmin = false;
        /**
         * User roles assignment
         */
        this.roles = [UserRole.USER];
        /**
         * Initial user status
         */
        this.status = UserStatus.ACTIVE;
    }
}
exports.CreateUserDto = CreateUserDto;
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
], CreateUserDto.prototype, "username", void 0);
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
], CreateUserDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Email is required' }),
    (0, class_validator_1.IsEmail)({}, { message: 'Please provide a valid email address' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Email cannot be empty' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Email must not exceed 255 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value),
    __metadata("design:type", String)
], CreateUserDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'First name must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'First name must not exceed 50 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], CreateUserDto.prototype, "firstName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Last name must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Last name must not exceed 50 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], CreateUserDto.prototype, "lastName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Phone number must be a string' }),
    (0, class_validator_1.Matches)(/^\+?[\d\s\-\(\)]+$/, { message: 'Phone number format is invalid' }),
    (0, class_validator_1.MaxLength)(20, { message: 'Phone number must not exceed 20 characters' }),
    __metadata("design:type", String)
], CreateUserDto.prototype, "phoneNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(4, { message: 'Customer ID must be a valid UUID' }),
    __metadata("design:type", String)
], CreateUserDto.prototype, "customerId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: 'Admin status must be a boolean' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    }),
    __metadata("design:type", Boolean)
], CreateUserDto.prototype, "isAdmin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Roles must be an array' }),
    (0, class_validator_1.IsEnum)(UserRole, {
        each: true,
        message: 'Each role must be one of: admin, user, viewer, operator, manager'
    }),
    __metadata("design:type", Array)
], CreateUserDto.prototype, "roles", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Dynamic role must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Dynamic role must not exceed 50 characters' }),
    __metadata("design:type", String)
], CreateUserDto.prototype, "iotDynamicRole", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(UserStatus, {
        message: 'Status must be one of: active, inactive, suspended, pending'
    }),
    __metadata("design:type", String)
], CreateUserDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)({ message: 'Preferences are invalid' }),
    (0, class_transformer_1.Type)(() => UserPreferencesDto),
    __metadata("design:type", UserPreferencesDto)
], CreateUserDto.prototype, "preferences", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Organization must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Organization must not exceed 100 characters' }),
    __metadata("design:type", String)
], CreateUserDto.prototype, "organization", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Job title must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Job title must not exceed 100 characters' }),
    __metadata("design:type", String)
], CreateUserDto.prototype, "jobTitle", void 0);
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
class BulkUserOperationDto {
}
exports.BulkUserOperationDto = BulkUserOperationDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'User IDs are required' }),
    (0, class_validator_1.IsArray)({ message: 'User IDs must be an array' }),
    (0, class_validator_1.IsString)({ each: true, message: 'Each user ID must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ each: true, message: 'User IDs cannot be empty' }),
    __metadata("design:type", Array)
], BulkUserOperationDto.prototype, "userIds", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Operation is required' }),
    (0, class_validator_1.IsIn)(['activate', 'deactivate', 'suspend', 'delete', 'reset_password'], {
        message: 'Operation must be one of: activate, deactivate, suspend, delete, reset_password'
    }),
    __metadata("design:type", String)
], BulkUserOperationDto.prototype, "operation", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)({ message: 'Parameters must be an object' }),
    __metadata("design:type", Object)
], BulkUserOperationDto.prototype, "parameters", void 0);

"use strict";
/**
 * @fileoverview Validation Examples - Demonstrating Enhanced Validation System
 *
 * This file provides comprehensive examples of how to use the enhanced validation
 * system with class-validator decorators and routing-controllers integration.
 *
 * These examples serve as:
 * - Documentation for developers
 * - Test cases for validation scenarios
 * - Templates for creating new DTOs
 * - Reference for best practices
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
exports.NetworkValidationExample = exports.TransformationExample = exports.ConditionalValidationExample = exports.PasswordValidationExample = exports.ArrayValidationExample = exports.NestedValidationExample = exports.ContactInfoDto = exports.AddressDto = exports.EnumValidationExample = exports.Status = exports.Priority = exports.BasicValidationExample = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const custom_validators_1 = require("../validators/custom.validators");
/**
 * Example 1: Basic validation with enhanced error messages
 */
class BasicValidationExample {
}
exports.BasicValidationExample = BasicValidationExample;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Name is required and cannot be undefined' }),
    (0, class_validator_1.IsString)({ message: 'Name must be a string value' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Name cannot be empty or whitespace only' }),
    (0, class_validator_1.MinLength)(2, { message: 'Name must be at least 2 characters long' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Name must not exceed 50 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], BasicValidationExample.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)({}, { message: 'Age must be a valid number' }),
    (0, class_validator_1.Min)(0, { message: 'Age cannot be negative' }),
    (0, class_validator_1.Max)(150, { message: 'Age cannot exceed 150 years' }),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], BasicValidationExample.prototype, "age", void 0);
/**
 * Example 2: Enum validation with multiple options
 */
var Priority;
(function (Priority) {
    Priority["LOW"] = "low";
    Priority["MEDIUM"] = "medium";
    Priority["HIGH"] = "high";
    Priority["CRITICAL"] = "critical";
})(Priority || (exports.Priority = Priority = {}));
var Status;
(function (Status) {
    Status["DRAFT"] = "draft";
    Status["ACTIVE"] = "active";
    Status["INACTIVE"] = "inactive";
    Status["ARCHIVED"] = "archived";
})(Status || (exports.Status = Status = {}));
class EnumValidationExample {
    constructor() {
        this.status = Status.DRAFT;
        this.outputFormat = 'json';
    }
}
exports.EnumValidationExample = EnumValidationExample;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Priority is required' }),
    (0, class_validator_1.IsEnum)(Priority, {
        message: 'Priority must be one of: low, medium, high, critical'
    }),
    __metadata("design:type", String)
], EnumValidationExample.prototype, "priority", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(Status, {
        message: 'Status must be one of: draft, active, inactive, archived'
    }),
    __metadata("design:type", String)
], EnumValidationExample.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['json', 'xml', 'csv'], {
        message: 'Format must be one of: json, xml, csv'
    }),
    __metadata("design:type", String)
], EnumValidationExample.prototype, "outputFormat", void 0);
/**
 * Example 3: Nested object validation with complex structures
 */
class AddressDto {
    constructor() {
        this.country = 'US';
    }
}
exports.AddressDto = AddressDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Street address is required' }),
    (0, class_validator_1.IsString)({ message: 'Street must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Street cannot be empty' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Street must not exceed 100 characters' }),
    __metadata("design:type", String)
], AddressDto.prototype, "street", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'City is required' }),
    (0, class_validator_1.IsString)({ message: 'City must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'City cannot be empty' }),
    (0, class_validator_1.MaxLength)(50, { message: 'City must not exceed 50 characters' }),
    __metadata("design:type", String)
], AddressDto.prototype, "city", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Postal code is required' }),
    (0, class_validator_1.IsString)({ message: 'Postal code must be a string' }),
    (0, class_validator_1.Matches)(/^\d{5}(-\d{4})?$/, {
        message: 'Postal code must be in format 12345 or 12345-6789'
    }),
    __metadata("design:type", String)
], AddressDto.prototype, "postalCode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Country must be a string' }),
    (0, class_validator_1.IsIn)(['US', 'CA', 'MX'], {
        message: 'Country must be one of: US, CA, MX'
    }),
    __metadata("design:type", String)
], AddressDto.prototype, "country", void 0);
class ContactInfoDto {
}
exports.ContactInfoDto = ContactInfoDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Email is required' }),
    (0, class_validator_1.IsEmail)({}, { message: 'Please provide a valid email address' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Email must not exceed 255 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value),
    __metadata("design:type", String)
], ContactInfoDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Phone number must be a string' }),
    (0, class_validator_1.Matches)(/^\+?[\d\s\-\(\)]+$/, {
        message: 'Phone number format is invalid'
    }),
    (0, class_validator_1.MaxLength)(20, { message: 'Phone number must not exceed 20 characters' }),
    __metadata("design:type", String)
], ContactInfoDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)({ message: 'Address information is invalid' }),
    (0, class_transformer_1.Type)(() => AddressDto),
    __metadata("design:type", AddressDto)
], ContactInfoDto.prototype, "address", void 0);
class NestedValidationExample {
}
exports.NestedValidationExample = NestedValidationExample;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Full name is required' }),
    (0, class_validator_1.IsString)({ message: 'Full name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Full name cannot be empty' }),
    __metadata("design:type", String)
], NestedValidationExample.prototype, "fullName", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Contact information is required' }),
    (0, class_validator_1.ValidateNested)({ message: 'Contact information is invalid' }),
    (0, class_transformer_1.Type)(() => ContactInfoDto),
    __metadata("design:type", ContactInfoDto)
], NestedValidationExample.prototype, "contact", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Additional addresses must be an array' }),
    (0, class_validator_1.ValidateNested)({ each: true, message: 'Each additional address is invalid' }),
    (0, class_transformer_1.Type)(() => AddressDto),
    __metadata("design:type", Array)
], NestedValidationExample.prototype, "additionalAddresses", void 0);
/**
 * Example 4: Array validation with unique constraints
 */
class ArrayValidationExample {
}
exports.ArrayValidationExample = ArrayValidationExample;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Tags are required' }),
    (0, class_validator_1.IsArray)({ message: 'Tags must be an array' }),
    (0, class_validator_1.IsString)({ each: true, message: 'Each tag must be a string' }),
    (0, custom_validators_1.ArrayUnique)({ message: 'Tags must be unique' }),
    (0, class_transformer_1.Transform)(({ value }) => Array.isArray(value)
        ? value.map(v => typeof v === 'string' ? v.trim().toLowerCase() : v)
        : value),
    __metadata("design:type", Array)
], ArrayValidationExample.prototype, "tags", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Categories must be an array' }),
    (0, class_validator_1.IsEnum)(Priority, {
        each: true,
        message: 'Each category must be a valid priority level'
    }),
    __metadata("design:type", Array)
], ArrayValidationExample.prototype, "categories", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Numbers must be an array' }),
    (0, class_validator_1.IsNumber)({}, { each: true, message: 'Each item must be a number' }),
    (0, class_validator_1.Min)(1, { each: true, message: 'Each number must be at least 1' }),
    (0, class_validator_1.Max)(100, { each: true, message: 'Each number must not exceed 100' }),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Array)
], ArrayValidationExample.prototype, "numbers", void 0);
/**
 * Example 5: Custom validation with password matching
 */
class PasswordValidationExample {
}
exports.PasswordValidationExample = PasswordValidationExample;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Password is required' }),
    (0, class_validator_1.IsString)({ message: 'Password must be a string' }),
    (0, class_validator_1.MinLength)(8, { message: 'Password must be at least 8 characters long' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Password must not exceed 255 characters' }),
    (0, class_validator_1.Matches)(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message: 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    }),
    __metadata("design:type", String)
], PasswordValidationExample.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Password confirmation is required' }),
    (0, class_validator_1.IsString)({ message: 'Password confirmation must be a string' }),
    (0, custom_validators_1.PasswordMatch)('password', {
        message: 'Password confirmation must match the password'
    }),
    __metadata("design:type", String)
], PasswordValidationExample.prototype, "confirmPassword", void 0);
/**
 * Example 6: Conditional validation based on other fields
 */
class ConditionalValidationExample {
}
exports.ConditionalValidationExample = ConditionalValidationExample;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Account type is required' }),
    (0, class_validator_1.IsIn)(['personal', 'business'], {
        message: 'Account type must be either personal or business'
    }),
    __metadata("design:type", String)
], ConditionalValidationExample.prototype, "accountType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Company name must be a string' }),
    (0, custom_validators_1.ConditionalRequired)('accountType', 'business', {
        message: 'Company name is required for business accounts'
    }),
    __metadata("design:type", String)
], ConditionalValidationExample.prototype, "companyName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Tax ID must be a string' }),
    (0, custom_validators_1.ConditionalRequired)('accountType', 'business', {
        message: 'Tax ID is required for business accounts'
    }),
    (0, class_validator_1.Matches)(/^\d{2}-\d{7}$/, {
        message: 'Tax ID must be in format XX-XXXXXXX'
    }),
    __metadata("design:type", String)
], ConditionalValidationExample.prototype, "taxId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Personal ID must be a string' }),
    (0, custom_validators_1.ConditionalRequired)('accountType', 'personal', {
        message: 'Personal ID is required for personal accounts'
    }),
    __metadata("design:type", String)
], ConditionalValidationExample.prototype, "personalId", void 0);
/**
 * Example 7: Advanced transformation and validation
 */
class TransformationExample {
    constructor() {
        this.subscribeToNewsletter = false;
    }
}
exports.TransformationExample = TransformationExample;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Email is required' }),
    (0, class_validator_1.IsEmail)({}, { message: 'Please provide a valid email address' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value),
    __metadata("design:type", String)
], TransformationExample.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: 'Newsletter subscription must be a boolean' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    }),
    __metadata("design:type", Boolean)
], TransformationExample.prototype, "subscribeToNewsletter", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Preferences must be an array' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.split(',').map(v => v.trim());
        }
        return Array.isArray(value) ? value : [];
    }),
    __metadata("design:type", Array)
], TransformationExample.prototype, "preferences", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)({}, { message: 'Birth date must be a valid ISO date string' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return `${value}T00:00:00.000Z`;
        }
        return value;
    }),
    __metadata("design:type", String)
], TransformationExample.prototype, "birthDate", void 0);
/**
 * Example 8: Network and URL validation
 */
class NetworkValidationExample {
}
exports.NetworkValidationExample = NetworkValidationExample;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIP)(undefined, { message: 'IP address format is invalid' }),
    __metadata("design:type", String)
], NetworkValidationExample.prototype, "ipAddress", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsPort)({ message: 'Port must be a valid port number (1-65535)' }),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], NetworkValidationExample.prototype, "port", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)({}, { message: 'Please provide a valid URL' }),
    __metadata("design:type", String)
], NetworkValidationExample.prototype, "website", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'MAC address must be a string' }),
    (0, class_validator_1.Matches)(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, {
        message: 'MAC address must be in format XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX'
    }),
    __metadata("design:type", String)
], NetworkValidationExample.prototype, "macAddress", void 0);
/**
 * Example usage in a controller:
 *
 * @Post('/example')
 * async createExample(@Body() data: NestedValidationExample): Promise<any> {
 *     // data is automatically validated by routing-controllers
 *     // All nested objects, arrays, and custom validations are applied
 *     return await this.exampleService.create(data);
 * }
 */

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

import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEmail,
    IsNumber,
    IsBoolean,
    IsEnum,
    IsIn,
    ValidateNested,
    IsArray,
    IsUUID,
    IsDefined,
    Min,
    Max,
    MinLength,
    MaxLength,
    Matches,
    IsDateString,
    IsUrl,
    IsIP,
    IsPort
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PasswordMatch, ArrayUnique, ConditionalRequired } from '../validators/custom.validators';

/**
 * Example 1: Basic validation with enhanced error messages
 */
export class BasicValidationExample {
    @IsDefined({ message: 'Name is required and cannot be undefined' })
    @IsString({ message: 'Name must be a string value' })
    @IsNotEmpty({ message: 'Name cannot be empty or whitespace only' })
    @MinLength(2, { message: 'Name must be at least 2 characters long' })
    @MaxLength(50, { message: 'Name must not exceed 50 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    name: string;

    @IsOptional()
    @IsNumber({}, { message: 'Age must be a valid number' })
    @Min(0, { message: 'Age cannot be negative' })
    @Max(150, { message: 'Age cannot exceed 150 years' })
    @Type(() => Number)
    age?: number;
}

/**
 * Example 2: Enum validation with multiple options
 */
export enum Priority {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical'
}

export enum Status {
    DRAFT = 'draft',
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    ARCHIVED = 'archived'
}

export class EnumValidationExample {
    @IsDefined({ message: 'Priority is required' })
    @IsEnum(Priority, { 
        message: 'Priority must be one of: low, medium, high, critical' 
    })
    priority: Priority;

    @IsOptional()
    @IsEnum(Status, { 
        message: 'Status must be one of: draft, active, inactive, archived' 
    })
    status?: Status = Status.DRAFT;

    @IsOptional()
    @IsIn(['json', 'xml', 'csv'], { 
        message: 'Format must be one of: json, xml, csv' 
    })
    outputFormat?: string = 'json';
}

/**
 * Example 3: Nested object validation with complex structures
 */
export class AddressDto {
    @IsDefined({ message: 'Street address is required' })
    @IsString({ message: 'Street must be a string' })
    @IsNotEmpty({ message: 'Street cannot be empty' })
    @MaxLength(100, { message: 'Street must not exceed 100 characters' })
    street: string;

    @IsDefined({ message: 'City is required' })
    @IsString({ message: 'City must be a string' })
    @IsNotEmpty({ message: 'City cannot be empty' })
    @MaxLength(50, { message: 'City must not exceed 50 characters' })
    city: string;

    @IsDefined({ message: 'Postal code is required' })
    @IsString({ message: 'Postal code must be a string' })
    @Matches(/^\d{5}(-\d{4})?$/, { 
        message: 'Postal code must be in format 12345 or 12345-6789' 
    })
    postalCode: string;

    @IsOptional()
    @IsString({ message: 'Country must be a string' })
    @IsIn(['US', 'CA', 'MX'], { 
        message: 'Country must be one of: US, CA, MX' 
    })
    country?: string = 'US';
}

export class ContactInfoDto {
    @IsDefined({ message: 'Email is required' })
    @IsEmail({}, { message: 'Please provide a valid email address' })
    @MaxLength(255, { message: 'Email must not exceed 255 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    email: string;

    @IsOptional()
    @IsString({ message: 'Phone number must be a string' })
    @Matches(/^\+?[\d\s\-\(\)]+$/, { 
        message: 'Phone number format is invalid' 
    })
    @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
    phone?: string;

    @IsOptional()
    @ValidateNested({ message: 'Address information is invalid' })
    @Type(() => AddressDto)
    address?: AddressDto;
}

export class NestedValidationExample {
    @IsDefined({ message: 'Full name is required' })
    @IsString({ message: 'Full name must be a string' })
    @IsNotEmpty({ message: 'Full name cannot be empty' })
    fullName: string;

    @IsDefined({ message: 'Contact information is required' })
    @ValidateNested({ message: 'Contact information is invalid' })
    @Type(() => ContactInfoDto)
    contact: ContactInfoDto;

    @IsOptional()
    @IsArray({ message: 'Additional addresses must be an array' })
    @ValidateNested({ each: true, message: 'Each additional address is invalid' })
    @Type(() => AddressDto)
    additionalAddresses?: AddressDto[];
}

/**
 * Example 4: Array validation with unique constraints
 */
export class ArrayValidationExample {
    @IsDefined({ message: 'Tags are required' })
    @IsArray({ message: 'Tags must be an array' })
    @IsString({ each: true, message: 'Each tag must be a string' })
    @ArrayUnique({ message: 'Tags must be unique' })
    @Transform(({ value }) => 
        Array.isArray(value) 
            ? value.map(v => typeof v === 'string' ? v.trim().toLowerCase() : v)
            : value
    )
    tags: string[];

    @IsOptional()
    @IsArray({ message: 'Categories must be an array' })
    @IsEnum(Priority, { 
        each: true, 
        message: 'Each category must be a valid priority level' 
    })
    categories?: Priority[];

    @IsOptional()
    @IsArray({ message: 'Numbers must be an array' })
    @IsNumber({}, { each: true, message: 'Each item must be a number' })
    @Min(1, { each: true, message: 'Each number must be at least 1' })
    @Max(100, { each: true, message: 'Each number must not exceed 100' })
    @Type(() => Number)
    numbers?: number[];
}

/**
 * Example 5: Custom validation with password matching
 */
export class PasswordValidationExample {
    @IsDefined({ message: 'Password is required' })
    @IsString({ message: 'Password must be a string' })
    @MinLength(8, { message: 'Password must be at least 8 characters long' })
    @MaxLength(255, { message: 'Password must not exceed 255 characters' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message: 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    })
    password: string;

    @IsDefined({ message: 'Password confirmation is required' })
    @IsString({ message: 'Password confirmation must be a string' })
    @PasswordMatch('password', { 
        message: 'Password confirmation must match the password' 
    })
    confirmPassword: string;
}

/**
 * Example 6: Conditional validation based on other fields
 */
export class ConditionalValidationExample {
    @IsDefined({ message: 'Account type is required' })
    @IsIn(['personal', 'business'], { 
        message: 'Account type must be either personal or business' 
    })
    accountType: string;

    @IsOptional()
    @IsString({ message: 'Company name must be a string' })
    @ConditionalRequired('accountType', 'business', {
        message: 'Company name is required for business accounts'
    })
    companyName?: string;

    @IsOptional()
    @IsString({ message: 'Tax ID must be a string' })
    @ConditionalRequired('accountType', 'business', {
        message: 'Tax ID is required for business accounts'
    })
    @Matches(/^\d{2}-\d{7}$/, { 
        message: 'Tax ID must be in format XX-XXXXXXX' 
    })
    taxId?: string;

    @IsOptional()
    @IsString({ message: 'Personal ID must be a string' })
    @ConditionalRequired('accountType', 'personal', {
        message: 'Personal ID is required for personal accounts'
    })
    personalId?: string;
}

/**
 * Example 7: Advanced transformation and validation
 */
export class TransformationExample {
    @IsDefined({ message: 'Email is required' })
    @IsEmail({}, { message: 'Please provide a valid email address' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    email: string;

    @IsOptional()
    @IsBoolean({ message: 'Newsletter subscription must be a boolean' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    })
    subscribeToNewsletter?: boolean = false;

    @IsOptional()
    @IsArray({ message: 'Preferences must be an array' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.split(',').map(v => v.trim());
        }
        return Array.isArray(value) ? value : [];
    })
    preferences?: string[];

    @IsOptional()
    @IsDateString({}, { message: 'Birth date must be a valid ISO date string' })
    @Transform(({ value }) => {
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return `${value}T00:00:00.000Z`;
        }
        return value;
    })
    birthDate?: string;
}

/**
 * Example 8: Network and URL validation
 */
export class NetworkValidationExample {
    @IsOptional()
    @IsIP(undefined, { message: 'IP address format is invalid' })
    ipAddress?: string;

    @IsOptional()
    @IsPort({ message: 'Port must be a valid port number (1-65535)' })
    @Type(() => Number)
    port?: number;

    @IsOptional()
    @IsUrl({}, { message: 'Please provide a valid URL' })
    website?: string;

    @IsOptional()
    @IsString({ message: 'MAC address must be a string' })
    @Matches(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, {
        message: 'MAC address must be in format XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX'
    })
    macAddress?: string;
}

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

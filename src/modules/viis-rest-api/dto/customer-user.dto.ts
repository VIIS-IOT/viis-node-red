/**
 * @fileoverview Customer User DTOs for validation and transformation
 */

import {
    IsOptional,
    IsString,
    IsEmail,
    IsNumber,
    IsBoolean,
    IsEnum,
    IsUUID,
    IsDate,
    MinLength,
    MaxLength,
    IsNotEmpty,
    IsDefined,
    Min,
    Max,
    ValidateNested,
    IsArray
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { UserRoleTypeEnum } from '../../../constants/user_role';

/**
 * Query parameters for listing customer users
 */
export class CustomerUserQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Page must be a number' })
    @Min(1, { message: 'Page must be at least 1' })
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Size must be a number' })
    @Min(1, { message: 'Size must be at least 1' })
    @Max(100, { message: 'Size must not exceed 100' })
    size?: number = 10;

    @IsOptional()
    @IsString({ message: 'Order by must be a string' })
    order_by?: string;

    @IsOptional()
    @IsString({ message: 'Filters must be a string' })
    filters?: string;

    @IsOptional()
    @IsString({ message: 'Search term must be a string' })
    @MaxLength(100, { message: 'Search term must not exceed 100 characters' })
    search?: string;

    @IsOptional()
    @IsString({ message: 'Customer ID must be a string' })
    customer_id?: string;

    @IsOptional()
    @IsEnum(UserRoleTypeEnum, { message: 'Invalid user type' })
    user_type?: UserRoleTypeEnum;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean({ message: 'Is deactivated must be a boolean' })
    is_deactivated?: boolean;
}

/**
 * DTO for creating a new customer user
 */
export class CreateCustomerUserDto {
    @IsDefined({ message: 'Name is required' })
    @IsString({ message: 'Name must be a string' })
    @IsNotEmpty({ message: 'Name cannot be empty' })
    @MinLength(3, { message: 'Name must be at least 3 characters long' })
    @MaxLength(140, { message: 'Name must not exceed 140 characters' })
    name: string;

    @IsOptional()
    @IsString({ message: 'User ID must be a string' })
    @MaxLength(140, { message: 'User ID must not exceed 140 characters' })
    user_id?: string;

    @IsOptional()
    @IsString({ message: 'User name must be a string' })
    @MaxLength(140, { message: 'User name must not exceed 140 characters' })
    user_name?: string;

    @IsOptional()
    @IsEmail({}, { message: 'Email must be a valid email address' })
    @MaxLength(140, { message: 'Email must not exceed 140 characters' })
    email?: string;

    @IsOptional()
    @IsString({ message: 'Full name must be a string' })
    @MaxLength(140, { message: 'Full name must not exceed 140 characters' })
    full_name?: string;

    @IsOptional()
    @IsString({ message: 'Phone number must be a string' })
    @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
    phone_number?: string;

    @IsOptional()
    @IsString({ message: 'Customer ID must be a string' })
    @MaxLength(140, { message: 'Customer ID must not exceed 140 characters' })
    customer_id?: string;

    @IsOptional()
    @IsEnum(UserRoleTypeEnum, { message: 'Invalid user type' })
    user_type?: UserRoleTypeEnum;

    @IsOptional()
    @IsString({ message: 'IoT dynamic role must be a string' })
    @MaxLength(140, { message: 'IoT dynamic role must not exceed 140 characters' })
    iot_dynamic_role?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Is deactivated must be a number (0 or 1)' })
    @Min(0, { message: 'Is deactivated must be 0 or 1' })
    @Max(1, { message: 'Is deactivated must be 0 or 1' })
    is_deactivated?: number = 0;
}

/**
 * DTO for updating an existing customer user
 */
export class UpdateCustomerUserDto {
    @IsOptional()
    @IsString({ message: 'User ID must be a string' })
    @MaxLength(140, { message: 'User ID must not exceed 140 characters' })
    user_id?: string;

    @IsOptional()
    @IsString({ message: 'User name must be a string' })
    @MaxLength(140, { message: 'User name must not exceed 140 characters' })
    user_name?: string;

    @IsOptional()
    @IsEmail({}, { message: 'Email must be a valid email address' })
    @MaxLength(140, { message: 'Email must not exceed 140 characters' })
    email?: string;

    @IsOptional()
    @IsString({ message: 'Full name must be a string' })
    @MaxLength(140, { message: 'Full name must not exceed 140 characters' })
    full_name?: string;

    @IsOptional()
    @IsString({ message: 'Phone number must be a string' })
    @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
    phone_number?: string;

    @IsOptional()
    @IsString({ message: 'Customer ID must be a string' })
    @MaxLength(140, { message: 'Customer ID must not exceed 140 characters' })
    customer_id?: string;

    @IsOptional()
    @IsEnum(UserRoleTypeEnum, { message: 'Invalid user type' })
    user_type?: UserRoleTypeEnum;

    @IsOptional()
    @IsString({ message: 'IoT dynamic role must be a string' })
    @MaxLength(140, { message: 'IoT dynamic role must not exceed 140 characters' })
    iot_dynamic_role?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Is deactivated must be a number (0 or 1)' })
    @Min(0, { message: 'Is deactivated must be 0 or 1' })
    @Max(1, { message: 'Is deactivated must be 0 or 1' })
    is_deactivated?: number;
}

/**
 * DTO for customer user path parameters
 */
export class CustomerUserParamsDto {
    @IsDefined({ message: 'Customer user name is required' })
    @IsString({ message: 'Customer user name must be a string' })
    @IsNotEmpty({ message: 'Customer user name cannot be empty' })
    name: string;
}

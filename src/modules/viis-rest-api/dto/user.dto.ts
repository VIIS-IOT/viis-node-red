/**
 * @fileoverview User DTOs with class-validator decorators
 */

import { IsString, IsNotEmpty, IsOptional, IsEmail, IsNumber, Min, Max, IsBoolean } from 'class-validator';

/**
 * Get users query DTO
 */
export class GetUsersQueryDto {
    @IsOptional()
    @IsNumber({}, { message: 'Page must be a number' })
    @Min(1, { message: 'Page must be at least 1' })
    page?: number = 1;

    @IsOptional()
    @IsNumber({}, { message: 'Limit must be a number' })
    @Min(1, { message: 'Limit must be at least 1' })
    @Max(100, { message: 'Limit must not exceed 100' })
    limit?: number = 10;

    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsString()
    sortBy?: string = 'name';

    @IsOptional()
    @IsString()
    sortOrder?: 'ASC' | 'DESC' = 'ASC';
}

/**
 * User ID parameter DTO
 */
export class UserParamsDto {
    @IsString()
    @IsNotEmpty({ message: 'User ID is required' })
    userId: string;
}

/**
 * Update user DTO
 */
export class UpdateUserDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty({ message: 'First name cannot be empty' })
    firstName?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty({ message: 'Last name cannot be empty' })
    lastName?: string;

    @IsOptional()
    @IsEmail({}, { message: 'Please provide a valid email address' })
    email?: string;

    @IsOptional()
    @IsString()
    phoneNumber?: string;

    @IsOptional()
    @IsBoolean({ message: 'Admin status must be a boolean' })
    isAdmin?: boolean;

    @IsOptional()
    @IsString()
    dynamicRole?: string;
}

/**
 * Create user DTO
 */
export class CreateUserDto {
    @IsString()
    @IsNotEmpty({ message: 'Username is required' })
    username: string;

    @IsString()
    @IsNotEmpty({ message: 'Password is required' })
    password: string;

    @IsEmail({}, { message: 'Please provide a valid email address' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @IsOptional()
    @IsString()
    firstName?: string;

    @IsOptional()
    @IsString()
    lastName?: string;

    @IsOptional()
    @IsString()
    phoneNumber?: string;

    @IsOptional()
    @IsString()
    customerId?: string;

    @IsOptional()
    @IsBoolean()
    isAdmin?: boolean = false;

    @IsOptional()
    @IsString()
    dynamicRole?: string;
}

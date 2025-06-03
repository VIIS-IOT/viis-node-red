/**
 * @fileoverview Authentication DTOs with class-validator decorators
 */

import { IsString, IsNotEmpty, MinLength, MaxLength, IsEmail, IsOptional } from 'class-validator';

/**
 * Login request DTO
 */
export class LoginDto {
    @IsString()
    @IsNotEmpty({ message: 'Username is required' })
    @MinLength(3, { message: 'Username must be at least 3 characters long' })
    @MaxLength(50, { message: 'Username must not exceed 50 characters' })
    usr: string;

    @IsString()
    @IsNotEmpty({ message: 'Password is required' })
    @MinLength(6, { message: 'Password must be at least 6 characters long' })
    @MaxLength(100, { message: 'Password must not exceed 100 characters' })
    pwd: string;
}

/**
 * Token verification DTO
 */
export class TokenDto {
    @IsString()
    @IsNotEmpty({ message: 'Token is required' })
    token: string;
}

/**
 * User registration DTO (for future use)
 */
export class RegisterDto {
    @IsString()
    @IsNotEmpty({ message: 'Username is required' })
    @MinLength(3, { message: 'Username must be at least 3 characters long' })
    @MaxLength(50, { message: 'Username must not exceed 50 characters' })
    username: string;

    @IsString()
    @IsNotEmpty({ message: 'Password is required' })
    @MinLength(6, { message: 'Password must be at least 6 characters long' })
    @MaxLength(100, { message: 'Password must not exceed 100 characters' })
    password: string;

    @IsEmail({}, { message: 'Please provide a valid email address' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @IsString()
    @IsOptional()
    @MaxLength(50, { message: 'First name must not exceed 50 characters' })
    firstName?: string;

    @IsString()
    @IsOptional()
    @MaxLength(50, { message: 'Last name must not exceed 50 characters' })
    lastName?: string;

    @IsString()
    @IsOptional()
    @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
    phoneNumber?: string;
}

/**
 * Change password DTO
 */
export class ChangePasswordDto {
    @IsString()
    @IsNotEmpty({ message: 'Current password is required' })
    currentPassword: string;

    @IsString()
    @IsNotEmpty({ message: 'New password is required' })
    @MinLength(6, { message: 'New password must be at least 6 characters long' })
    @MaxLength(100, { message: 'New password must not exceed 100 characters' })
    newPassword: string;

    @IsString()
    @IsNotEmpty({ message: 'Password confirmation is required' })
    confirmPassword: string;
}

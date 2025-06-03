/**
 * @fileoverview Authentication validator using class-validator
 */

import { Service } from 'typedi';
import { BaseValidator } from './base.validator';
import { LoginDto, TokenDto, ChangePasswordDto } from '../dto/auth.dto';

/**
 * Authentication validator class
 */
@Service()
export class AuthValidator extends BaseValidator {
    /**
     * Validate login request
     */
    async validateLogin(data: any): Promise<LoginDto> {
        return this.validate(LoginDto, data);
    }

    /**
     * Validate token
     */
    async validateToken(data: any): Promise<TokenDto> {
        return this.validate(TokenDto, data);
    }

    /**
     * Validate change password request
     */
    async validateChangePassword(data: any): Promise<ChangePasswordDto> {
        return this.validate(ChangePasswordDto, data);
    }

    /**
     * Extract token from authorization header
     */
    extractTokenFromHeader(authHeader: string): string {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Invalid authorization header format');
        }
        return authHeader.substring(7); // Remove 'Bearer ' prefix
    }

    /**
     * Validate authorization header format
     */
    validateAuthHeader(authHeader: string): void {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Invalid authorization header format');
        }
    }

    /**
     * Validate and extract token from request headers
     */
    async validateAndExtractToken(headers: any): Promise<string> {
        const authHeader = headers.authorization;
        this.validateAuthHeader(authHeader);
        return this.extractTokenFromHeader(authHeader);
    }
}

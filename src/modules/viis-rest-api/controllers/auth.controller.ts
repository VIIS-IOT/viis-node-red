/**
 * @fileoverview Authentication controller - Migrated to routing-controllers
 */

import 'reflect-metadata';
import { JsonController, Post, Get, Body, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { AuthValidator } from '../validators/auth.validator';
import { LoginResponse, TokenVerificationResponse } from '../types/auth.types';
import { LoginDto } from '../dto/auth.dto';
import { Node } from 'node-red';
import { AuthService } from '../services/auth.service';
import { logger } from '../utils/logger';

/**
 * Authentication controller class - Migrated to routing-controllers
 *
 * This controller demonstrates the recommended patterns for VIIS API modules:
 * - Uses routing-controllers decorators for automatic route registration
 * - Injects services via constructor with @Inject decorators
 * - Follows consistent error handling and validation patterns
 * - Serves as a template for other API module controllers
 */
@JsonController('/auth')
@Service()
export class AuthController {
    constructor(
        @Inject() private authService: AuthService,
        @Inject() private authValidator: AuthValidator,
        @Inject('node') private node: Node
    ) {
        logger.info(this.node, 'AuthController initialized with routing-controllers');
    }

    /**
     * Login endpoint
     * POST /api/v2/auth/login
     *
     * Demonstrates the recommended validation and response pattern:
     * 1. Validate request body using class-validator DTO
     * 2. Call service method with validated data
     * 3. Return standardized response
     */
    @Post('/login')
    async login(@Body() loginData: LoginDto): Promise<any> {
        // Validate request body using class-validator DTO
        const validatedData = await this.authValidator.validateLogin(loginData);

        logger.info(this.node, `Login attempt for user: ${validatedData.usr}`);

        // Authenticate user
        const loginResponse: LoginResponse = await this.authService.login(validatedData);

        // Return success response
        return loginResponse.result;
    }

    /**
     * Token verification endpoint
     * GET /api/v2/auth/verify
     */
    @Get('/verify')
    @Authorized()
    async verifyToken(@CurrentUser() user: any): Promise<TokenVerificationResponse> {
        // User is already verified by the @Authorized decorator
        // and injected by @CurrentUser decorator

        logger.debug(this.node, 'Token verification successful', {
            userId: user.user_id,
            email: user.email
        });

        // Prepare response
        const response: TokenVerificationResponse = {
            valid: true,
            user: {
                user_id: user.user_id,
                email: user.email,
                customer_id: user.customer_id,
                is_admin: user.is_admin,
                iot_dynamic_role: user.iot_dynamic_role
            }
        };

        return response;
    }

    /**
     * Logout endpoint
     * POST /api/v2/auth/logout
     */
    @Post('/logout')
    @Authorized()
    async logout(@CurrentUser() user: any): Promise<{ message: string }> {
        // User is already verified by the @Authorized decorator
        logger.info(this.node, 'User logout', {
            userId: user.user_id,
            email: user.email
        });

        // For now, just return success (JWT tokens are stateless)
        // In the future, we could implement token blacklisting
        return { message: 'Logged out successfully' };
    }

    /**
     * Get current user info endpoint
     * GET /api/v2/auth/me
     */
    @Get('/me')
    @Authorized()
    async getCurrentUser(@CurrentUser() user: any): Promise<any> {
        // User is already verified by the @Authorized decorator
        logger.debug(this.node, 'Get current user info', {
            userId: user.user_id
        });

        // Get detailed user information from database
        const userInfo = await this.authService.getUserInfo(user.user_id);

        if (!userInfo) {
            throw new Error('User not found');
        }

        return userInfo;
    }
}

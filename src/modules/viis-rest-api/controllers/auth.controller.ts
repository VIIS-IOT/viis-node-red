/**
 * @fileoverview Authentication controller
 */

import { Request, Response } from 'express';
import { Inject } from 'typedi';
import { BaseController } from './base.controller';
import { AuthValidator } from '../validators/auth.validator';
import { Controller } from '../decorators/controller.decorator';
import { RouteDefinition } from '../types/common.types';
import { LoginRequest, LoginResponse, TokenVerificationResponse } from '../types/auth.types';
import { LoginDto } from '../dto/auth.dto';
import { Node } from 'node-red';
import { AuthService } from '../services/auth.service';
import { logger } from '../utils/logger';

/**
 * Authentication controller class
 *
 * This controller demonstrates the recommended patterns for VIIS API modules:
 * - Uses @Controller decorator for dependency injection
 * - Injects services via constructor with @Inject decorators
 * - Follows consistent error handling and validation patterns
 * - Serves as a template for other API module controllers
 */
@Controller('/auth')
export class AuthController extends BaseController {
    constructor(
        @Inject() private authService: AuthService,
        @Inject() private authValidator: AuthValidator,
        @Inject('node') node: Node
    ) {
        super(node);
    }

    /**
     * Get route definitions for authentication endpoints
     */
    getRoutes(): RouteDefinition[] {
        return [
            {
                method: 'POST',
                path: '/auth/login',
                handler: 'login'
            },
            {
                method: 'GET',
                path: '/auth/verify',
                handler: 'verifyToken',
                middleware: ['auth']
            },
            {
                method: 'POST',
                path: '/auth/logout',
                handler: 'logout',
                middleware: ['auth']
            }
        ];
    }

    /**
     * Login endpoint
     *
     * Demonstrates the recommended validation and response pattern:
     * 1. Validate request body using class-validator DTO
     * 2. Call service method with validated data
     * 3. Return standardized response using BaseController helpers
     */
    login = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Validate request body using class-validator DTO
        const loginData: LoginDto = await this.authValidator.validateLogin(req.body);

        logger.info(this.node, `Login attempt for user: ${loginData.usr}`);

        // Authenticate user
        const loginResponse: LoginResponse = await this.authService.login(loginData);

        // Return success response
        this.success(res, loginResponse.result, 200, 'Login successful');
    });

    /**
     * Token verification endpoint
     */
    verifyToken = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Extract token from authorization header
        const token = await this.authValidator.validateAndExtractToken(req.headers);

        // Verify token
        const decoded = await this.authService.verifyToken(token);

        // Prepare response
        const response: TokenVerificationResponse = {
            valid: true,
            user: {
                user_id: decoded.user_id,
                email: decoded.email,
                customer_id: decoded.customer_id,
                is_admin: decoded.is_admin,
                iot_dynamic_role: decoded.iot_dynamic_role
            }
        };

        this.success(res, response, 200, 'Token is valid');
    });

    /**
     * Logout endpoint
     */
    logout = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Get authenticated user
        const user = this.getAuthenticatedUser(req);

        if (!user) {
            return this.authenticationError(res, 'User not authenticated');
        }

        // For now, just return success (JWT tokens are stateless)
        // In the future, we could implement token blacklisting
        this.success(res, { message: 'Logged out successfully' }, 200, 'Logout successful');
    });

    /**
     * Get current user info endpoint
     */
    getCurrentUser = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Get authenticated user
        const user = this.getAuthenticatedUser(req);

        if (!user) {
            return this.authenticationError(res, 'User not authenticated');
        }

        // Get detailed user information from database
        const userInfo = await this.authService.getUserInfo(user.user_id);

        if (!userInfo) {
            return this.notFoundError(res, 'User not found');
        }

        this.success(res, userInfo, 200, 'User information retrieved');
    });
}

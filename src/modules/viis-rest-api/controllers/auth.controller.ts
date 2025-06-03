/**
 * @fileoverview Authentication controller
 */

import { Request, Response } from 'express';
import { BaseController } from './base.controller';
import { AuthValidator } from '../validators/auth.validator';
import { RouteDefinition } from '../types/common.types';
import { LoginRequest, LoginResponse, TokenVerificationResponse } from '../types/auth.types';
import { Node } from 'node-red';
import { AuthService } from '../services/auth.service';

/**
 * Authentication controller class
 */
export class AuthController extends BaseController {
    private authService: AuthService;
    private authValidator: AuthValidator;

    constructor(authService: AuthService, node: Node) {
        super(node);
        this.authService = authService;
        this.authValidator = new AuthValidator();
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
     */
    login = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Validate request body
        const loginData: LoginRequest = req.body;

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

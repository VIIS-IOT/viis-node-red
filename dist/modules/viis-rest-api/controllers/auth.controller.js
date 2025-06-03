"use strict";
/**
 * @fileoverview Authentication controller
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const base_controller_1 = require("./base.controller");
const auth_validator_1 = require("../validators/auth.validator");
const logger_1 = require("../utils/logger");
/**
 * Authentication controller class
 */
class AuthController extends base_controller_1.BaseController {
    constructor(authService, node) {
        super(node);
        /**
         * Login endpoint
         */
        this.login = this.asyncHandler(async (req, res) => {
            // Validate request body
            const loginData = req.body;
            logger_1.logger.warn(this.node, `AuthController.login - this exists: ${!!this}`);
            logger_1.logger.warn(this.node, `AuthController.login - this.authService exists: ${!!this.authService}`);
            // Authenticate user
            const loginResponse = await this.authService.login(loginData);
            // Return success response
            this.success(res, loginResponse.result, 200, 'Login successful');
        });
        /**
         * Token verification endpoint
         */
        this.verifyToken = this.asyncHandler(async (req, res) => {
            // Extract token from authorization header
            const token = await this.authValidator.validateAndExtractToken(req.headers);
            // Verify token
            const decoded = await this.authService.verifyToken(token);
            // Prepare response
            const response = {
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
        this.logout = this.asyncHandler(async (req, res) => {
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
        this.getCurrentUser = this.asyncHandler(async (req, res) => {
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
        this.authService = authService;
        this.authValidator = new auth_validator_1.AuthValidator();
    }
    /**
     * Get route definitions for authentication endpoints
     */
    getRoutes() {
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
}
exports.AuthController = AuthController;

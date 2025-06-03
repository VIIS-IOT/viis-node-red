"use strict";
/**
 * @fileoverview Authentication controller
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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const typedi_1 = require("typedi");
const base_controller_1 = require("./base.controller");
const auth_validator_1 = require("../validators/auth.validator");
const controller_decorator_1 = require("../decorators/controller.decorator");
const auth_service_1 = require("../services/auth.service");
const logger_1 = require("../utils/logger");
/**
 * Authentication controller class
 *
 * This controller demonstrates the recommended patterns for VIIS API modules:
 * - Uses @Controller decorator for dependency injection
 * - Injects services via constructor with @Inject decorators
 * - Follows consistent error handling and validation patterns
 * - Serves as a template for other API module controllers
 */
let AuthController = class AuthController extends base_controller_1.BaseController {
    constructor(authService, authValidator, node) {
        super(node);
        this.authService = authService;
        this.authValidator = authValidator;
        /**
         * Login endpoint
         *
         * Demonstrates the recommended validation and response pattern:
         * 1. Validate request body using class-validator DTO
         * 2. Call service method with validated data
         * 3. Return standardized response using BaseController helpers
         */
        this.login = this.asyncHandler(async (req, res) => {
            // Validate request body using class-validator DTO
            const loginData = await this.authValidator.validateLogin(req.body);
            logger_1.logger.info(this.node, `Login attempt for user: ${loginData.usr}`);
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
};
exports.AuthController = AuthController;
exports.AuthController = AuthController = __decorate([
    (0, controller_decorator_1.Controller)('/auth'),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)()),
    __param(2, (0, typedi_1.Inject)('node')),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        auth_validator_1.AuthValidator, Object])
], AuthController);

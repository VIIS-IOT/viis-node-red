"use strict";
/**
 * @fileoverview Authentication controller - Migrated to routing-controllers
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
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const auth_validator_1 = require("../validators/auth.validator");
const auth_dto_1 = require("../dto/auth.dto");
const auth_service_1 = require("../services/auth.service");
const logger_1 = require("../utils/logger");
/**
 * Authentication controller class - Migrated to routing-controllers
 *
 * This controller demonstrates the recommended patterns for VIIS API modules:
 * - Uses routing-controllers decorators for automatic route registration
 * - Injects services via constructor with @Inject decorators
 * - Follows consistent error handling and validation patterns
 * - Serves as a template for other API module controllers
 */
let AuthController = class AuthController {
    constructor(authService, authValidator, node) {
        this.authService = authService;
        this.authValidator = authValidator;
        this.node = node;
        logger_1.logger.info(this.node, 'AuthController initialized with routing-controllers');
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
    async login(loginData) {
        // Validate request body using class-validator DTO
        const validatedData = await this.authValidator.validateLogin(loginData);
        logger_1.logger.info(this.node, `Login attempt for user: ${validatedData.usr}`);
        // Authenticate user
        const loginResponse = await this.authService.login(validatedData);
        // Return success response
        return loginResponse.result;
    }
    /**
     * Token verification endpoint
     * GET /api/v2/auth/verify
     */
    async verifyToken(user) {
        // User is already verified by the @Authorized decorator
        // and injected by @CurrentUser decorator
        logger_1.logger.debug(this.node, 'Token verification successful', {
            userId: user.user_id,
            email: user.email
        });
        // Prepare response
        const response = {
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
    async logout(user) {
        // User is already verified by the @Authorized decorator
        logger_1.logger.info(this.node, 'User logout', {
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
    async getCurrentUser(user) {
        // User is already verified by the @Authorized decorator
        logger_1.logger.debug(this.node, 'Get current user info', {
            userId: user.user_id
        });
        // Get detailed user information from database
        const userInfo = await this.authService.getUserInfo(user.user_id);
        if (!userInfo) {
            throw new Error('User not found');
        }
        return userInfo;
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, routing_controllers_1.Post)('/login'),
    __param(0, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_dto_1.LoginDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, routing_controllers_1.Get)('/verify'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifyToken", null);
__decorate([
    (0, routing_controllers_1.Post)('/logout'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, routing_controllers_1.Get)('/me'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getCurrentUser", null);
exports.AuthController = AuthController = __decorate([
    (0, routing_controllers_1.JsonController)('/auth'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)()),
    __param(2, (0, typedi_1.Inject)('node')),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        auth_validator_1.AuthValidator, Object])
], AuthController);

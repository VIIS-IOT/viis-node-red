"use strict";
/**
 * @fileoverview User management controller - Migrated to routing-controllers
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
exports.UserController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const database_service_1 = require("../services/database.service");
const user_dto_1 = require("../dto/user.dto");
const user_validator_1 = require("../validators/user.validator");
const logger_1 = require("../utils/logger");
/**
 * User management controller class - Migrated to routing-controllers
 *
 * Demonstrates patterns for user management endpoints:
 * - Pagination and filtering
 * - Role-based access control
 * - Consistent validation and error handling
 */
let UserController = class UserController {
    constructor(databaseService, userValidator, node) {
        this.databaseService = databaseService;
        this.userValidator = userValidator;
        this.node = node;
        logger_1.logger.info(this.node, 'UserController initialized with routing-controllers');
    }
    /**
     * Get all users (admin only)
     * GET /api/v2/users
     */
    async getAllUsers(queryParams) {
        logger_1.logger.info(this.node, 'Get all users request', { queryParams });
        // Validate query parameters
        const validatedParams = await this.userValidator.validateUserQuery(queryParams);
        // Default pagination
        const page = queryParams.page || 1;
        const limit = Math.min(queryParams.limit || 10, 100); // Max 100 items per page
        const offset = (page - 1) * limit;
        // Build query
        const userRepo = this.databaseService.getCustomerUserRepository();
        const queryBuilder = userRepo.createQueryBuilder('user')
            .leftJoinAndSelect('user.iot_customer', 'customer')
            .select([
            'user.name',
            'user.first_name',
            'user.last_name',
            'user.email',
            'user.customer_id',
            'user.is_admin',
            'user.iot_dynamic_role',
            'user.phone_number',
            'user.user_id',
            'user.is_deactivated',
            'customer.name'
        ]);
        // Apply filters
        if (validatedParams.customer_id) {
            queryBuilder.andWhere('user.customer_id = :customerId', { customerId: validatedParams.customer_id });
        }
        if (validatedParams.is_admin !== undefined) {
            queryBuilder.andWhere('user.is_admin = :isAdmin', { isAdmin: validatedParams.is_admin });
        }
        if (validatedParams.iot_dynamic_role) {
            queryBuilder.andWhere('user.iot_dynamic_role = :role', { role: validatedParams.iot_dynamic_role });
        }
        if (validatedParams.search) {
            queryBuilder.andWhere('(user.name LIKE :search OR user.email LIKE :search OR user.first_name LIKE :search OR user.last_name LIKE :search)', { search: `%${validatedParams.search}%` });
        }
        if (validatedParams.is_deactivated !== undefined) {
            queryBuilder.andWhere('user.is_deactivated = :isDeactivated', { isDeactivated: validatedParams.is_deactivated });
        }
        // Get total count
        const total = await queryBuilder.getCount();
        // Apply pagination
        const users = await queryBuilder
            .skip(offset)
            .take(limit)
            .getMany();
        // Transform response
        const userResponses = users.map(user => ({
            name: user.name,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            customer_id: user.customer_id,
            is_admin: user.is_admin,
            iot_dynamic_role: user.iot_dynamic_role,
            phone_number: user.phone_number,
            user_id: user.user_id,
            is_deactivated: user.is_deactivated
        }));
        // Return paginated response
        return {
            data: userResponses,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }
    /**
     * Get current user information
     * GET /api/v2/users/me
     */
    async getCurrentUser(user) {
        logger_1.logger.debug(this.node, 'Get current user request', { userId: user.user_id });
        // Get detailed user information from database
        const userRepo = this.databaseService.getCustomerUserRepository();
        const userInfo = await userRepo.findOne({
            where: { name: user.user_id },
            relations: ['iot_customer'],
            select: [
                'name', 'first_name', 'last_name', 'email',
                'customer_id', 'is_admin', 'iot_dynamic_role',
                'phone_number', 'user_id', 'is_deactivated'
            ]
        });
        if (!userInfo) {
            throw new Error('User not found');
        }
        const response = {
            name: userInfo.name,
            first_name: userInfo.first_name,
            last_name: userInfo.last_name,
            email: userInfo.email,
            customer_id: userInfo.customer_id,
            is_admin: userInfo.is_admin,
            iot_dynamic_role: userInfo.iot_dynamic_role,
            phone_number: userInfo.phone_number,
            user_id: userInfo.user_id,
            is_deactivated: userInfo.is_deactivated
        };
        return response;
    }
    /**
     * Get user by ID
     * GET /api/v2/users/:userId
     */
    async getUserById(userId, currentUser) {
        logger_1.logger.debug(this.node, 'Get user by ID request', { userId, requestedBy: currentUser.user_id });
        // Validate userId parameter
        const { userId: validatedUserId } = await this.userValidator.validateUserIdParam({ userId });
        // Check if user can access this user's information
        if (!currentUser.is_admin && currentUser.user_id !== validatedUserId) {
            throw new Error('You can only access your own user information');
        }
        // Get user information
        const userRepo = this.databaseService.getCustomerUserRepository();
        const userInfo = await userRepo.findOne({
            where: { name: validatedUserId },
            relations: ['iot_customer'],
            select: [
                'name', 'first_name', 'last_name', 'email',
                'customer_id', 'is_admin', 'iot_dynamic_role',
                'phone_number', 'user_id', 'is_deactivated'
            ]
        });
        if (!userInfo) {
            throw new Error('User not found');
        }
        // Check customer access for non-admin users
        if (!currentUser.is_admin && userInfo.customer_id !== currentUser.customer_id) {
            throw new Error('Access denied: Different customer');
        }
        const response = {
            name: userInfo.name,
            first_name: userInfo.first_name,
            last_name: userInfo.last_name,
            email: userInfo.email,
            customer_id: userInfo.customer_id,
            is_admin: userInfo.is_admin,
            iot_dynamic_role: userInfo.iot_dynamic_role,
            phone_number: userInfo.phone_number,
            user_id: userInfo.user_id,
            is_deactivated: userInfo.is_deactivated
        };
        return response;
    }
};
exports.UserController = UserController;
__decorate([
    (0, routing_controllers_1.Get)('/'),
    (0, routing_controllers_1.Authorized)(['admin']),
    __param(0, (0, routing_controllers_1.QueryParams)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [user_dto_1.GetUsersQueryDto]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getAllUsers", null);
__decorate([
    (0, routing_controllers_1.Get)('/me'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getCurrentUser", null);
__decorate([
    (0, routing_controllers_1.Get)('/:userId'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('userId')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getUserById", null);
exports.UserController = UserController = __decorate([
    (0, routing_controllers_1.JsonController)('/users'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)()),
    __param(2, (0, typedi_1.Inject)('node')),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        user_validator_1.UserValidator, Object])
], UserController);

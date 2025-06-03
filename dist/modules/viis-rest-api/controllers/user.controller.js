"use strict";
/**
 * @fileoverview User management controller
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
const typedi_1 = require("typedi");
const base_controller_1 = require("./base.controller");
const database_service_1 = require("../services/database.service");
const controller_decorator_1 = require("../decorators/controller.decorator");
const user_validator_1 = require("../validators/user.validator");
/**
 * User management controller class
 *
 * Demonstrates patterns for user management endpoints:
 * - Pagination and filtering
 * - Role-based access control
 * - Consistent validation and error handling
 */
let UserController = class UserController extends base_controller_1.BaseController {
    constructor(databaseService, userValidator, node) {
        super(node);
        this.databaseService = databaseService;
        this.userValidator = userValidator;
        /**
         * Get all users (admin only)
         */
        this.getAllUsers = this.asyncHandler(async (req, res) => {
            // Validate query parameters
            const queryParams = await this.userValidator.validateUserQuery(req.query);
            const { page, limit, offset } = this.getPaginationParams(req);
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
            if (queryParams.customer_id) {
                queryBuilder.andWhere('user.customer_id = :customerId', { customerId: queryParams.customer_id });
            }
            if (queryParams.is_admin !== undefined) {
                queryBuilder.andWhere('user.is_admin = :isAdmin', { isAdmin: queryParams.is_admin });
            }
            if (queryParams.iot_dynamic_role) {
                queryBuilder.andWhere('user.iot_dynamic_role = :role', { role: queryParams.iot_dynamic_role });
            }
            if (queryParams.search) {
                queryBuilder.andWhere('(user.name LIKE :search OR user.email LIKE :search OR user.first_name LIKE :search OR user.last_name LIKE :search)', { search: `%${queryParams.search}%` });
            }
            if (queryParams.is_deactivated !== undefined) {
                queryBuilder.andWhere('user.is_deactivated = :isDeactivated', { isDeactivated: queryParams.is_deactivated });
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
            this.success(res, {
                data: userResponses,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }, 200, 'Users retrieved successfully');
        });
        /**
         * Get current user information
         */
        this.getCurrentUser = this.asyncHandler(async (req, res) => {
            const user = this.getAuthenticatedUser(req);
            if (!user) {
                return this.authenticationError(res, 'User not authenticated');
            }
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
                return this.notFoundError(res, 'User not found');
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
            this.success(res, response, 200, 'User information retrieved');
        });
        /**
         * Get user by ID
         */
        this.getUserById = this.asyncHandler(async (req, res) => {
            const { userId } = await this.userValidator.validateUserIdParam(req.params);
            const currentUser = this.getAuthenticatedUser(req);
            // Check if user can access this user's information
            if (!this.isAdmin(req) && currentUser.user_id !== userId) {
                return this.authorizationError(res, 'You can only access your own user information');
            }
            // Get user information
            const userRepo = this.databaseService.getCustomerUserRepository();
            const userInfo = await userRepo.findOne({
                where: { name: userId },
                relations: ['iot_customer'],
                select: [
                    'name', 'first_name', 'last_name', 'email',
                    'customer_id', 'is_admin', 'iot_dynamic_role',
                    'phone_number', 'user_id', 'is_deactivated'
                ]
            });
            if (!userInfo) {
                return this.notFoundError(res, 'User not found');
            }
            // Check customer access for non-admin users
            if (!this.isAdmin(req) && userInfo.customer_id !== currentUser.customer_id) {
                return this.authorizationError(res, 'Access denied: Different customer');
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
            this.success(res, response, 200, 'User information retrieved');
        });
    }
    /**
     * Get route definitions for user endpoints
     */
    getRoutes() {
        return [
            {
                method: 'GET',
                path: '/users',
                handler: 'getAllUsers',
                middleware: ['auth', 'admin', 'pagination']
            },
            {
                method: 'GET',
                path: '/users/me',
                handler: 'getCurrentUser',
                middleware: ['auth']
            },
            {
                method: 'GET',
                path: '/users/:userId',
                handler: 'getUserById',
                middleware: ['auth', 'customer']
            }
        ];
    }
};
exports.UserController = UserController;
exports.UserController = UserController = __decorate([
    (0, controller_decorator_1.Controller)('/users'),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)()),
    __param(2, (0, typedi_1.Inject)('node')),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        user_validator_1.UserValidator, Object])
], UserController);

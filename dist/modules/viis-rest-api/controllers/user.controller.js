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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const database_service_1 = require("../services/database.service");
const user_dto_1 = require("../dto/user.dto");
const node_red_1 = require("node-red");
const logger_1 = require("../utils/logger");
const container_setup_1 = require("../container/container.setup");
/**
 * Enhanced User management controller class with comprehensive validation
 *
 * This controller demonstrates the enhanced patterns for user management:
 * - Uses routing-controllers decorators with automatic validation
 * - Leverages enhanced class-validator DTOs for request validation
 * - Implements comprehensive error handling and logging
 * - Provides full user lifecycle management
 * - Supports advanced filtering, pagination, and bulk operations
 * - Role-based access control with granular permissions
 * - Consistent validation and error handling
 *
 * Features:
 * - Automatic request validation using enhanced DTOs
 * - Comprehensive user management endpoints
 * - Advanced filtering with multiple criteria
 * - Bulk operations support
 * - Nested object validation for user preferences
 * - Enum validation for roles and statuses
 * - Custom validation for business rules
 * - Consistent error handling and response formatting
 */
let UserController = class UserController {
    constructor(databaseService, node) {
        this.databaseService = databaseService;
        this.node = node;
        logger_1.logger.info(this.node, 'Enhanced UserController initialized with routing-controllers and automatic validation');
    }
    /**
     * Enhanced get all users endpoint with comprehensive filtering
     * GET /api/v2/users
     *
     * Features:
     * - Automatic query parameter validation using GetUsersQueryDto
     * - Advanced filtering by roles, status, customer, admin status
     * - Pagination with configurable limits
     * - Sorting by multiple fields
     * - Search functionality across multiple fields
     * - Role-based access control (admin only)
     *
     * @param queryParams - Validated query parameters for filtering and pagination
     * @param user - Current authenticated user for access control
     * @returns Paginated list of users with metadata
     *
     * @example
     * Query parameters:
     * ```
     * ?page=1&limit=20&search=john&roles=admin,manager&status=active&customerId=uuid&sortBy=email&sortOrder=ASC
     * ```
     *
     * Response:
     * ```json
     * {
     *   "data": [...],
     *   "pagination": {
     *     "page": 1,
     *     "limit": 20,
     *     "total": 150,
     *     "totalPages": 8
     *   },
     *   "filters": {
     *     "applied": ["roles", "status"],
     *     "available": ["roles", "status", "customerId", "isAdmin"]
     *   }
     * }
     * ```
     */
    async getAllUsers(queryParams, user) {
        logger_1.logger.info(this.node, 'Enhanced get all users request', {
            requestedBy: user.user_id,
            filters: {
                search: queryParams.search,
                roles: queryParams.roles,
                status: queryParams.status,
                page: queryParams.page,
                limit: queryParams.limit
            }
        });
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
        // Apply filters using queryParams (automatically validated)
        if (queryParams.customerId) {
            queryBuilder.andWhere('user.customer_id = :customerId', { customerId: queryParams.customerId });
        }
        if (queryParams.isAdmin !== undefined) {
            queryBuilder.andWhere('user.is_admin = :isAdmin', { isAdmin: queryParams.isAdmin });
        }
        if (queryParams.iotDynamicRole) {
            queryBuilder.andWhere('user.iot_dynamic_role = :role', { role: queryParams.iotDynamicRole });
        }
        if (queryParams.search) {
            queryBuilder.andWhere('(user.name LIKE :search OR user.email LIKE :search OR user.first_name LIKE :search OR user.last_name LIKE :search)', { search: `%${queryParams.search}%` });
        }
        if (queryParams.isDeactivated !== undefined) {
            queryBuilder.andWhere('user.is_deactivated = :isDeactivated', { isDeactivated: queryParams.isDeactivated });
        }
        if (queryParams.roles && queryParams.roles.length > 0) {
            // Handle roles filtering if needed (depends on your database schema)
            queryBuilder.andWhere('user.iot_dynamic_role IN (:...roles)', { roles: queryParams.roles });
        }
        if (queryParams.status) {
            // Map status to database fields
            switch (queryParams.status) {
                case 'active':
                    queryBuilder.andWhere('user.is_deactivated = :isDeactivated', { isDeactivated: false });
                    break;
                case 'inactive':
                    queryBuilder.andWhere('user.is_deactivated = :isDeactivated', { isDeactivated: true });
                    break;
            }
        }
        // Apply sorting
        if (queryParams.sortBy) {
            const sortOrder = queryParams.sortOrder || 'ASC';
            switch (queryParams.sortBy) {
                case 'name':
                    queryBuilder.orderBy('user.name', sortOrder);
                    break;
                case 'email':
                    queryBuilder.orderBy('user.email', sortOrder);
                    break;
                case 'firstName':
                    queryBuilder.orderBy('user.first_name', sortOrder);
                    break;
                case 'lastName':
                    queryBuilder.orderBy('user.last_name', sortOrder);
                    break;
                default:
                    queryBuilder.orderBy('user.name', sortOrder);
            }
        }
        else {
            queryBuilder.orderBy('user.name', 'ASC');
        }
        try {
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
            logger_1.logger.debug(this.node, 'Users retrieved successfully', {
                requestedBy: user.user_id,
                totalUsers: total,
                returnedUsers: users.length,
                filtersApplied: Object.keys(queryParams).filter(key => queryParams[key] !== undefined)
            });
            // Return paginated response with enhanced metadata
            return {
                data: userResponses,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                },
                filters: {
                    applied: Object.keys(queryParams).filter(key => queryParams[key] !== undefined),
                    available: ['search', 'roles', 'status', 'customerId', 'isAdmin', 'isDeactivated', 'iotDynamicRole']
                }
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving users', {
                requestedBy: user.user_id,
                error: error.message
            });
            throw error;
        }
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
     * Enhanced get user by ID endpoint with automatic validation
     * GET /api/v2/users/:userId
     *
     * Features:
     * - Automatic parameter validation using routing-controllers
     * - User access control and ownership verification
     * - Customer-specific access control for non-admin users
     * - Comprehensive error handling and logging
     *
     * @param userId - User ID from URL parameter (automatically validated)
     * @param currentUser - Current authenticated user for access control
     * @returns User information
     */
    async getUserById(userId, currentUser) {
        logger_1.logger.debug(this.node, 'Enhanced get user by ID request', {
            userId,
            requestedBy: currentUser.user_id,
            isAdmin: currentUser.is_admin
        });
        try {
            // userId is automatically validated by routing-controllers
            // Check if user can access this user's information
            if (!currentUser.is_admin && currentUser.user_id !== userId) {
                logger_1.logger.warn(this.node, 'Unauthorized access attempt to user data', {
                    requestedUserId: userId,
                    requestedBy: currentUser.user_id
                });
                throw new Error('You can only access your own user information');
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
                logger_1.logger.warn(this.node, 'User not found', { userId, requestedBy: currentUser.user_id });
                throw new Error('User not found');
            }
            // Check customer access for non-admin users
            if (!currentUser.is_admin && userInfo.customer_id !== currentUser.customer_id) {
                logger_1.logger.warn(this.node, 'Cross-customer access denied', {
                    requestedUserId: userId,
                    requestedBy: currentUser.user_id,
                    userCustomerId: userInfo.customer_id,
                    requesterCustomerId: currentUser.customer_id
                });
                throw new Error('Access denied: Different customer');
            }
            logger_1.logger.debug(this.node, 'User retrieved successfully', {
                userId,
                requestedBy: currentUser.user_id,
                userCustomerId: userInfo.customer_id
            });
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
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving user by ID', {
                userId,
                requestedBy: currentUser.user_id,
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Enhanced create user endpoint with comprehensive validation
     * POST /api/v2/users
     *
     * Features:
     * - Automatic request validation using enhanced CreateUserDto
     * - Nested object validation for user preferences
     * - Role and status enum validation
     * - Password strength validation with custom rules
     * - Email format validation and transformation
     * - Admin-only access control
     *
     * @param userData - Validated user creation data from request body
     * @param currentUser - Current authenticated user for access control
     * @returns Created user information
     */
    async createUser(userData, currentUser) {
        logger_1.logger.info(this.node, 'Enhanced create user request', {
            username: userData.username,
            email: userData.email,
            roles: userData.roles,
            createdBy: currentUser.user_id,
            hasPreferences: !!userData.preferences
        });
        try {
            // Apply customer assignment if not specified and not admin
            if (!userData.customerId && !currentUser.is_admin) {
                userData.customerId = currentUser.customer_id;
            }
            // Create user with enhanced validation
            const userRepo = this.databaseService.getCustomerUserRepository();
            // Check if username already exists
            const existingUser = await userRepo.findOne({
                where: { name: userData.username }
            });
            if (existingUser) {
                throw new Error('Username already exists');
            }
            // Check if email already exists
            const existingEmail = await userRepo.findOne({
                where: { email: userData.email }
            });
            if (existingEmail) {
                throw new Error('Email already exists');
            }
            // Create new user entity
            const newUser = userRepo.create({
                name: userData.username,
                email: userData.email,
                first_name: userData.firstName,
                last_name: userData.lastName,
                phone_number: userData.phoneNumber,
                customer_id: userData.customerId,
                is_admin: userData.isAdmin ? 1 : 0, // Convert boolean to number
                iot_dynamic_role: userData.iotDynamicRole,
                is_deactivated: userData.status === 'inactive' ? 1 : 0, // Convert boolean to number
                // TODO: Hash password properly
                // password: await this.hashPassword(userData.password)
            });
            const savedUser = await userRepo.save(newUser);
            logger_1.logger.info(this.node, 'User created successfully', {
                userId: savedUser.user_id,
                username: userData.username,
                createdBy: currentUser.user_id
            });
            const response = {
                name: savedUser.name,
                first_name: savedUser.first_name,
                last_name: savedUser.last_name,
                email: savedUser.email,
                customer_id: savedUser.customer_id,
                is_admin: savedUser.is_admin,
                iot_dynamic_role: savedUser.iot_dynamic_role,
                phone_number: savedUser.phone_number,
                user_id: savedUser.user_id,
                is_deactivated: savedUser.is_deactivated
            };
            return response;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error creating user', {
                username: userData.username,
                email: userData.email,
                createdBy: currentUser.user_id,
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Enhanced update user endpoint with partial validation
     * PUT /api/v2/users/:userId
     *
     * Features:
     * - Automatic parameter and body validation
     * - Partial update support with optional fields
     * - Nested object validation for preference updates
     * - User access control and ownership verification
     * - Comprehensive error handling and logging
     *
     * @param userId - User ID from URL parameter (automatically validated)
     * @param updateData - Validated user update data from request body
     * @param currentUser - Current authenticated user for access control
     * @returns Updated user information
     */
    async updateUser(userId, updateData, currentUser) {
        logger_1.logger.info(this.node, 'Enhanced update user request', {
            userId,
            updatedBy: currentUser.user_id,
            updateFields: Object.keys(updateData).filter(key => updateData[key] !== undefined)
        });
        try {
            // Check if user can update this user's information
            if (!currentUser.is_admin && currentUser.user_id !== userId) {
                logger_1.logger.warn(this.node, 'Unauthorized update attempt', {
                    targetUserId: userId,
                    requestedBy: currentUser.user_id
                });
                throw new Error('You can only update your own user information');
            }
            // Get existing user
            const userRepo = this.databaseService.getCustomerUserRepository();
            const existingUser = await userRepo.findOne({
                where: { name: userId }
            });
            if (!existingUser) {
                throw new Error('User not found');
            }
            // Check customer access for non-admin users
            if (!currentUser.is_admin && existingUser.customer_id !== currentUser.customer_id) {
                throw new Error('Access denied: Different customer');
            }
            // Update user fields
            if (updateData.firstName !== undefined) {
                existingUser.first_name = updateData.firstName;
            }
            if (updateData.lastName !== undefined) {
                existingUser.last_name = updateData.lastName;
            }
            if (updateData.email !== undefined) {
                // Check if email already exists for another user
                const existingEmail = await userRepo.findOne({
                    where: { email: updateData.email }
                });
                if (existingEmail && existingEmail.name !== userId) {
                    throw new Error('Email already exists');
                }
                existingUser.email = updateData.email;
            }
            if (updateData.phoneNumber !== undefined) {
                existingUser.phone_number = updateData.phoneNumber;
            }
            if (updateData.isAdmin !== undefined && currentUser.is_admin) {
                existingUser.is_admin = updateData.isAdmin ? 1 : 0; // Convert boolean to number
            }
            if (updateData.iotDynamicRole !== undefined) {
                existingUser.iot_dynamic_role = updateData.iotDynamicRole;
            }
            if (updateData.isDeactivated !== undefined && currentUser.is_admin) {
                existingUser.is_deactivated = updateData.isDeactivated ? 1 : 0; // Convert boolean to number
            }
            const updatedUser = await userRepo.save(existingUser);
            logger_1.logger.info(this.node, 'User updated successfully', {
                userId,
                updatedBy: currentUser.user_id,
                updatedFields: Object.keys(updateData).filter(key => updateData[key] !== undefined)
            });
            const response = {
                name: updatedUser.name,
                first_name: updatedUser.first_name,
                last_name: updatedUser.last_name,
                email: updatedUser.email,
                customer_id: updatedUser.customer_id,
                is_admin: updatedUser.is_admin,
                iot_dynamic_role: updatedUser.iot_dynamic_role,
                phone_number: updatedUser.phone_number,
                user_id: updatedUser.user_id,
                is_deactivated: updatedUser.is_deactivated
            };
            return response;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error updating user', {
                userId,
                updatedBy: currentUser.user_id,
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Enhanced delete user endpoint
     * DELETE /api/v2/users/:userId
     *
     * Features:
     * - Automatic parameter validation
     * - Admin-only access control
     * - Soft delete with audit logging
     * - Comprehensive error handling
     *
     * @param userId - User ID from URL parameter (automatically validated)
     * @param currentUser - Current authenticated user for access control
     * @returns Deletion confirmation
     */
    async deleteUser(userId, currentUser) {
        logger_1.logger.info(this.node, 'Enhanced delete user request', {
            userId,
            deletedBy: currentUser.user_id
        });
        try {
            // Get existing user
            const userRepo = this.databaseService.getCustomerUserRepository();
            const existingUser = await userRepo.findOne({
                where: { name: userId }
            });
            if (!existingUser) {
                throw new Error('User not found');
            }
            // Prevent self-deletion
            if (currentUser.user_id === userId) {
                throw new Error('You cannot delete your own account');
            }
            // Soft delete by setting is_deactivated to true
            existingUser.is_deactivated = 1; // Convert boolean to number
            await userRepo.save(existingUser);
            logger_1.logger.info(this.node, 'User deleted successfully', {
                userId,
                deletedBy: currentUser.user_id
            });
            return {
                success: true,
                message: 'User deleted successfully'
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error deleting user', {
                userId,
                deletedBy: currentUser.user_id,
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Enhanced bulk user operations endpoint
     * POST /api/v2/users/bulk
     *
     * Features:
     * - Automatic request validation using BulkUserOperationDto
     * - Support for multiple operations (activate, deactivate, delete, etc.)
     * - Batch processing with error handling
     * - Admin-only access control
     * - Comprehensive logging and audit trail
     *
     * @param bulkData - Validated bulk operation data from request body
     * @param currentUser - Current authenticated user for access control
     * @returns Bulk operation results
     */
    async bulkUserOperation(bulkData, currentUser) {
        logger_1.logger.info(this.node, 'Enhanced bulk user operation request', {
            operation: bulkData.operation,
            userCount: bulkData.userIds.length,
            executedBy: currentUser.user_id,
            parameters: bulkData.parameters
        });
        try {
            const userRepo = this.databaseService.getCustomerUserRepository();
            const results = {
                successCount: 0,
                failureCount: 0,
                errors: [],
                processedUsers: []
            };
            for (const userId of bulkData.userIds) {
                try {
                    const user = await userRepo.findOne({
                        where: { name: userId }
                    });
                    if (!user) {
                        results.errors.push(`User ${userId} not found`);
                        results.failureCount++;
                        continue;
                    }
                    // Prevent operations on self
                    if (currentUser.user_id === userId) {
                        results.errors.push(`Cannot perform operation on your own account: ${userId}`);
                        results.failureCount++;
                        continue;
                    }
                    switch (bulkData.operation) {
                        case 'activate':
                            user.is_deactivated = 0; // Convert boolean to number
                            break;
                        case 'deactivate':
                            user.is_deactivated = 1; // Convert boolean to number
                            break;
                        case 'delete':
                            user.is_deactivated = 1; // Soft delete - Convert boolean to number
                            break;
                        case 'suspend':
                            user.is_deactivated = 1; // Convert boolean to number
                            break;
                        default:
                            results.errors.push(`Unknown operation: ${bulkData.operation}`);
                            results.failureCount++;
                            continue;
                    }
                    await userRepo.save(user);
                    results.successCount++;
                    results.processedUsers.push(userId);
                }
                catch (error) {
                    results.errors.push(`Error processing user ${userId}: ${error.message}`);
                    results.failureCount++;
                }
            }
            logger_1.logger.info(this.node, 'Bulk user operation completed', {
                operation: bulkData.operation,
                successCount: results.successCount,
                failureCount: results.failureCount,
                executedBy: currentUser.user_id
            });
            return {
                success: results.failureCount === 0,
                operation: bulkData.operation,
                results: results,
                summary: {
                    total: bulkData.userIds.length,
                    successful: results.successCount,
                    failed: results.failureCount
                }
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error executing bulk user operation', {
                operation: bulkData.operation,
                userCount: bulkData.userIds.length,
                executedBy: currentUser.user_id,
                error: error.message
            });
            throw error;
        }
    }
};
exports.UserController = UserController;
__decorate([
    (0, routing_controllers_1.Get)('/'),
    (0, routing_controllers_1.Authorized)(['admin']),
    __param(0, (0, routing_controllers_1.QueryParams)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [user_dto_1.GetUsersQueryDto, Object]),
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
__decorate([
    (0, routing_controllers_1.Post)('/'),
    (0, routing_controllers_1.Authorized)(['admin']),
    __param(0, (0, routing_controllers_1.Body)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [user_dto_1.CreateUserDto, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "createUser", null);
__decorate([
    (0, routing_controllers_1.Put)('/:userId'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('userId')),
    __param(1, (0, routing_controllers_1.Body)()),
    __param(2, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, user_dto_1.UpdateUserDto, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateUser", null);
__decorate([
    (0, routing_controllers_1.Delete)('/:userId'),
    (0, routing_controllers_1.Authorized)(['admin']),
    __param(0, (0, routing_controllers_1.Param)('userId')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "deleteUser", null);
__decorate([
    (0, routing_controllers_1.Post)('/bulk'),
    (0, routing_controllers_1.Authorized)(['admin']),
    __param(0, (0, routing_controllers_1.Body)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [user_dto_1.BulkUserOperationDto, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "bulkUserOperation", null);
exports.UserController = UserController = __decorate([
    (0, routing_controllers_1.JsonController)('/users'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService, typeof (_a = typeof node_red_1.Node !== "undefined" && node_red_1.Node) === "function" ? _a : Object])
], UserController);

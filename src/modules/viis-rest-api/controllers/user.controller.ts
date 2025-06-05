/**
 * @fileoverview User management controller - Migrated to routing-controllers
 */

import 'reflect-metadata';
import { JsonController, Get, Param, QueryParams, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { DatabaseService } from '../services/database.service';
import { UserQueryParams, UserResponse } from '../types/user.types';
import { GetUsersQueryDto, UserParamsDto } from '../dto/user.dto';
import { Node } from 'node-red';
import { UserValidator } from '../validators/user.validator';
import { logger } from '../utils/logger';

/**
 * User management controller class - Migrated to routing-controllers
 *
 * Demonstrates patterns for user management endpoints:
 * - Pagination and filtering
 * - Role-based access control
 * - Consistent validation and error handling
 */
@JsonController('/users')
@Service()
export class UserController {
    constructor(
        @Inject() private databaseService: DatabaseService,
        @Inject() private userValidator: UserValidator,
        @Inject('node') private node: Node
    ) {
        logger.info(this.node, 'UserController initialized with routing-controllers');
    }



    /**
     * Get all users (admin only)
     * GET /api/v2/users
     */
    @Get('/')
    @Authorized(['admin'])
    async getAllUsers(@QueryParams() queryParams: GetUsersQueryDto): Promise<any> {
        logger.info(this.node, 'Get all users request', { queryParams });

        // Validate query parameters
        const validatedParams: UserQueryParams = await this.userValidator.validateUserQuery(queryParams);

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
            queryBuilder.andWhere(
                '(user.name LIKE :search OR user.email LIKE :search OR user.first_name LIKE :search OR user.last_name LIKE :search)',
                { search: `%${validatedParams.search}%` }
            );
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
        const userResponses: UserResponse[] = users.map(user => ({
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
    @Get('/me')
    @Authorized()
    async getCurrentUser(@CurrentUser() user: any): Promise<UserResponse> {
        logger.debug(this.node, 'Get current user request', { userId: user.user_id });

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

        const response: UserResponse = {
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
    @Get('/:userId')
    @Authorized()
    async getUserById(@Param('userId') userId: string, @CurrentUser() currentUser: any): Promise<UserResponse> {
        logger.debug(this.node, 'Get user by ID request', { userId, requestedBy: currentUser.user_id });

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

        const response: UserResponse = {
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
}

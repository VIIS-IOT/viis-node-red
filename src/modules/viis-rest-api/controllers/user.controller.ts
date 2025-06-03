/**
 * @fileoverview User management controller
 */

import { Request, Response } from 'express';
import { BaseController } from './base.controller';
import { DatabaseService } from '../services/database.service';
import { RouteDefinition } from '../types/common.types';
import { UserQueryParams, UserResponse } from '../types/user.types';
import { Node } from 'node-red';
import { UserValidator } from '../validators/user.validator';

/**
 * User management controller class
 */
export class UserController extends BaseController {
    private databaseService: DatabaseService;
    private userValidator: UserValidator;

    constructor(databaseService: DatabaseService, node: Node) {
        super(node);
        this.databaseService = databaseService;
        this.userValidator = new UserValidator();
    }

    /**
     * Get route definitions for user endpoints
     */
    getRoutes(): RouteDefinition[] {
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

    /**
     * Get all users (admin only)
     */
    getAllUsers = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Validate query parameters
        const queryParams: UserQueryParams = await this.userValidator.validateUserQuery(req.query);
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
            queryBuilder.andWhere(
                '(user.name LIKE :search OR user.email LIKE :search OR user.first_name LIKE :search OR user.last_name LIKE :search)',
                { search: `%${queryParams.search}%` }
            );
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
    getCurrentUser = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
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

        this.success(res, response, 200, 'User information retrieved');
    });

    /**
     * Get user by ID
     */
    getUserById = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
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

        this.success(res, response, 200, 'User information retrieved');
    });
}

/**
 * @fileoverview Customer User management controller
 */

import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, QueryParams, Body, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { DatabaseService } from '../services/database.service';
import {
    CustomerUserQueryDto,
    CreateCustomerUserDto,
    UpdateCustomerUserDto
} from '../dto/customer-user.dto';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { NODE_TOKEN } from '../container/container.setup';
import { applyQueryFilters, FilterTuple } from '../utils/query-filters.util';

/**
 * Customer User management controller class
 * 
 * This controller provides full CRUD operations for customer users:
 * - Uses routing-controllers decorators with automatic validation
 * - Implements comprehensive error handling and logging
 * - Supports dynamic filtering and pagination
 * - Token-based authentication with @Authorized() decorator
 */
@JsonController('/customer-users')
@Service()
export class CustomerUserController {
    constructor(
        @Inject() private databaseService: DatabaseService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        logger.info(this.node, 'CustomerUserController initialized');
    }

    /**
     * Get all customer users with filtering and pagination
     * GET /api/v2/customer-users
     */
    @Get('/')
    @Authorized()
    async getAllCustomerUsers(
        @QueryParams() queryParams: CustomerUserQueryDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get all customer users request', {
            requestedBy: user?.user_id,
            filters: queryParams
        });

        try {
            const page = queryParams.page || 1;
            const size = Math.min(queryParams.size || 10, 100);
            const skip = (page - 1) * size;

            const customerUserRepo = this.databaseService.getCustomerUserRepository();
            let qb = customerUserRepo.createQueryBuilder('customer_user')
                .leftJoinAndSelect('customer_user.iot_customer', 'customer')
                .leftJoinAndSelect('customer_user.dynamicRole', 'dynamicRole');

            // Apply dynamic filters if provided
            if (queryParams.filters) {
                try {
                    const parsedFilters: FilterTuple[] = JSON.parse(queryParams.filters);
                    qb = applyQueryFilters(qb, parsedFilters, 'customer_user');
                } catch (parseError) {
                    logger.error(this.node, 'Failed to parse filters:', { filters: queryParams.filters, error: parseError });
                    throw new Error('Invalid filters format');
                }
            }

            // Apply search filter
            if (queryParams.search) {
                qb.andWhere(
                    '(customer_user.name ILIKE :search OR customer_user.email ILIKE :search OR customer_user.full_name ILIKE :search OR customer_user.user_name ILIKE :search)',
                    { search: `%${queryParams.search}%` }
                );
            }

            // Apply specific filters
            if (queryParams.customer_id) {
                qb.andWhere('customer_user.customer_id = :customer_id', { customer_id: queryParams.customer_id });
            }

            if (queryParams.user_type) {
                qb.andWhere('customer_user.user_type = :user_type', { user_type: queryParams.user_type });
            }

            if (queryParams.is_deactivated !== undefined) {
                qb.andWhere('customer_user.is_deactivated = :is_deactivated', { is_deactivated: queryParams.is_deactivated ? 1 : 0 });
            }

            // Apply ordering
            if (queryParams.order_by) {
                const [field, direction] = queryParams.order_by.split(' ');
                qb.orderBy(`customer_user.${field}`, direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC');
            } else {
                qb.orderBy('customer_user.created_at', 'DESC');
            }

            // Get total count
            const total = await qb.getCount();

            // Apply pagination
            const data = await qb.skip(skip).take(size).getMany();

            logger.info(this.node, 'Customer users retrieved successfully', {
                requestedBy: user?.user_id,
                total,
                returned: data.length,
                page,
                size
            });

            return {
                data,
                page,
                size,
                total,
                totalPages: Math.ceil(total / size)
            };
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving customer users:', error);
            throw error;
        }
    }

    /**
     * Get a specific customer user by name
     * GET /api/v2/customer-users/:name
     */
    @Get('/:name')
    @Authorized()
    async getCustomerUser(
        @Param('name') name: string,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Get customer user request', {
            requestedBy: user?.user_id,
            customerUserName: name
        });

        try {
            const customerUserRepo = this.databaseService.getCustomerUserRepository();
            const customerUser = await customerUserRepo.findOne({
                where: { name: name },
                relations: ['iot_customer', 'dynamicRole', 'credential']
            });

            if (!customerUser) {
                logger.warn(this.node, 'Customer user not found', { name: name });
                throw new Error('Customer user not found');
            }

            logger.info(this.node, 'Customer user retrieved successfully', {
                requestedBy: user?.user_id,
                customerUserName: name
            });

            return customerUser;
        } catch (error: any) {
            logger.error(this.node, 'Error retrieving customer user:', error);
            throw error;
        }
    }

    /**
     * Create a new customer user
     * POST /api/v2/customer-users
     */
    @Post('/')
    @Authorized()
    async createCustomerUser(
        @Body() userData: CreateCustomerUserDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Create customer user request', {
            requestedBy: user?.user_id,
            customerUserName: userData.name
        });

        try {
            const customerUserRepo = this.databaseService.getCustomerUserRepository();

            // Check if customer user already exists
            const existingUser = await customerUserRepo.findOne({
                where: { name: userData.name }
            });

            if (existingUser) {
                logger.warn(this.node, 'Customer user already exists', { name: userData.name });
                throw new Error('Customer user with this name already exists');
            }

            // Create new customer user
            const newCustomerUser = customerUserRepo.create({
                ...userData,
                created_time: new Date()
            });

            const savedCustomerUser = await customerUserRepo.save(newCustomerUser);

            logger.info(this.node, 'Customer user created successfully', {
                requestedBy: user?.user_id,
                customerUserName: savedCustomerUser.name
            });

            return savedCustomerUser;
        } catch (error: any) {
            logger.error(this.node, 'Error creating customer user:', error);
            throw error;
        }
    }

    /**
     * Update an existing customer user
     * PUT /api/v2/customer-users/:name
     */
    @Put('/:name')
    @Authorized()
    async updateCustomerUser(
        @Param('name') name: string,
        @Body() userData: UpdateCustomerUserDto,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Update customer user request', {
            requestedBy: user?.user_id,
            customerUserName: name
        });

        try {
            const customerUserRepo = this.databaseService.getCustomerUserRepository();

            // Check if customer user exists
            const existingUser = await customerUserRepo.findOne({
                where: { name: name }
            });

            if (!existingUser) {
                logger.warn(this.node, 'Customer user not found for update', { name: name });
                throw new Error('Customer user not found');
            }

            // Update customer user
            await customerUserRepo.update({ name: name }, userData);

            // Fetch updated customer user
            const updatedCustomerUser = await customerUserRepo.findOne({
                where: { name: name },
                relations: ['iot_customer', 'dynamicRole']
            });

            logger.info(this.node, 'Customer user updated successfully', {
                requestedBy: user?.user_id,
                customerUserName: name
            });

            return updatedCustomerUser;
        } catch (error: any) {
            logger.error(this.node, 'Error updating customer user:', error);
            throw error;
        }
    }

    /**
     * Delete a customer user
     * DELETE /api/v2/customer-users/:name
     */
    @Delete('/:name')
    @Authorized()
    async deleteCustomerUser(
        @Param('name') name: string,
        @CurrentUser() user: any
    ): Promise<any> {
        logger.info(this.node, 'Delete customer user request', {
            requestedBy: user?.user_id,
            customerUserName: name
        });

        try {
            const customerUserRepo = this.databaseService.getCustomerUserRepository();

            // Check if customer user exists
            const existingUser = await customerUserRepo.findOne({
                where: { name: name }
            });

            if (!existingUser) {
                logger.warn(this.node, 'Customer user not found for deletion', { name: name });
                throw new Error('Customer user not found');
            }

            // Delete customer user
            await customerUserRepo.delete({ name: name });

            logger.info(this.node, 'Customer user deleted successfully', {
                requestedBy: user?.user_id,
                customerUserName: name
            });

            return { message: 'Customer user deleted successfully' };
        } catch (error: any) {
            logger.error(this.node, 'Error deleting customer user:', error);
            throw error;
        }
    }
}

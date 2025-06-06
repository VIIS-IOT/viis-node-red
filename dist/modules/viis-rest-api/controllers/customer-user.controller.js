"use strict";
/**
 * @fileoverview Customer User management controller
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
exports.CustomerUserController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const database_service_1 = require("../services/database.service");
const customer_user_dto_1 = require("../dto/customer-user.dto");
const logger_1 = require("../utils/logger");
const container_setup_1 = require("../container/container.setup");
const query_filters_util_1 = require("../utils/query-filters.util");
/**
 * Customer User management controller class
 *
 * This controller provides full CRUD operations for customer users:
 * - Uses routing-controllers decorators with automatic validation
 * - Implements comprehensive error handling and logging
 * - Supports dynamic filtering and pagination
 * - Token-based authentication with @Authorized() decorator
 */
let CustomerUserController = class CustomerUserController {
    constructor(databaseService, node) {
        this.databaseService = databaseService;
        this.node = node;
        logger_1.logger.info(this.node, 'CustomerUserController initialized');
    }
    /**
     * Get all customer users with filtering and pagination
     * GET /api/v2/customer-users
     */
    async getAllCustomerUsers(queryParams, user) {
        logger_1.logger.info(this.node, 'Get all customer users request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
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
                    const parsedFilters = JSON.parse(queryParams.filters);
                    qb = (0, query_filters_util_1.applyQueryFilters)(qb, parsedFilters, 'customer_user');
                }
                catch (parseError) {
                    logger_1.logger.error(this.node, 'Failed to parse filters:', { filters: queryParams.filters, error: parseError });
                    throw new Error('Invalid filters format');
                }
            }
            // Apply search filter
            if (queryParams.search) {
                qb.andWhere('(customer_user.name ILIKE :search OR customer_user.email ILIKE :search OR customer_user.full_name ILIKE :search OR customer_user.user_name ILIKE :search)', { search: `%${queryParams.search}%` });
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
                qb.orderBy(`customer_user.${field}`, (direction === null || direction === void 0 ? void 0 : direction.toUpperCase()) === 'DESC' ? 'DESC' : 'ASC');
            }
            else {
                qb.orderBy('customer_user.created_at', 'DESC');
            }
            // Get total count
            const total = await qb.getCount();
            // Apply pagination
            const data = await qb.skip(skip).take(size).getMany();
            logger_1.logger.info(this.node, 'Customer users retrieved successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
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
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving customer users:', error);
            throw error;
        }
    }
    /**
     * Get a specific customer user by name
     * GET /api/v2/customer-users/:name
     */
    async getCustomerUser(name, user) {
        logger_1.logger.info(this.node, 'Get customer user request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            customerUserName: name
        });
        try {
            const customerUserRepo = this.databaseService.getCustomerUserRepository();
            const customerUser = await customerUserRepo.findOne({
                where: { name: name },
                relations: ['iot_customer', 'dynamicRole', 'credential']
            });
            if (!customerUser) {
                logger_1.logger.warn(this.node, 'Customer user not found', { name: name });
                throw new Error('Customer user not found');
            }
            logger_1.logger.info(this.node, 'Customer user retrieved successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                customerUserName: name
            });
            return customerUser;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error retrieving customer user:', error);
            throw error;
        }
    }
    /**
     * Create a new customer user
     * POST /api/v2/customer-users
     */
    async createCustomerUser(userData, user) {
        logger_1.logger.info(this.node, 'Create customer user request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            customerUserName: userData.name
        });
        try {
            const customerUserRepo = this.databaseService.getCustomerUserRepository();
            // Check if customer user already exists
            const existingUser = await customerUserRepo.findOne({
                where: { name: userData.name }
            });
            if (existingUser) {
                logger_1.logger.warn(this.node, 'Customer user already exists', { name: userData.name });
                throw new Error('Customer user with this name already exists');
            }
            // Create new customer user
            const newCustomerUser = customerUserRepo.create(Object.assign(Object.assign({}, userData), { created_time: new Date() }));
            const savedCustomerUser = await customerUserRepo.save(newCustomerUser);
            logger_1.logger.info(this.node, 'Customer user created successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                customerUserName: savedCustomerUser.name
            });
            return savedCustomerUser;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error creating customer user:', error);
            throw error;
        }
    }
    /**
     * Update an existing customer user
     * PUT /api/v2/customer-users/:name
     */
    async updateCustomerUser(name, userData, user) {
        logger_1.logger.info(this.node, 'Update customer user request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            customerUserName: name
        });
        try {
            const customerUserRepo = this.databaseService.getCustomerUserRepository();
            // Check if customer user exists
            const existingUser = await customerUserRepo.findOne({
                where: { name: name }
            });
            if (!existingUser) {
                logger_1.logger.warn(this.node, 'Customer user not found for update', { name: name });
                throw new Error('Customer user not found');
            }
            // Update customer user
            await customerUserRepo.update({ name: name }, userData);
            // Fetch updated customer user
            const updatedCustomerUser = await customerUserRepo.findOne({
                where: { name: name },
                relations: ['iot_customer', 'dynamicRole']
            });
            logger_1.logger.info(this.node, 'Customer user updated successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                customerUserName: name
            });
            return updatedCustomerUser;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error updating customer user:', error);
            throw error;
        }
    }
    /**
     * Delete a customer user
     * DELETE /api/v2/customer-users/:name
     */
    async deleteCustomerUser(name, user) {
        logger_1.logger.info(this.node, 'Delete customer user request', {
            requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
            customerUserName: name
        });
        try {
            const customerUserRepo = this.databaseService.getCustomerUserRepository();
            // Check if customer user exists
            const existingUser = await customerUserRepo.findOne({
                where: { name: name }
            });
            if (!existingUser) {
                logger_1.logger.warn(this.node, 'Customer user not found for deletion', { name: name });
                throw new Error('Customer user not found');
            }
            // Delete customer user
            await customerUserRepo.delete({ name: name });
            logger_1.logger.info(this.node, 'Customer user deleted successfully', {
                requestedBy: user === null || user === void 0 ? void 0 : user.user_id,
                customerUserName: name
            });
            return { message: 'Customer user deleted successfully' };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Error deleting customer user:', error);
            throw error;
        }
    }
};
exports.CustomerUserController = CustomerUserController;
__decorate([
    (0, routing_controllers_1.Get)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.QueryParams)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [customer_user_dto_1.CustomerUserQueryDto, Object]),
    __metadata("design:returntype", Promise)
], CustomerUserController.prototype, "getAllCustomerUsers", null);
__decorate([
    (0, routing_controllers_1.Get)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], CustomerUserController.prototype, "getCustomerUser", null);
__decorate([
    (0, routing_controllers_1.Post)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [customer_user_dto_1.CreateCustomerUserDto, Object]),
    __metadata("design:returntype", Promise)
], CustomerUserController.prototype, "createCustomerUser", null);
__decorate([
    (0, routing_controllers_1.Put)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.Body)()),
    __param(2, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, customer_user_dto_1.UpdateCustomerUserDto, Object]),
    __metadata("design:returntype", Promise)
], CustomerUserController.prototype, "updateCustomerUser", null);
__decorate([
    (0, routing_controllers_1.Delete)('/:name'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('name')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], CustomerUserController.prototype, "deleteCustomerUser", null);
exports.CustomerUserController = CustomerUserController = __decorate([
    (0, routing_controllers_1.JsonController)('/customer-users'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService, Object])
], CustomerUserController);

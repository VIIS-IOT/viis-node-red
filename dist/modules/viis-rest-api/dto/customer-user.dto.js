"use strict";
/**
 * @fileoverview Customer User DTOs for validation and transformation
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerUserParamsDto = exports.UpdateCustomerUserDto = exports.CreateCustomerUserDto = exports.CustomerUserQueryDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const user_role_1 = require("../../../constants/user_role");
/**
 * Query parameters for listing customer users
 */
class CustomerUserQueryDto {
    constructor() {
        this.page = 1;
        this.size = 10;
    }
}
exports.CustomerUserQueryDto = CustomerUserQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Page must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Page must be at least 1' }),
    __metadata("design:type", Number)
], CustomerUserQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Size must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Size must be at least 1' }),
    (0, class_validator_1.Max)(100, { message: 'Size must not exceed 100' }),
    __metadata("design:type", Number)
], CustomerUserQueryDto.prototype, "size", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Order by must be a string' }),
    __metadata("design:type", String)
], CustomerUserQueryDto.prototype, "order_by", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Filters must be a string' }),
    __metadata("design:type", String)
], CustomerUserQueryDto.prototype, "filters", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Search term must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Search term must not exceed 100 characters' }),
    __metadata("design:type", String)
], CustomerUserQueryDto.prototype, "search", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer ID must be a string' }),
    __metadata("design:type", String)
], CustomerUserQueryDto.prototype, "customer_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(user_role_1.UserRoleTypeEnum, { message: 'Invalid user type' }),
    __metadata("design:type", String)
], CustomerUserQueryDto.prototype, "user_type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Boolean),
    (0, class_validator_1.IsBoolean)({ message: 'Is deactivated must be a boolean' }),
    __metadata("design:type", Boolean)
], CustomerUserQueryDto.prototype, "is_deactivated", void 0);
/**
 * DTO for creating a new customer user
 */
class CreateCustomerUserDto {
    constructor() {
        this.is_deactivated = 0;
    }
}
exports.CreateCustomerUserDto = CreateCustomerUserDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Name is required' }),
    (0, class_validator_1.IsString)({ message: 'Name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Name cannot be empty' }),
    (0, class_validator_1.MinLength)(3, { message: 'Name must be at least 3 characters long' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Name must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateCustomerUserDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'User ID must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'User ID must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateCustomerUserDto.prototype, "user_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'User name must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'User name must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateCustomerUserDto.prototype, "user_name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEmail)({}, { message: 'Email must be a valid email address' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Email must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateCustomerUserDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Full name must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Full name must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateCustomerUserDto.prototype, "full_name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Phone number must be a string' }),
    (0, class_validator_1.MaxLength)(20, { message: 'Phone number must not exceed 20 characters' }),
    __metadata("design:type", String)
], CreateCustomerUserDto.prototype, "phone_number", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer ID must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Customer ID must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateCustomerUserDto.prototype, "customer_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(user_role_1.UserRoleTypeEnum, { message: 'Invalid user type' }),
    __metadata("design:type", String)
], CreateCustomerUserDto.prototype, "user_type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'IoT dynamic role must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'IoT dynamic role must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateCustomerUserDto.prototype, "iot_dynamic_role", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Is deactivated must be a number (0 or 1)' }),
    (0, class_validator_1.Min)(0, { message: 'Is deactivated must be 0 or 1' }),
    (0, class_validator_1.Max)(1, { message: 'Is deactivated must be 0 or 1' }),
    __metadata("design:type", Number)
], CreateCustomerUserDto.prototype, "is_deactivated", void 0);
/**
 * DTO for updating an existing customer user
 */
class UpdateCustomerUserDto {
}
exports.UpdateCustomerUserDto = UpdateCustomerUserDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'User ID must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'User ID must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateCustomerUserDto.prototype, "user_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'User name must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'User name must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateCustomerUserDto.prototype, "user_name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEmail)({}, { message: 'Email must be a valid email address' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Email must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateCustomerUserDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Full name must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Full name must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateCustomerUserDto.prototype, "full_name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Phone number must be a string' }),
    (0, class_validator_1.MaxLength)(20, { message: 'Phone number must not exceed 20 characters' }),
    __metadata("design:type", String)
], UpdateCustomerUserDto.prototype, "phone_number", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer ID must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Customer ID must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateCustomerUserDto.prototype, "customer_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(user_role_1.UserRoleTypeEnum, { message: 'Invalid user type' }),
    __metadata("design:type", String)
], UpdateCustomerUserDto.prototype, "user_type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'IoT dynamic role must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'IoT dynamic role must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateCustomerUserDto.prototype, "iot_dynamic_role", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Is deactivated must be a number (0 or 1)' }),
    (0, class_validator_1.Min)(0, { message: 'Is deactivated must be 0 or 1' }),
    (0, class_validator_1.Max)(1, { message: 'Is deactivated must be 0 or 1' }),
    __metadata("design:type", Number)
], UpdateCustomerUserDto.prototype, "is_deactivated", void 0);
/**
 * DTO for customer user path parameters
 */
class CustomerUserParamsDto {
}
exports.CustomerUserParamsDto = CustomerUserParamsDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Customer user name is required' }),
    (0, class_validator_1.IsString)({ message: 'Customer user name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Customer user name cannot be empty' }),
    __metadata("design:type", String)
], CustomerUserParamsDto.prototype, "name", void 0);

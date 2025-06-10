"use strict";
/**
 * @fileoverview IoT Notification DTOs for validation and transformation
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
exports.IotNotificationParamsDto = exports.UpdateIotNotificationDto = exports.CreateIotNotificationDto = exports.IotNotificationQueryDto = exports.NotificationType = exports.NotificationSeverity = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
/**
 * Enum for notification severity levels
 */
var NotificationSeverity;
(function (NotificationSeverity) {
    NotificationSeverity["LOW"] = "low";
    NotificationSeverity["MEDIUM"] = "medium";
    NotificationSeverity["HIGH"] = "high";
    NotificationSeverity["CRITICAL"] = "critical";
})(NotificationSeverity || (exports.NotificationSeverity = NotificationSeverity = {}));
/**
 * Enum for notification types
 */
var NotificationType;
(function (NotificationType) {
    NotificationType["ALERT"] = "alert";
    NotificationType["WARNING"] = "warning";
    NotificationType["INFO"] = "info";
    NotificationType["ERROR"] = "error";
})(NotificationType || (exports.NotificationType = NotificationType = {}));
/**
 * Query parameters for listing IoT notifications
 */
class IotNotificationQueryDto {
    constructor() {
        this.page = 1;
        this.size = 10;
    }
}
exports.IotNotificationQueryDto = IotNotificationQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Page must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Page must be at least 1' }),
    __metadata("design:type", Number)
], IotNotificationQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Size must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Size must be at least 1' }),
    (0, class_validator_1.Max)(100, { message: 'Size must not exceed 100' }),
    __metadata("design:type", Number)
], IotNotificationQueryDto.prototype, "size", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Order by must be a string' }),
    __metadata("design:type", String)
], IotNotificationQueryDto.prototype, "order_by", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Filters must be a string' }),
    __metadata("design:type", String)
], IotNotificationQueryDto.prototype, "filters", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'OR filters must be a string' }),
    __metadata("design:type", String)
], IotNotificationQueryDto.prototype, "or_filters", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Search term must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Search term must not exceed 100 characters' }),
    __metadata("design:type", String)
], IotNotificationQueryDto.prototype, "search", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer user must be a string' }),
    __metadata("design:type", String)
], IotNotificationQueryDto.prototype, "customer_user", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer ID must be a string' }),
    __metadata("design:type", String)
], IotNotificationQueryDto.prototype, "customer_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(NotificationType, { message: 'Invalid notification type' }),
    __metadata("design:type", String)
], IotNotificationQueryDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(NotificationSeverity, { message: 'Invalid notification severity' }),
    __metadata("design:type", String)
], IotNotificationQueryDto.prototype, "severity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Boolean),
    (0, class_validator_1.IsBoolean)({ message: 'Is read must be a boolean' }),
    __metadata("design:type", Boolean)
], IotNotificationQueryDto.prototype, "is_read", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Boolean),
    (0, class_validator_1.IsBoolean)({ message: 'Is sent must be a boolean' }),
    __metadata("design:type", Boolean)
], IotNotificationQueryDto.prototype, "is_sent", void 0);
/**
 * DTO for creating a new IoT notification
 */
class CreateIotNotificationDto {
    constructor() {
        this.is_read = 0;
        this.is_sent = 0;
    }
}
exports.CreateIotNotificationDto = CreateIotNotificationDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Name is required' }),
    (0, class_validator_1.IsString)({ message: 'Name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Name cannot be empty' }),
    (0, class_validator_1.MinLength)(3, { message: 'Name must be at least 3 characters long' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Name must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateIotNotificationDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer user must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Customer user must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateIotNotificationDto.prototype, "customer_user", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Message must be a string' }),
    __metadata("design:type", String)
], CreateIotNotificationDto.prototype, "message", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Entity must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Entity must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateIotNotificationDto.prototype, "entity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(NotificationType, { message: 'Invalid notification type' }),
    __metadata("design:type", String)
], CreateIotNotificationDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer ID must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Customer ID must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateIotNotificationDto.prototype, "customer_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Error code must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Error code must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateIotNotificationDto.prototype, "err_code", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Entity label must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Entity label must not exceed 140 characters' }),
    __metadata("design:type", String)
], CreateIotNotificationDto.prototype, "entity_label", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(NotificationSeverity, { message: 'Invalid notification severity' }),
    __metadata("design:type", String)
], CreateIotNotificationDto.prototype, "severity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Is read must be a number (0 or 1)' }),
    (0, class_validator_1.Min)(0, { message: 'Is read must be 0 or 1' }),
    (0, class_validator_1.Max)(1, { message: 'Is read must be 0 or 1' }),
    __metadata("design:type", Number)
], CreateIotNotificationDto.prototype, "is_read", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Is sent must be a number (0 or 1)' }),
    (0, class_validator_1.Min)(0, { message: 'Is sent must be 0 or 1' }),
    (0, class_validator_1.Max)(1, { message: 'Is sent must be 0 or 1' }),
    __metadata("design:type", Number)
], CreateIotNotificationDto.prototype, "is_sent", void 0);
/**
 * DTO for updating an existing IoT notification
 */
class UpdateIotNotificationDto {
}
exports.UpdateIotNotificationDto = UpdateIotNotificationDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer user must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Customer user must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateIotNotificationDto.prototype, "customer_user", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Message must be a string' }),
    __metadata("design:type", String)
], UpdateIotNotificationDto.prototype, "message", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Entity must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Entity must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateIotNotificationDto.prototype, "entity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(NotificationType, { message: 'Invalid notification type' }),
    __metadata("design:type", String)
], UpdateIotNotificationDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer ID must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Customer ID must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateIotNotificationDto.prototype, "customer_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Error code must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Error code must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateIotNotificationDto.prototype, "err_code", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Entity label must be a string' }),
    (0, class_validator_1.MaxLength)(140, { message: 'Entity label must not exceed 140 characters' }),
    __metadata("design:type", String)
], UpdateIotNotificationDto.prototype, "entity_label", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(NotificationSeverity, { message: 'Invalid notification severity' }),
    __metadata("design:type", String)
], UpdateIotNotificationDto.prototype, "severity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Is read must be a number (0 or 1)' }),
    (0, class_validator_1.Min)(0, { message: 'Is read must be 0 or 1' }),
    (0, class_validator_1.Max)(1, { message: 'Is read must be 0 or 1' }),
    __metadata("design:type", Number)
], UpdateIotNotificationDto.prototype, "is_read", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Is sent must be a number (0 or 1)' }),
    (0, class_validator_1.Min)(0, { message: 'Is sent must be 0 or 1' }),
    (0, class_validator_1.Max)(1, { message: 'Is sent must be 0 or 1' }),
    __metadata("design:type", Number)
], UpdateIotNotificationDto.prototype, "is_sent", void 0);
/**
 * DTO for IoT notification path parameters
 */
class IotNotificationParamsDto {
}
exports.IotNotificationParamsDto = IotNotificationParamsDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Notification name is required' }),
    (0, class_validator_1.IsString)({ message: 'Notification name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Notification name cannot be empty' }),
    __metadata("design:type", String)
], IotNotificationParamsDto.prototype, "name", void 0);

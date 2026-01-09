"use strict";
/**
 * @fileoverview DTOs for Error Notification endpoints
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
exports.BulkResolveDto = exports.UpdateErrorNotificationDto = exports.CreateErrorNotificationDto = exports.ErrorNotificationQueryDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
/**
 * Query parameters for error notification listing
 */
class ErrorNotificationQueryDto {
    constructor() {
        this.page = 1;
        this.size = 20;
        this.sortBy = 'created_at';
        this.sortOrder = 'DESC';
    }
}
exports.ErrorNotificationQueryDto = ErrorNotificationQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ErrorNotificationQueryDto.prototype, "err_code", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['low', 'medium', 'high', 'critical']),
    __metadata("design:type", String)
], ErrorNotificationQueryDto.prototype, "severity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['info', 'warning', 'error', 'alert']),
    __metadata("design:type", String)
], ErrorNotificationQueryDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ErrorNotificationQueryDto.prototype, "entity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true' || value === true || value === 1 || value === '1'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ErrorNotificationQueryDto.prototype, "is_read", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ErrorNotificationQueryDto.prototype, "board_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], ErrorNotificationQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], ErrorNotificationQueryDto.prototype, "size", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ErrorNotificationQueryDto.prototype, "sortBy", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['ASC', 'DESC', 'asc', 'desc']),
    __metadata("design:type", String)
], ErrorNotificationQueryDto.prototype, "sortOrder", void 0);
/**
 * DTO for creating error notification manually
 */
class CreateErrorNotificationDto {
}
exports.CreateErrorNotificationDto = CreateErrorNotificationDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateErrorNotificationDto.prototype, "err_code", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateErrorNotificationDto.prototype, "message", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['low', 'medium', 'high', 'critical']),
    __metadata("design:type", String)
], CreateErrorNotificationDto.prototype, "severity", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['info', 'warning', 'error', 'alert']),
    __metadata("design:type", String)
], CreateErrorNotificationDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateErrorNotificationDto.prototype, "entity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateErrorNotificationDto.prototype, "entity_label", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], CreateErrorNotificationDto.prototype, "metadata", void 0);
/**
 * DTO for updating error notification
 */
class UpdateErrorNotificationDto {
}
exports.UpdateErrorNotificationDto = UpdateErrorNotificationDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateErrorNotificationDto.prototype, "message", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true' || value === true || value === 1 || value === '1'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateErrorNotificationDto.prototype, "is_read", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], UpdateErrorNotificationDto.prototype, "metadata", void 0);
/**
 * DTO for bulk resolve notifications
 */
class BulkResolveDto {
}
exports.BulkResolveDto = BulkResolveDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BulkResolveDto.prototype, "err_code", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BulkResolveDto.prototype, "entity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BulkResolveDto.prototype, "board_id", void 0);

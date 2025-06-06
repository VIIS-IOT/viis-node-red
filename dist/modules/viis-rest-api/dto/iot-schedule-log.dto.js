"use strict";
/**
 * @fileoverview IoT Schedule Log DTOs for validation and transformation
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
exports.ScheduleLogWithTelemetryDto = exports.IotScheduleLogParamsDto = exports.UpdateIotScheduleLogDto = exports.CreateIotScheduleLogDto = exports.IotScheduleLogQueryDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
/**
 * Query parameters for listing IoT schedule logs
 */
class IotScheduleLogQueryDto {
    constructor() {
        this.page = 1;
        this.size = 100;
    }
}
exports.IotScheduleLogQueryDto = IotScheduleLogQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Page must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Page must be at least 1' }),
    __metadata("design:type", Number)
], IotScheduleLogQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Size must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Size must be at least 1' }),
    (0, class_validator_1.Max)(100, { message: 'Size must not exceed 100' }),
    __metadata("design:type", Number)
], IotScheduleLogQueryDto.prototype, "size", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Order by must be a string' }),
    __metadata("design:type", String)
], IotScheduleLogQueryDto.prototype, "order_by", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Filters must be a string' }),
    __metadata("design:type", String)
], IotScheduleLogQueryDto.prototype, "filters", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Search term must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Search term must not exceed 100 characters' }),
    __metadata("design:type", String)
], IotScheduleLogQueryDto.prototype, "search", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Schedule ID must be a string' }),
    __metadata("design:type", String)
], IotScheduleLogQueryDto.prototype, "schedule_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer user must be a string' }),
    __metadata("design:type", String)
], IotScheduleLogQueryDto.prototype, "customer_user", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Start time must be a string' }),
    __metadata("design:type", String)
], IotScheduleLogQueryDto.prototype, "start_time", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'End time must be a string' }),
    __metadata("design:type", String)
], IotScheduleLogQueryDto.prototype, "end_time", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)({}, { message: 'Start date must be a valid date string' }),
    __metadata("design:type", String)
], IotScheduleLogQueryDto.prototype, "start_date", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)({}, { message: 'End date must be a valid date string' }),
    __metadata("design:type", String)
], IotScheduleLogQueryDto.prototype, "end_date", void 0);
/**
 * DTO for creating a new IoT schedule log
 */
class CreateIotScheduleLogDto {
}
exports.CreateIotScheduleLogDto = CreateIotScheduleLogDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Name is required' }),
    (0, class_validator_1.IsString)({ message: 'Name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Name cannot be empty' }),
    (0, class_validator_1.MinLength)(3, { message: 'Name must be at least 3 characters long' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Name must not exceed 255 characters' }),
    __metadata("design:type", String)
], CreateIotScheduleLogDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Start time must be a string' }),
    __metadata("design:type", String)
], CreateIotScheduleLogDto.prototype, "start_time", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'End time must be a string' }),
    __metadata("design:type", String)
], CreateIotScheduleLogDto.prototype, "end_time", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Schedule ID must be a string' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Schedule ID must not exceed 255 characters' }),
    __metadata("design:type", String)
], CreateIotScheduleLogDto.prototype, "schedule_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer user must be a string' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Customer user must not exceed 255 characters' }),
    __metadata("design:type", String)
], CreateIotScheduleLogDto.prototype, "customer_user", void 0);
/**
 * DTO for updating an existing IoT schedule log
 */
class UpdateIotScheduleLogDto {
}
exports.UpdateIotScheduleLogDto = UpdateIotScheduleLogDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Start time must be a string' }),
    __metadata("design:type", String)
], UpdateIotScheduleLogDto.prototype, "start_time", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'End time must be a string' }),
    __metadata("design:type", String)
], UpdateIotScheduleLogDto.prototype, "end_time", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Schedule ID must be a string' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Schedule ID must not exceed 255 characters' }),
    __metadata("design:type", String)
], UpdateIotScheduleLogDto.prototype, "schedule_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Customer user must be a string' }),
    (0, class_validator_1.MaxLength)(255, { message: 'Customer user must not exceed 255 characters' }),
    __metadata("design:type", String)
], UpdateIotScheduleLogDto.prototype, "customer_user", void 0);
/**
 * DTO for IoT schedule log path parameters
 */
class IotScheduleLogParamsDto {
}
exports.IotScheduleLogParamsDto = IotScheduleLogParamsDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Schedule log name is required' }),
    (0, class_validator_1.IsString)({ message: 'Schedule log name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Schedule log name cannot be empty' }),
    __metadata("design:type", String)
], IotScheduleLogParamsDto.prototype, "name", void 0);
/**
 * Response DTO for schedule log with telemetry data
 */
class ScheduleLogWithTelemetryDto {
}
exports.ScheduleLogWithTelemetryDto = ScheduleLogWithTelemetryDto;

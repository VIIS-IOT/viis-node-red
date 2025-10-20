"use strict";
/**
 * @fileoverview Oil Profile DTOs for Marine IoT System
 *
 * Provides validation DTOs for oil profile management operations:
 * - Create oil profile (BO/DO with density and temperature)
 * - Update oil profile
 * - Activate/deactivate profiles
 * - Query profiles with filters
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
exports.QueryOilProfileDto = exports.ActivateProfileDto = exports.UpdateOilProfileDto = exports.CreateOilProfileDto = exports.OilType = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
/**
 * Oil type enumeration
 */
var OilType;
(function (OilType) {
    OilType["BO"] = "BO";
    OilType["DO"] = "DO"; // Diesel Oil
})(OilType || (exports.OilType = OilType = {}));
/**
 * DTO for creating a new oil profile
 */
class CreateOilProfileDto {
}
exports.CreateOilProfileDto = CreateOilProfileDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(3),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateOilProfileDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)({ message: 'device_id is required' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateOilProfileDto.prototype, "device_id", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)({ message: 'oil_type is required' }),
    (0, class_validator_1.IsEnum)(OilType, { message: 'oil_type must be either BO or DO' }),
    __metadata("design:type", String)
], CreateOilProfileDto.prototype, "oil_type", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)({ message: 'operating_temperature is required' }),
    (0, class_validator_1.IsNumber)({}, { message: 'operating_temperature must be a number' }),
    (0, class_validator_1.Min)(-50, { message: 'operating_temperature must be at least -50°C' }),
    (0, class_validator_1.Max)(200, { message: 'operating_temperature must not exceed 200°C' }),
    __metadata("design:type", Number)
], CreateOilProfileDto.prototype, "operating_temperature", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)({ message: 'density is required' }),
    (0, class_validator_1.IsNumber)({}, { message: 'density must be a number' }),
    (0, class_validator_1.Min)(500, { message: 'density must be at least 500 kg/m³' }),
    (0, class_validator_1.Max)(2000, { message: 'density must not exceed 2000 kg/m³' }),
    __metadata("design:type", Number)
], CreateOilProfileDto.prototype, "density", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateOilProfileDto.prototype, "label", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateOilProfileDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    (0, class_transformer_1.Transform)(({ value }) => value === true || value === 'true' || value === 1),
    __metadata("design:type", Boolean)
], CreateOilProfileDto.prototype, "is_active", void 0);
/**
 * DTO for updating an existing oil profile
 */
class UpdateOilProfileDto {
}
exports.UpdateOilProfileDto = UpdateOilProfileDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(OilType, { message: 'oil_type must be either BO or DO' }),
    __metadata("design:type", String)
], UpdateOilProfileDto.prototype, "oil_type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)({}, { message: 'operating_temperature must be a number' }),
    (0, class_validator_1.Min)(-50, { message: 'operating_temperature must be at least -50°C' }),
    (0, class_validator_1.Max)(200, { message: 'operating_temperature must not exceed 200°C' }),
    __metadata("design:type", Number)
], UpdateOilProfileDto.prototype, "operating_temperature", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)({}, { message: 'density must be a number' }),
    (0, class_validator_1.Min)(500, { message: 'density must be at least 500 kg/m³' }),
    (0, class_validator_1.Max)(2000, { message: 'density must not exceed 2000 kg/m³' }),
    __metadata("design:type", Number)
], UpdateOilProfileDto.prototype, "density", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], UpdateOilProfileDto.prototype, "label", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateOilProfileDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    (0, class_transformer_1.Transform)(({ value }) => value === true || value === 'true' || value === 1),
    __metadata("design:type", Boolean)
], UpdateOilProfileDto.prototype, "is_active", void 0);
/**
 * DTO for activating a profile
 */
class ActivateProfileDto {
}
exports.ActivateProfileDto = ActivateProfileDto;
__decorate([
    (0, class_validator_1.IsNotEmpty)({ message: 'profile_name is required' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], ActivateProfileDto.prototype, "profile_name", void 0);
/**
 * DTO for querying profiles
 */
class QueryOilProfileDto {
}
exports.QueryOilProfileDto = QueryOilProfileDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], QueryOilProfileDto.prototype, "device_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(OilType),
    __metadata("design:type", String)
], QueryOilProfileDto.prototype, "oil_type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    (0, class_transformer_1.Transform)(({ value }) => value === true || value === 'true' || value === 1),
    __metadata("design:type", Boolean)
], QueryOilProfileDto.prototype, "is_active", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value, 10)),
    __metadata("design:type", Number)
], QueryOilProfileDto.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value, 10)),
    __metadata("design:type", Number)
], QueryOilProfileDto.prototype, "offset", void 0);

"use strict";
/**
 * @fileoverview Trip Management DTOs
 *
 * DTOs for trip/voyage management endpoints
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
exports.TripHistoryQueryDto = exports.CancelTripDto = exports.EndTripDto = exports.StartTripDto = void 0;
const class_validator_1 = require("class-validator");
/**
 * Request to start a new trip
 */
class StartTripDto {
}
exports.StartTripDto = StartTripDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], StartTripDto.prototype, "device_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], StartTripDto.prototype, "trip_name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], StartTripDto.prototype, "notes", void 0);
/**
 * Request to end a trip
 */
class EndTripDto {
}
exports.EndTripDto = EndTripDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EndTripDto.prototype, "trip_id", void 0);
/**
 * Request to cancel a trip
 */
class CancelTripDto {
}
exports.CancelTripDto = CancelTripDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CancelTripDto.prototype, "trip_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CancelTripDto.prototype, "reason", void 0);
/**
 * Query parameters for trip history
 */
class TripHistoryQueryDto {
}
exports.TripHistoryQueryDto = TripHistoryQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], TripHistoryQueryDto.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TripHistoryQueryDto.prototype, "status", void 0);

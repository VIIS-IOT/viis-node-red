"use strict";
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
exports.TabiotScheduleDto = void 0;
const class_validator_1 = require("class-validator");
class TabiotScheduleDto {
}
exports.TabiotScheduleDto = TabiotScheduleDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsDefined)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "device_id", void 0);
__decorate([
    (0, class_validator_1.IsDefined)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "action", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(['', 'circulate', 'period', 'fixed', 'interval']),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "interval", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "start_date", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "end_date", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "start_time", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "end_time", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsDefined)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "schedule_plan_id", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(['running', 'stopped', 'finished', '']),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "enable", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], TabiotScheduleDto.prototype, "is_deleted", void 0);

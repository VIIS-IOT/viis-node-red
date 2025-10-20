"use strict";
/**
 * @fileoverview Marine IoT Telemetry DTOs
 *
 * DTOs for Marine IoT specific telemetry data endpoints
 * Separate from general telemetry to keep marine-specific logic isolated
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
exports.MachineStatus = exports.MarineTelemetryHistoryQueryDto = exports.MarineTelemetryQueryDto = exports.MachineType = void 0;
const class_validator_1 = require("class-validator");
/**
 * Machine types supported by Marine IoT
 */
var MachineType;
(function (MachineType) {
    MachineType["GENERATOR"] = "GENERATOR";
    MachineType["MAIN_ENGINE"] = "MAIN_ENGINE";
    MachineType["BOILER"] = "BOILER";
})(MachineType || (exports.MachineType = MachineType = {}));
/**
 * Query parameters for getting latest telemetry
 */
class MarineTelemetryQueryDto {
}
exports.MarineTelemetryQueryDto = MarineTelemetryQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MarineTelemetryQueryDto.prototype, "keys", void 0);
/**
 * Query parameters for getting telemetry history
 */
class MarineTelemetryHistoryQueryDto extends MarineTelemetryQueryDto {
}
exports.MarineTelemetryHistoryQueryDto = MarineTelemetryHistoryQueryDto;
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], MarineTelemetryHistoryQueryDto.prototype, "start_time", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], MarineTelemetryHistoryQueryDto.prototype, "end_time", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1000),
    (0, class_validator_1.Max)(3600000) // Max 1 hour interval
    ,
    __metadata("design:type", Number)
], MarineTelemetryHistoryQueryDto.prototype, "interval", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(MachineType),
    __metadata("design:type", String)
], MarineTelemetryHistoryQueryDto.prototype, "machine_type", void 0);
/**
 * Machine status
 */
var MachineStatus;
(function (MachineStatus) {
    MachineStatus["OPERATIONAL"] = "OPERATIONAL";
    MachineStatus["WARNING"] = "WARNING";
    MachineStatus["ERROR"] = "ERROR";
    MachineStatus["NO_DATA"] = "NO_DATA";
})(MachineStatus || (exports.MachineStatus = MachineStatus = {}));

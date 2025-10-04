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
exports.TabiotDeviceTelemetryLatest = void 0;
const typeorm_1 = require("typeorm");
const TabiotDevice_1 = require("../device/TabiotDevice");
let TabiotDeviceTelemetryLatest = class TabiotDeviceTelemetryLatest {
};
exports.TabiotDeviceTelemetryLatest = TabiotDeviceTelemetryLatest;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotDeviceTelemetryLatest.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotDeviceTelemetryLatest.prototype, "key_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint' }),
    __metadata("design:type", Number)
], TabiotDeviceTelemetryLatest.prototype, "timestamp", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', nullable: true }),
    __metadata("design:type", Boolean)
], TabiotDeviceTelemetryLatest.prototype, "boolean_value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], TabiotDeviceTelemetryLatest.prototype, "int_value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'float', nullable: true }),
    __metadata("design:type", Number)
], TabiotDeviceTelemetryLatest.prototype, "float_value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceTelemetryLatest.prototype, "string_value", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotDevice_1.TabiotDevice),
    (0, typeorm_1.JoinColumn)({ name: 'device_id' }),
    __metadata("design:type", TabiotDevice_1.TabiotDevice)
], TabiotDeviceTelemetryLatest.prototype, "device", void 0);
exports.TabiotDeviceTelemetryLatest = TabiotDeviceTelemetryLatest = __decorate([
    (0, typeorm_1.Entity)('tabiot_device_telemetry_latest')
], TabiotDeviceTelemetryLatest);

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
exports.TabiotDeviceTelemetry = void 0;
const typeorm_1 = require("typeorm");
const TabiotDevice_1 = require("../device/TabiotDevice");
let TabiotDeviceTelemetry = class TabiotDeviceTelemetry {
};
exports.TabiotDeviceTelemetry = TabiotDeviceTelemetry;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)(),
    __metadata("design:type", Number)
], TabiotDeviceTelemetry.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceTelemetry.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint' }),
    __metadata("design:type", Number)
], TabiotDeviceTelemetry.prototype, "timestamp", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotDeviceTelemetry.prototype, "key_name", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['int', 'float', 'string', 'boolean', 'json'],
    }),
    __metadata("design:type", String)
], TabiotDeviceTelemetry.prototype, "value_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], TabiotDeviceTelemetry.prototype, "int_value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'float', nullable: true }),
    __metadata("design:type", Number)
], TabiotDeviceTelemetry.prototype, "float_value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceTelemetry.prototype, "string_value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', nullable: true }),
    __metadata("design:type", Boolean)
], TabiotDeviceTelemetry.prototype, "boolean_value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], TabiotDeviceTelemetry.prototype, "json_value", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotDevice_1.TabiotDevice),
    (0, typeorm_1.JoinColumn)({ name: 'device_id' }),
    __metadata("design:type", TabiotDevice_1.TabiotDevice)
], TabiotDeviceTelemetry.prototype, "device", void 0);
exports.TabiotDeviceTelemetry = TabiotDeviceTelemetry = __decorate([
    (0, typeorm_1.Entity)('tabiot_device_telemetry'),
    (0, typeorm_1.Unique)(['device_id', 'timestamp', 'key_name'])
], TabiotDeviceTelemetry);

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
exports.TabiotProductionFunction = void 0;
const typeorm_1 = require("typeorm");
const TabiotDeviceProfile_1 = require("../device-profile/TabiotDeviceProfile");
const Base_1 = require("../base/Base");
let TabiotProductionFunction = class TabiotProductionFunction extends Base_1.CustomBaseEntity {
};
exports.TabiotProductionFunction = TabiotProductionFunction;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "label", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "identifier", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['Bool', 'Value', 'Enum', 'Raw', 'String', 'Group Break', 'Tab Break', 'IP', 'Checkbox-bit', 'User data type'],
        nullable: true,
    }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "data_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "icon_url", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "data_on_text", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "data_off_text", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "enum_value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "unit", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['r', 'rw', 'w'],
        nullable: true,
    }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "data_permission", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "device_group_function_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "data_measure_max", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "data_measure_min", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "data_eligible_max", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "data_eligible_min", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "checkbox_bit_label1", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "checkbox_bit_label2", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "checkbox_bit_label3", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "checkbox_bit_label4", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "checkbox_bit_label5", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "checkbox_bit_label6", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "checkbox_bit_label7", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "checkbox_bit_label8", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['', 'Line', 'Text', 'Text_Line', 'Gauge', 'Card'],
        nullable: true,
    }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "chart_type", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['', 'Raw', 'Round', 'Float_1', 'Float_2', 'Float_3', 'Float_6'],
        nullable: true,
    }),
    __metadata("design:type", String)
], TabiotProductionFunction.prototype, "round_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], TabiotProductionFunction.prototype, "md_size", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', nullable: true }),
    __metadata("design:type", Boolean)
], TabiotProductionFunction.prototype, "show_chart", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], TabiotProductionFunction.prototype, "index_sort", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotDeviceProfile_1.TabiotDeviceProfile),
    (0, typeorm_1.JoinColumn)({ name: 'device_profile_id' }),
    __metadata("design:type", TabiotDeviceProfile_1.TabiotDeviceProfile)
], TabiotProductionFunction.prototype, "device_profile", void 0);
exports.TabiotProductionFunction = TabiotProductionFunction = __decorate([
    (0, typeorm_1.Entity)('tabiot_production_function')
], TabiotProductionFunction);

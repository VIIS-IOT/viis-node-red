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
exports.TabiotOilProfile = void 0;
const typeorm_1 = require("typeorm");
const TabiotDevice_1 = require("../device/TabiotDevice");
const Base_1 = require("../base/Base");
/**
 * Oil Profile Entity for Marine IoT System
 * Stores oil type configurations for different machines (Generator, Main Engine, Boiler)
 * Each machine can have different oil types (BO/DO/HFO) with specific density and temperature
 */
let TabiotOilProfile = class TabiotOilProfile extends Base_1.CustomBaseEntity {
};
exports.TabiotOilProfile = TabiotOilProfile;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotOilProfile.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotOilProfile.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['GENERATOR', 'MAIN_ENGINE', 'BOILER'],
        comment: 'Machine type: GENERATOR (fs01-02), MAIN_ENGINE (fs03-04), BOILER (fs05-06)'
    }),
    __metadata("design:type", String)
], TabiotOilProfile.prototype, "machine_type", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['BO', 'DO', 'HFO'],
        comment: 'Oil type: BO (Bunker Oil), DO (Diesel Oil), HFO (Heavy Fuel Oil)'
    }),
    __metadata("design:type", String)
], TabiotOilProfile.prototype, "oil_type", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'float',
        comment: 'Operating temperature in Celsius'
    }),
    __metadata("design:type", Number)
], TabiotOilProfile.prototype, "operating_temperature", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'float',
        comment: 'Density in kg/m³ (SI unit)'
    }),
    __metadata("design:type", Number)
], TabiotOilProfile.prototype, "density", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotOilProfile.prototype, "label", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'tinyint',
        default: 0,
        comment: '1 if this is the active profile for the device'
    }),
    __metadata("design:type", Boolean)
], TabiotOilProfile.prototype, "is_active", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], TabiotOilProfile.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotDevice_1.TabiotDevice, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'device_id', referencedColumnName: 'name' }),
    __metadata("design:type", TabiotDevice_1.TabiotDevice)
], TabiotOilProfile.prototype, "device", void 0);
exports.TabiotOilProfile = TabiotOilProfile = __decorate([
    (0, typeorm_1.Entity)('tabiot_oil_profile'),
    (0, typeorm_1.Index)(['device_id', 'machine_type', 'is_active'])
], TabiotOilProfile);

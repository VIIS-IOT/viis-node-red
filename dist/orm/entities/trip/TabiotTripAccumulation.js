"use strict";
/**
 * @fileoverview TabiotTripAccumulation Entity
 *
 * Stores running totals for each sensor during a trip
 * Updated every 2 seconds based on real-time flow rates
 * IMPORTANT: This is separate from hourly accumulation (tabiot_flow_accumulation)
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
exports.TabiotTripAccumulation = void 0;
const typeorm_1 = require("typeorm");
/**
 * Trip accumulation data for flow sensors
 * Running totals accumulated during an active trip
 */
let TabiotTripAccumulation = class TabiotTripAccumulation {
};
exports.TabiotTripAccumulation = TabiotTripAccumulation;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)(),
    __metadata("design:type", Number)
], TabiotTripAccumulation.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], TabiotTripAccumulation.prototype, "trip_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], TabiotTripAccumulation.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, comment: 'fs01, fs02, fs03, fs04, fs05, fs06' }),
    __metadata("design:type", String)
], TabiotTripAccumulation.prototype, "sensor_key", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 12,
        scale: 6,
        default: 0,
        comment: 'Total accumulated volume in m³'
    }),
    __metadata("design:type", Number)
], TabiotTripAccumulation.prototype, "total_volume_m3", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 12,
        scale: 6,
        default: 0,
        comment: 'Total accumulated volume in tons'
    }),
    __metadata("design:type", Number)
], TabiotTripAccumulation.prototype, "total_volume_tons", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 50, nullable: true }),
    __metadata("design:type", String)
], TabiotTripAccumulation.prototype, "oil_profile_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Current density in kg/m³'
    }),
    __metadata("design:type", Number)
], TabiotTripAccumulation.prototype, "current_density", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'bigint',
        nullable: true,
        comment: 'Last update timestamp in milliseconds'
    }),
    __metadata("design:type", Number)
], TabiotTripAccumulation.prototype, "last_update_time", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Number of samples accumulated'
    }),
    __metadata("design:type", Number)
], TabiotTripAccumulation.prototype, "sample_count", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'timestamp',
        default: () => 'CURRENT_TIMESTAMP',
        onUpdate: 'CURRENT_TIMESTAMP'
    }),
    __metadata("design:type", Date)
], TabiotTripAccumulation.prototype, "updated_at", void 0);
exports.TabiotTripAccumulation = TabiotTripAccumulation = __decorate([
    (0, typeorm_1.Entity)('tabiot_trip_accumulation'),
    (0, typeorm_1.Index)('unique_trip_sensor', ['trip_id', 'sensor_key'], { unique: true }),
    (0, typeorm_1.Index)(['trip_id']),
    (0, typeorm_1.Index)(['device_id'])
], TabiotTripAccumulation);

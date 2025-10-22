"use strict";
/**
 * @fileoverview TabiotTrip Entity
 *
 * Represents a voyage/trip for tracking cumulative fuel consumption
 * Separate from hourly accumulation - this tracks journey-level totals
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
exports.TabiotTrip = void 0;
const typeorm_1 = require("typeorm");
/**
 * Trip/Voyage entity for Marine IoT
 */
let TabiotTrip = class TabiotTrip {
};
exports.TabiotTrip = TabiotTrip;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], TabiotTrip.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], TabiotTrip.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100, nullable: true }),
    __metadata("design:type", String)
], TabiotTrip.prototype, "trip_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', comment: 'Unix timestamp in milliseconds' }),
    __metadata("design:type", Number)
], TabiotTrip.prototype, "start_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', nullable: true, comment: 'Unix timestamp in milliseconds' }),
    __metadata("design:type", Number)
], TabiotTrip.prototype, "end_time", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
        default: 'ACTIVE'
    }),
    __metadata("design:type", String)
], TabiotTrip.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], TabiotTrip.prototype, "notes", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ type: 'timestamp' }),
    __metadata("design:type", Date)
], TabiotTrip.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true }),
    __metadata("design:type", Date)
], TabiotTrip.prototype, "updated_at", void 0);
exports.TabiotTrip = TabiotTrip = __decorate([
    (0, typeorm_1.Entity)('tabiot_trip'),
    (0, typeorm_1.Index)(['device_id', 'status'])
], TabiotTrip);

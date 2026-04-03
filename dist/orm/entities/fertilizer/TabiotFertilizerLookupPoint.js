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
exports.TabiotFertilizerLookupPoint = void 0;
const typeorm_1 = require("typeorm");
const TabiotDevice_1 = require("../device/TabiotDevice");
/**
 * Fertilizer Lookup Point Entity
 *
 * Stores EC setpoint → valve time mappings for intelligent fertilizer control.
 * Each row represents either:
 * - An "Actual" point learned from real irrigation runs
 * - An "Interpolated" point calculated from surrounding actual points
 *
 * The lookup table is synchronized with the backend server and ThingsBoard.
 *
 * Modbus Register Mapping:
 * - time_on_valve_01-05 → Modbus holding registers 23-27
 * - actual_flow_01-05 ← Modbus holding registers 30-34
 * - EC values are stored as actual (e.g., 1.8), Modbus uses ×10 (e.g., 18)
 */
let TabiotFertilizerLookupPoint = class TabiotFertilizerLookupPoint {
};
exports.TabiotFertilizerLookupPoint = TabiotFertilizerLookupPoint;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)(),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotFertilizerLookupPoint.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 4,
        scale: 2,
        comment: 'Target EC setpoint (e.g., 1.80 mS/cm)'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "ec_setpoint", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 1 ON time per cycle (ms) - Modbus reg 23'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "time_on_valve_01", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 2 ON time per cycle (ms) - Modbus reg 24'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "time_on_valve_02", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 3 ON time per cycle (ms) - Modbus reg 25'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "time_on_valve_03", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 4 ON time per cycle (ms) - Modbus reg 26'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "time_on_valve_04", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 5 ON time per cycle (ms) - Modbus reg 27'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "time_on_valve_05", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 4,
        scale: 2,
        nullable: true,
        comment: 'Average EC achieved during runs (mS/cm)'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "actual_ec_avg", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 1 - from Modbus reg 30'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "actual_flow_01", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 2 - from Modbus reg 31'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "actual_flow_02", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 3 - from Modbus reg 32'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "actual_flow_03", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 4 - from Modbus reg 33'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "actual_flow_04", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 5 - from Modbus reg 34'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "actual_flow_05", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Number of irrigation runs contributing to this point'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerLookupPoint.prototype, "sample_count", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['Actual', 'Interpolated'],
        default: 'Interpolated',
        comment: 'Actual = learned from runs, Interpolated = calculated'
    }),
    __metadata("design:type", String)
], TabiotFertilizerLookupPoint.prototype, "data_type", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'datetime',
        nullable: true,
        comment: 'Last sync with backend server'
    }),
    __metadata("design:type", Date)
], TabiotFertilizerLookupPoint.prototype, "last_server_sync", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'datetime',
        default: () => 'CURRENT_TIMESTAMP',
        comment: 'Last update timestamp'
    }),
    __metadata("design:type", Date)
], TabiotFertilizerLookupPoint.prototype, "last_updated", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotDevice_1.TabiotDevice, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'device_id', referencedColumnName: 'name' }),
    __metadata("design:type", TabiotDevice_1.TabiotDevice)
], TabiotFertilizerLookupPoint.prototype, "device", void 0);
exports.TabiotFertilizerLookupPoint = TabiotFertilizerLookupPoint = __decorate([
    (0, typeorm_1.Entity)('tabiot_fertilizer_lookup_point'),
    (0, typeorm_1.Unique)(['device_id', 'ec_setpoint']),
    (0, typeorm_1.Index)(['device_id']),
    (0, typeorm_1.Index)(['ec_setpoint'])
], TabiotFertilizerLookupPoint);

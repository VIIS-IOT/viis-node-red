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
exports.TabiotFlowAccumulation = void 0;
const typeorm_1 = require("typeorm");
const TabiotDevice_1 = require("../device/TabiotDevice");
const TabiotOilProfile_1 = require("../oil-profile/TabiotOilProfile");
/**
 * Flow Accumulation Entity for Marine IoT System
 * Stores hourly accumulated flow data from flow sensors (fs01-fs06)
 */
let TabiotFlowAccumulation = class TabiotFlowAccumulation {
};
exports.TabiotFlowAccumulation = TabiotFlowAccumulation;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)(),
    __metadata("design:type", Number)
], TabiotFlowAccumulation.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotFlowAccumulation.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'varchar',
        length: 255,
        comment: 'Sensor key: fs01, fs02, fs03, fs04, fs05, fs06'
    }),
    __metadata("design:type", String)
], TabiotFlowAccumulation.prototype, "sensor_key", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'datetime',
        comment: 'Hour start timestamp (e.g., 2025-01-01 00:00:00)'
    }),
    __metadata("design:type", Date)
], TabiotFlowAccumulation.prototype, "hour_start", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'datetime',
        comment: 'Hour end timestamp (e.g., 2025-01-01 01:00:00)'
    }),
    __metadata("design:type", Date)
], TabiotFlowAccumulation.prototype, "hour_end", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'float',
        comment: 'Average flow rate in m3/h during this hour'
    }),
    __metadata("design:type", Number)
], TabiotFlowAccumulation.prototype, "avg_flow_m3h", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'float',
        comment: 'Accumulated volume in m3 for this hour'
    }),
    __metadata("design:type", Number)
], TabiotFlowAccumulation.prototype, "accumulated_m3", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'float',
        comment: 'Accumulated volume in tons for this hour (m3 * density)'
    }),
    __metadata("design:type", Number)
], TabiotFlowAccumulation.prototype, "accumulated_tons", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'varchar',
        length: 255,
        comment: 'Oil profile ID used for this calculation'
    }),
    __metadata("design:type", String)
], TabiotFlowAccumulation.prototype, "oil_profile_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'float',
        comment: 'Density value in kg/m³ used for tons calculation (snapshot from profile)'
    }),
    __metadata("design:type", Number)
], TabiotFlowAccumulation.prototype, "density_used", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        comment: 'Number of telemetry samples used in this hour calculation'
    }),
    __metadata("design:type", Number)
], TabiotFlowAccumulation.prototype, "sample_count", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'bigint',
        comment: 'Timestamp of first sample in this hour (ms)'
    }),
    __metadata("design:type", Number)
], TabiotFlowAccumulation.prototype, "first_sample_ts", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'bigint',
        comment: 'Timestamp of last sample in this hour (ms)'
    }),
    __metadata("design:type", Number)
], TabiotFlowAccumulation.prototype, "last_sample_ts", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'datetime',
        default: () => 'CURRENT_TIMESTAMP',
        comment: 'When this record was created'
    }),
    __metadata("design:type", Date)
], TabiotFlowAccumulation.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotDevice_1.TabiotDevice, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'device_id', referencedColumnName: 'name' }),
    __metadata("design:type", TabiotDevice_1.TabiotDevice)
], TabiotFlowAccumulation.prototype, "device", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotOilProfile_1.TabiotOilProfile),
    (0, typeorm_1.JoinColumn)({ name: 'oil_profile_id', referencedColumnName: 'name' }),
    __metadata("design:type", TabiotOilProfile_1.TabiotOilProfile)
], TabiotFlowAccumulation.prototype, "oil_profile", void 0);
exports.TabiotFlowAccumulation = TabiotFlowAccumulation = __decorate([
    (0, typeorm_1.Entity)('tabiot_flow_accumulation'),
    (0, typeorm_1.Unique)(['device_id', 'sensor_key', 'hour_start']),
    (0, typeorm_1.Index)(['device_id', 'hour_start']),
    (0, typeorm_1.Index)(['sensor_key', 'hour_start'])
], TabiotFlowAccumulation);

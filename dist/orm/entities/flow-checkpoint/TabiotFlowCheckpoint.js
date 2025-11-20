"use strict";
/**
 * @fileoverview TabiotFlowCheckpoint Entity
 *
 * Stores checkpoint values for TFS (Total Flow Sensor) to calculate delta-based accumulation
 * Used by both TripAccumulationWorker and FlowAccumulationService
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
exports.TabiotFlowCheckpoint = void 0;
const typeorm_1 = require("typeorm");
/**
 * Flow checkpoint for tracking last TFS value
 * Enables delta calculation: current_tfs - last_tfs = accumulated volume
 */
let TabiotFlowCheckpoint = class TabiotFlowCheckpoint {
};
exports.TabiotFlowCheckpoint = TabiotFlowCheckpoint;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)(),
    __metadata("design:type", Number)
], TabiotFlowCheckpoint.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, comment: 'Device ID' }),
    __metadata("design:type", String)
], TabiotFlowCheckpoint.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'varchar',
        length: 20,
        comment: 'TFS sensor key: tfs01, tfs02, tfs03, tfs04, tfs05, tfs06'
    }),
    __metadata("design:type", String)
], TabiotFlowCheckpoint.prototype, "sensor_key", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'varchar',
        length: 20,
        comment: 'Checkpoint type: trip or hourly'
    }),
    __metadata("design:type", String)
], TabiotFlowCheckpoint.prototype, "checkpoint_type", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 12,
        scale: 4,
        default: 0,
        comment: 'Last TFS value read from PLC (m³)'
    }),
    __metadata("design:type", Number)
], TabiotFlowCheckpoint.prototype, "last_tfs_value", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'bigint',
        comment: 'Timestamp when checkpoint was last updated (ms)'
    }),
    __metadata("design:type", Number)
], TabiotFlowCheckpoint.prototype, "last_update_time", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'text',
        nullable: true,
        comment: 'Additional metadata (JSON)'
    }),
    __metadata("design:type", String)
], TabiotFlowCheckpoint.prototype, "metadata", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], TabiotFlowCheckpoint.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], TabiotFlowCheckpoint.prototype, "updated_at", void 0);
exports.TabiotFlowCheckpoint = TabiotFlowCheckpoint = __decorate([
    (0, typeorm_1.Entity)('tabiot_flow_checkpoint'),
    (0, typeorm_1.Index)('idx_checkpoint_lookup', ['device_id', 'sensor_key', 'checkpoint_type'], { unique: true }),
    (0, typeorm_1.Index)(['device_id']),
    (0, typeorm_1.Index)(['sensor_key'])
], TabiotFlowCheckpoint);

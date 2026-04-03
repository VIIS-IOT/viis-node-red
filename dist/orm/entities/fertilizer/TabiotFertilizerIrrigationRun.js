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
exports.TabiotFertilizerIrrigationRun = void 0;
const typeorm_1 = require("typeorm");
const TabiotDevice_1 = require("../device/TabiotDevice");
const TabiotSchedule_1 = require("../schedule/TabiotSchedule");
/**
 * Fertilizer Irrigation Run Entity
 *
 * Stores history of all irrigation runs with EC control.
 * Used for:
 * - Learning: Calculate lookup table updates after each run
 * - Audit: Track all irrigation activities
 * - Sync: Queue runs to sync with backend when online
 *
 * Data Collection:
 * - EC and flow values are averaged after skipping 20s ramp-up period
 * - Valve times are the values that were written to Modbus at start of run
 */
let TabiotFertilizerIrrigationRun = class TabiotFertilizerIrrigationRun {
};
exports.TabiotFertilizerIrrigationRun = TabiotFertilizerIrrigationRun;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)(),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotFertilizerIrrigationRun.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'varchar',
        length: 255,
        nullable: true,
        comment: 'Schedule that triggered this run (if any)'
    }),
    __metadata("design:type", String)
], TabiotFertilizerIrrigationRun.prototype, "schedule_name", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 4,
        scale: 2,
        comment: 'Target EC setpoint (e.g., 1.80 mS/cm)'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "ec_setpoint", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 4,
        scale: 2,
        nullable: true,
        comment: 'Average EC achieved (after 20s ramp-up)'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "ec_achieved_avg", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 1'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "flow_achieved_01_avg", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 2'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "flow_achieved_02_avg", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 3'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "flow_achieved_03_avg", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 4'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "flow_achieved_04_avg", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'decimal',
        precision: 8,
        scale: 2,
        nullable: true,
        comment: 'Average flow rate valve 5'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "flow_achieved_05_avg", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 1 ON time per cycle (ms)'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "time_on_valve_01", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 2 ON time per cycle (ms)'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "time_on_valve_02", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 3 ON time per cycle (ms)'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "time_on_valve_03", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 4 ON time per cycle (ms)'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "time_on_valve_04", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Valve 5 ON time per cycle (ms)'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "time_on_valve_05", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'datetime',
        comment: 'When irrigation started'
    }),
    __metadata("design:type", Date)
], TabiotFertilizerIrrigationRun.prototype, "start_time", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'datetime',
        nullable: true,
        comment: 'When irrigation ended'
    }),
    __metadata("design:type", Date)
], TabiotFertilizerIrrigationRun.prototype, "end_time", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        nullable: true,
        comment: 'Total duration in seconds'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "duration_seconds", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['Running', 'Completed', 'Failed', 'Interrupted'],
        default: 'Running',
        comment: 'Current status of the run'
    }),
    __metadata("design:type", String)
], TabiotFertilizerIrrigationRun.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'varchar',
        length: 255,
        nullable: true,
        comment: 'Error code if status is Failed'
    }),
    __metadata("design:type", String)
], TabiotFertilizerIrrigationRun.prototype, "error_code", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'text',
        nullable: true,
        comment: 'Additional error details or notes'
    }),
    __metadata("design:type", String)
], TabiotFertilizerIrrigationRun.prototype, "error_message", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'tinyint',
        default: 0,
        comment: '1 = synced to backend, 0 = pending sync'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "is_synced_to_server", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'datetime',
        nullable: true,
        comment: 'When successfully synced to server'
    }),
    __metadata("design:type", Date)
], TabiotFertilizerIrrigationRun.prototype, "synced_at", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'int',
        default: 0,
        comment: 'Number of sync attempts'
    }),
    __metadata("design:type", Number)
], TabiotFertilizerIrrigationRun.prototype, "sync_attempts", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'text',
        nullable: true,
        comment: 'Last sync error message'
    }),
    __metadata("design:type", String)
], TabiotFertilizerIrrigationRun.prototype, "sync_error", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'datetime',
        default: () => 'CURRENT_TIMESTAMP',
        comment: 'Record creation time'
    }),
    __metadata("design:type", Date)
], TabiotFertilizerIrrigationRun.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotDevice_1.TabiotDevice, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'device_id', referencedColumnName: 'name' }),
    __metadata("design:type", TabiotDevice_1.TabiotDevice)
], TabiotFertilizerIrrigationRun.prototype, "device", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotSchedule_1.TabiotSchedule, { onDelete: 'SET NULL' }),
    (0, typeorm_1.JoinColumn)({ name: 'schedule_name', referencedColumnName: 'name' }),
    __metadata("design:type", TabiotSchedule_1.TabiotSchedule)
], TabiotFertilizerIrrigationRun.prototype, "schedule", void 0);
exports.TabiotFertilizerIrrigationRun = TabiotFertilizerIrrigationRun = __decorate([
    (0, typeorm_1.Entity)('tabiot_fertilizer_irrigation_run'),
    (0, typeorm_1.Index)(['device_id', 'start_time']),
    (0, typeorm_1.Index)(['is_synced_to_server', 'status']),
    (0, typeorm_1.Index)(['schedule_name'])
], TabiotFertilizerIrrigationRun);

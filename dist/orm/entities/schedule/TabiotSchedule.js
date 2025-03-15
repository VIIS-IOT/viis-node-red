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
exports.TabiotScheduleLog = exports.TabiotSchedule = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
const TabiotSchedulePlan_1 = require("../schedulePlan/TabiotSchedulePlan");
let TabiotSchedule = class TabiotSchedule extends Base_1.CustomBaseEntity {
};
exports.TabiotSchedule = TabiotSchedule;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'mediumtext', nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "action", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', default: 1 }),
    __metadata("design:type", Number)
], TabiotSchedule.prototype, "enable", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "label", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'time', nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "set_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "start_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "end_date", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['', 'circulate', 'period', 'fixed', 'interval'],
        default: '',
    }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "interval", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'time', nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "start_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'time', nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "end_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', nullable: true }),
    __metadata("design:type", Number)
], TabiotSchedule.prototype, "is_from_local", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], TabiotSchedule.prototype, "is_synced", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', default: 0 }),
    __metadata("design:type", Number)
], TabiotSchedule.prototype, "is_deleted", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['running', 'stopped', 'finished', ''],
        default: '',
    }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotSchedule.prototype, "schedule_plan_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotSchedulePlan_1.TabiotSchedulePlan, { onDelete: 'SET NULL' }),
    (0, typeorm_1.JoinColumn)({ name: 'schedule_plan_id' }),
    __metadata("design:type", TabiotSchedulePlan_1.TabiotSchedulePlan)
], TabiotSchedule.prototype, "schedulePlan", void 0);
exports.TabiotSchedule = TabiotSchedule = __decorate([
    (0, typeorm_1.Entity)('tabiot_schedule')
], TabiotSchedule);
let TabiotScheduleLog = class TabiotScheduleLog extends Base_1.CustomBaseEntity {
};
exports.TabiotScheduleLog = TabiotScheduleLog;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotScheduleLog.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'time', nullable: true }),
    __metadata("design:type", String)
], TabiotScheduleLog.prototype, "start_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'time', nullable: true }),
    __metadata("design:type", String)
], TabiotScheduleLog.prototype, "end_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotScheduleLog.prototype, "schedule_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotSchedule, { onDelete: 'SET NULL' }),
    (0, typeorm_1.JoinColumn)({ name: 'schedule_id' }),
    __metadata("design:type", TabiotSchedule)
], TabiotScheduleLog.prototype, "schedule", void 0);
exports.TabiotScheduleLog = TabiotScheduleLog = __decorate([
    (0, typeorm_1.Entity)('tabiot_schedule_log')
], TabiotScheduleLog);

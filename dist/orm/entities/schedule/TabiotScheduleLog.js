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
exports.TabiotScheduleLog = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
const TabiotSchedule_1 = require("./TabiotSchedule");
let TabiotScheduleLog = class TabiotScheduleLog extends Base_1.CustomBaseEntity {
};
exports.TabiotScheduleLog = TabiotScheduleLog;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotScheduleLog.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime', nullable: true }),
    __metadata("design:type", String)
], TabiotScheduleLog.prototype, "start_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime', nullable: true }),
    __metadata("design:type", String)
], TabiotScheduleLog.prototype, "end_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotScheduleLog.prototype, "schedule_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotSchedule_1.TabiotSchedule, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'schedule_id' }),
    __metadata("design:type", TabiotSchedule_1.TabiotSchedule)
], TabiotScheduleLog.prototype, "schedule", void 0);
exports.TabiotScheduleLog = TabiotScheduleLog = __decorate([
    (0, typeorm_1.Entity)('tabiot_schedule_log')
], TabiotScheduleLog);

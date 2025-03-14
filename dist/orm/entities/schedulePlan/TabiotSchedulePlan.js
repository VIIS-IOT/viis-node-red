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
exports.TabiotSchedulePlan = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
let TabiotSchedulePlan = class TabiotSchedulePlan extends Base_1.CustomBaseEntity {
};
exports.TabiotSchedulePlan = TabiotSchedulePlan;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotSchedulePlan.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: false }),
    __metadata("design:type", String)
], TabiotSchedulePlan.prototype, "label", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], TabiotSchedulePlan.prototype, "schedule_count", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['active', 'inactive'],
        default: 'inactive'
    }),
    __metadata("design:type", String)
], TabiotSchedulePlan.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', nullable: true }),
    __metadata("design:type", Number)
], TabiotSchedulePlan.prototype, "enable", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', default: 0 }),
    __metadata("design:type", Number)
], TabiotSchedulePlan.prototype, "is_synced", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 1 }),
    __metadata("design:type", Number)
], TabiotSchedulePlan.prototype, "is_from_local", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotSchedulePlan.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", String)
], TabiotSchedulePlan.prototype, "start_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", String)
], TabiotSchedulePlan.prototype, "end_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', default: 0 }),
    __metadata("design:type", Number)
], TabiotSchedulePlan.prototype, "is_deleted", void 0);
exports.TabiotSchedulePlan = TabiotSchedulePlan = __decorate([
    (0, typeorm_1.Entity)('tabiot_schedule_plan')
], TabiotSchedulePlan);

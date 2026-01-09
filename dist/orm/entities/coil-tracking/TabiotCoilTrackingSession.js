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
exports.TabiotCoilTrackingSession = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
/**
 * Entity for coil tracking sessions
 * Stores coil state tracking with duration and related telemetry snapshots
 */
let TabiotCoilTrackingSession = class TabiotCoilTrackingSession extends Base_1.CustomBaseEntity {
};
exports.TabiotCoilTrackingSession = TabiotCoilTrackingSession;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], TabiotCoilTrackingSession.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100 }),
    __metadata("design:type", String)
], TabiotCoilTrackingSession.prototype, "tracking_key", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100 }),
    __metadata("design:type", String)
], TabiotCoilTrackingSession.prototype, "coil_key", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 50, nullable: true }),
    __metadata("design:type", String)
], TabiotCoilTrackingSession.prototype, "board_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCoilTrackingSession.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime' }),
    __metadata("design:type", Date)
], TabiotCoilTrackingSession.prototype, "start_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime', nullable: true }),
    __metadata("design:type", Date)
], TabiotCoilTrackingSession.prototype, "end_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], TabiotCoilTrackingSession.prototype, "duration_seconds", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['active', 'completed'],
        default: 'active'
    }),
    __metadata("design:type", String)
], TabiotCoilTrackingSession.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], TabiotCoilTrackingSession.prototype, "start_snapshot", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], TabiotCoilTrackingSession.prototype, "end_snapshot", void 0);
exports.TabiotCoilTrackingSession = TabiotCoilTrackingSession = __decorate([
    (0, typeorm_1.Entity)('tabiot_coil_tracking_session'),
    (0, typeorm_1.Index)(['tracking_key']),
    (0, typeorm_1.Index)(['coil_key']),
    (0, typeorm_1.Index)(['device_id', 'status']),
    (0, typeorm_1.Index)(['start_time']),
    (0, typeorm_1.Index)(['board_id'])
], TabiotCoilTrackingSession);

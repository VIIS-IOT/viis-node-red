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
exports.TabiotGatewayAlarmState = void 0;
const typeorm_1 = require("typeorm");
/**
 * Last state the gateway sent for one state alarm (`board_offline:board1`, `schedule_off_failed:<schedule>`).
 * `raise` only enqueues when the row is not already `Pending`, `clear` only when it is, so a condition that
 * repeats every poll sends one Pending and one Clear. The `Pending` rows are the snapshot the outbox sends
 * after a backend outage. One `Meta` row (`__outbox_meta:snapshot_pending`) records that a snapshot is owed. Created at runtime by `EVENT_OUTBOX_DDL`; instants are naive UTC (ADR-016).
 */
let TabiotGatewayAlarmState = class TabiotGatewayAlarmState {
};
exports.TabiotGatewayAlarmState = TabiotGatewayAlarmState;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], TabiotGatewayAlarmState.prototype, "alarm_key", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16 })
    /** `Meta`: bookkeeping row (the snapshot-pending marker), never an alarm. */
    ,
    __metadata("design:type", String)
], TabiotGatewayAlarmState.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16 }),
    __metadata("design:type", String)
], TabiotGatewayAlarmState.prototype, "severity", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], TabiotGatewayAlarmState.prototype, "payload", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime', precision: 3 }),
    __metadata("design:type", Date)
], TabiotGatewayAlarmState.prototype, "updated_at", void 0);
exports.TabiotGatewayAlarmState = TabiotGatewayAlarmState = __decorate([
    (0, typeorm_1.Entity)('tabiot_gateway_alarm_state')
], TabiotGatewayAlarmState);

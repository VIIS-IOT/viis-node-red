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
exports.TabiotEventOutbox = void 0;
const typeorm_1 = require("typeorm");
/**
 * One gateway event waiting for (or already past) delivery to the backend `notification-by-token`.
 * `seq` is the delivery order; `event_id` travels in the payload so the backend inbox drops a retried
 * duplicate. The device token is read at send time and never stored here.
 * Created at runtime by `EVENT_OUTBOX_DDL` (gateway MySQL has no migrations): keep both in step.
 * Instants are naive UTC (ADR-016).
 */
let TabiotEventOutbox = class TabiotEventOutbox {
};
exports.TabiotEventOutbox = TabiotEventOutbox;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)({ type: 'bigint' }),
    __metadata("design:type", String)
], TabiotEventOutbox.prototype, "seq", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64, unique: true }),
    __metadata("design:type", String)
], TabiotEventOutbox.prototype, "event_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json' }),
    __metadata("design:type", Object)
], TabiotEventOutbox.prototype, "payload", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime', precision: 3 }),
    __metadata("design:type", Date)
], TabiotEventOutbox.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime', precision: 3 }),
    __metadata("design:type", Date)
], TabiotEventOutbox.prototype, "next_attempt_at", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime', precision: 3, nullable: true }),
    __metadata("design:type", Date)
], TabiotEventOutbox.prototype, "sent_at", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], TabiotEventOutbox.prototype, "dead", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], TabiotEventOutbox.prototype, "attempts", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotEventOutbox.prototype, "last_error", void 0);
exports.TabiotEventOutbox = TabiotEventOutbox = __decorate([
    (0, typeorm_1.Entity)('tabiot_event_outbox'),
    (0, typeorm_1.Index)('idx_event_outbox_pending', ['sent_at', 'dead', 'next_attempt_at'])
], TabiotEventOutbox);

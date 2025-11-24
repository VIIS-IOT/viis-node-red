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
exports.TabiotThingsboardTelemetryQueue = void 0;
const typeorm_1 = require("typeorm");
/**
 * Entity for storing failed ThingsBoard telemetry data for retry
 * Supports batch telemetry upload with retry mechanism
 */
let TabiotThingsboardTelemetryQueue = class TabiotThingsboardTelemetryQueue {
};
exports.TabiotThingsboardTelemetryQueue = TabiotThingsboardTelemetryQueue;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)(),
    __metadata("design:type", Number)
], TabiotThingsboardTelemetryQueue.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    (0, typeorm_1.Index)('idx_device_id'),
    __metadata("design:type", String)
], TabiotThingsboardTelemetryQueue.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotThingsboardTelemetryQueue.prototype, "device_token", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 36, unique: true }),
    (0, typeorm_1.Index)('idx_idempotency_key'),
    __metadata("design:type", String)
], TabiotThingsboardTelemetryQueue.prototype, "idempotency_key", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json' }),
    __metadata("design:type", Array)
], TabiotThingsboardTelemetryQueue.prototype, "payload", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint' }),
    __metadata("design:type", Number)
], TabiotThingsboardTelemetryQueue.prototype, "timestamp", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], TabiotThingsboardTelemetryQueue.prototype, "retry_count", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 3 }),
    __metadata("design:type", Number)
], TabiotThingsboardTelemetryQueue.prototype, "max_retries", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['pending', 'retrying', 'failed', 'success'],
        default: 'pending'
    }),
    (0, typeorm_1.Index)('idx_status'),
    __metadata("design:type", String)
], TabiotThingsboardTelemetryQueue.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], TabiotThingsboardTelemetryQueue.prototype, "last_error", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], TabiotThingsboardTelemetryQueue.prototype, "last_retry_at", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], TabiotThingsboardTelemetryQueue.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], TabiotThingsboardTelemetryQueue.prototype, "updated_at", void 0);
exports.TabiotThingsboardTelemetryQueue = TabiotThingsboardTelemetryQueue = __decorate([
    (0, typeorm_1.Entity)('tabiot_thingsboard_telemetry_queue'),
    (0, typeorm_1.Index)('idx_retry', ['status', 'retry_count', 'last_retry_at'])
], TabiotThingsboardTelemetryQueue);

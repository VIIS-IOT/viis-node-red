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
exports.TabiotActuatorClaim = void 0;
const typeorm_1 = require("typeorm");
/**
 * One live actuator claim of the arbiter (`viis-actuator-arbiter`), persisted so claims survive a
 * Node-RED restart. The arbiter rewrites the whole table on every change (`ClaimStore.save`).
 * Times are epoch milliseconds, so no timezone applies. Created at runtime by `ACTUATOR_CLAIM_DDL`
 * (gateway MySQL has no migrations): keep both in step.
 */
let TabiotActuatorClaim = class TabiotActuatorClaim {
};
exports.TabiotActuatorClaim = TabiotActuatorClaim;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], TabiotActuatorClaim.prototype, "owner_id", void 0);
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], TabiotActuatorClaim.prototype, "claim_key", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean' }),
    __metadata("design:type", Boolean)
], TabiotActuatorClaim.prototype, "value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20 }),
    __metadata("design:type", String)
], TabiotActuatorClaim.prototype, "source", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', nullable: true }),
    __metadata("design:type", String)
], TabiotActuatorClaim.prototype, "expires_at", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint' }),
    __metadata("design:type", String)
], TabiotActuatorClaim.prototype, "created_at", void 0);
exports.TabiotActuatorClaim = TabiotActuatorClaim = __decorate([
    (0, typeorm_1.Entity)('tabiot_actuator_claim')
], TabiotActuatorClaim);

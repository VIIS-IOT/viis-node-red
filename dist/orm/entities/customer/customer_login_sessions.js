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
exports.CustomerLoginSessions = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
const customer_user_1 = require("./customer_user");
const uuid_1 = require("uuid");
let CustomerLoginSessions = class CustomerLoginSessions extends Base_1.CustomBaseEntity {
    generateName() {
        // Format: SES-{UUID}
        this.name = `SES-${(0, uuid_1.v4)()}`;
        this.login_time = new Date();
    }
};
exports.CustomerLoginSessions = CustomerLoginSessions;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], CustomerLoginSessions.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], CustomerLoginSessions.prototype, "user_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => customer_user_1.IotCustomerUser, user => user.sessions),
    (0, typeorm_1.JoinColumn)({ name: 'user_id', referencedColumnName: 'name' }),
    __metadata("design:type", customer_user_1.IotCustomerUser)
], CustomerLoginSessions.prototype, "user", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], CustomerLoginSessions.prototype, "device", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 45, nullable: true }),
    __metadata("design:type", String)
], CustomerLoginSessions.prototype, "ip_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', name: 'login_time' }),
    __metadata("design:type", Date)
], CustomerLoginSessions.prototype, "login_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', name: 'logout_time', nullable: true }),
    __metadata("design:type", Date)
], CustomerLoginSessions.prototype, "logout_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: true }),
    __metadata("design:type", Boolean)
], CustomerLoginSessions.prototype, "is_active", void 0);
__decorate([
    (0, typeorm_1.BeforeInsert)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CustomerLoginSessions.prototype, "generateName", null);
exports.CustomerLoginSessions = CustomerLoginSessions = __decorate([
    (0, typeorm_1.Entity)('customer_login_sessions')
], CustomerLoginSessions);

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
exports.IotCustomerUserCredentials = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
const customer_user_1 = require("./customer_user");
let IotCustomerUserCredentials = class IotCustomerUserCredentials extends Base_1.CustomBaseEntity {
};
exports.IotCustomerUserCredentials = IotCustomerUserCredentials;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], IotCustomerUserCredentials.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUserCredentials.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'smallint', default: 0 }),
    __metadata("design:type", Number)
], IotCustomerUserCredentials.prototype, "enable", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUserCredentials.prototype, "password", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUserCredentials.prototype, "user_id", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => customer_user_1.IotCustomerUser, user => user.credential),
    (0, typeorm_1.JoinColumn)({ name: 'user_id', referencedColumnName: 'name' }),
    __metadata("design:type", customer_user_1.IotCustomerUser)
], IotCustomerUserCredentials.prototype, "user", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true }),
    __metadata("design:type", Date)
], IotCustomerUserCredentials.prototype, "last_reset_password_key_generated_on", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUserCredentials.prototype, "reset_password_key", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', default: 0 }),
    __metadata("design:type", Number)
], IotCustomerUserCredentials.prototype, "total_retry_send_email", void 0);
exports.IotCustomerUserCredentials = IotCustomerUserCredentials = __decorate([
    (0, typeorm_1.Entity)('tabiot_customer_user_credentials')
], IotCustomerUserCredentials);

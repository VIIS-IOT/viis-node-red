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
exports.IotDynamicRole = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
const customer_1 = require("../customer/customer");
const customer_user_1 = require("../customer/customer_user");
let IotDynamicRole = class IotDynamicRole extends Base_1.CustomBaseEntity {
};
exports.IotDynamicRole = IotDynamicRole;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], IotDynamicRole.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotDynamicRole.prototype, "label", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotDynamicRole.prototype, "role", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    (0, typeorm_1.ManyToOne)(() => customer_1.TabiotCustomer, customer => customer.dynamicRole),
    (0, typeorm_1.JoinColumn)({ name: 'iot_customer', referencedColumnName: 'name' }),
    __metadata("design:type", customer_1.TabiotCustomer)
], IotDynamicRole.prototype, "iot_customer", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => customer_user_1.IotCustomerUser, user => user.dynamicRole),
    __metadata("design:type", Array)
], IotDynamicRole.prototype, "users", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], IotDynamicRole.prototype, "sections", void 0);
exports.IotDynamicRole = IotDynamicRole = __decorate([
    (0, typeorm_1.Entity)('tabiot_dynamic_role')
], IotDynamicRole);

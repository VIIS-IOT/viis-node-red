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
exports.TabiotCustomer = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
const customer_user_1 = require("./customer_user");
const TabiotDevice_1 = require("../device/TabiotDevice");
const dynamicRole_1 = require("../dynamicRole/dynamicRole");
const TabiotNotification_1 = require("../notification/TabiotNotification");
let TabiotCustomer = class TabiotCustomer extends Base_1.CustomBaseEntity {
};
exports.TabiotCustomer = TabiotCustomer;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "modifiedBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, unique: true, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "customerName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", Date)
], TabiotCustomer.prototype, "createdTime", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "email", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "phone", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "address", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "city", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "country", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "province", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "zipPostalCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "zipCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "logo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "district", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "ward", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "packageId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'smallint', default: 0, nullable: false }),
    __metadata("design:type", Number)
], TabiotCustomer.prototype, "developerMode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "developerWebhookId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotCustomer.prototype, "developerRuleId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 21, scale: 9, default: 0, nullable: false }),
    __metadata("design:type", Number)
], TabiotCustomer.prototype, "test", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'smallint', default: 0, nullable: false }),
    __metadata("design:type", Number)
], TabiotCustomer.prototype, "isReceiveConnectionNoti", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'smallint', default: 0, nullable: false }),
    __metadata("design:type", Number)
], TabiotCustomer.prototype, "isReceiveNotificationNoti", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => TabiotDevice_1.TabiotDevice, device => device.customer),
    __metadata("design:type", Array)
], TabiotCustomer.prototype, "devices", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => dynamicRole_1.IotDynamicRole, dynamicRole => dynamicRole.iot_customer),
    __metadata("design:type", Array)
], TabiotCustomer.prototype, "dynamicRole", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => customer_user_1.IotCustomerUser, user => user.iot_customer),
    __metadata("design:type", Array)
], TabiotCustomer.prototype, "users", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => TabiotNotification_1.TabiotNotification, notification => notification.customer),
    __metadata("design:type", Array)
], TabiotCustomer.prototype, "notifications", void 0);
exports.TabiotCustomer = TabiotCustomer = __decorate([
    (0, typeorm_1.Entity)('tabiot_customer', { schema: 'public' })
], TabiotCustomer);

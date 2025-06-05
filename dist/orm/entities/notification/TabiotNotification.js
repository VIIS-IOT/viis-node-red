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
exports.TabiotNotification = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
const customer_1 = require("../customer/customer");
const customer_user_1 = require("../customer/customer_user");
let TabiotNotification = class TabiotNotification extends Base_1.CustomBaseEntity {
    constructor() {
        super(...arguments);
        this.is_read = 0;
        this.is_sent = 0;
    }
};
exports.TabiotNotification = TabiotNotification;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], TabiotNotification.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotNotification.prototype, "customer_user", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], TabiotNotification.prototype, "message", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true }),
    __metadata("design:type", Date)
], TabiotNotification.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotNotification.prototype, "entity", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotNotification.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'smallint', default: 0 }),
    __metadata("design:type", Number)
], TabiotNotification.prototype, "is_read", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'smallint', default: 0 }),
    __metadata("design:type", Number)
], TabiotNotification.prototype, "is_sent", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotNotification.prototype, "customer_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotNotification.prototype, "err_code", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotNotification.prototype, "entity_label", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], TabiotNotification.prototype, "severity", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => customer_1.TabiotCustomer, customer => customer.notifications, {
        nullable: true,
        onDelete: 'CASCADE'
    }),
    (0, typeorm_1.JoinColumn)({ name: 'customer_id', referencedColumnName: 'name' }),
    __metadata("design:type", customer_1.TabiotCustomer)
], TabiotNotification.prototype, "customer", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => customer_user_1.IotCustomerUser, customerUser => customerUser.notifications, {
        nullable: true,
        onDelete: 'CASCADE'
    }),
    (0, typeorm_1.JoinColumn)({ name: 'customer_user', referencedColumnName: 'name' }),
    __metadata("design:type", customer_user_1.IotCustomerUser)
], TabiotNotification.prototype, "customerUser", void 0);
exports.TabiotNotification = TabiotNotification = __decorate([
    (0, typeorm_1.Entity)('tabiot_notification', { schema: 'public' })
], TabiotNotification);

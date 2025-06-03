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
exports.IotCustomerUser = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
const user_role_1 = require("../../../constants/user_role");
const dynamicRole_1 = require("../dynamicRole/dynamicRole");
const customer_1 = require("./customer");
const customer_login_sessions_1 = require("./customer_login_sessions");
const customer_user_credentials_1 = require("./customer_user_credentials");
let IotCustomerUser = class IotCustomerUser extends Base_1.CustomBaseEntity {
};
exports.IotCustomerUser = IotCustomerUser;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 140 }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Index)('unique_user_id', { unique: true }),
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "user_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "user_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", Date)
], IotCustomerUser.prototype, "created_time", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "user_avatar", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "email", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "full_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "phone_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "address", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", Date)
], IotCustomerUser.prototype, "date_join", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", Date)
], IotCustomerUser.prototype, "date_active", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "date_warranty", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "first_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "last_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "district", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "ward", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "province", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'smallint', default: 0 }),
    __metadata("design:type", Number)
], IotCustomerUser.prototype, "is_admin", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "employee_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        default: user_role_1.UserRoleTypeEnum.CUSTOMER_USER,
        enum: user_role_1.UserRoleTypeEnum,
    }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "user_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "role_label", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'smallint', nullable: true }),
    __metadata("design:type", Number)
], IotCustomerUser.prototype, "is_deactivated", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => customer_login_sessions_1.CustomerLoginSessions, session => session.user),
    __metadata("design:type", Array)
], IotCustomerUser.prototype, "sessions", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "customer_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => customer_1.TabiotCustomer, customer => customer.users),
    (0, typeorm_1.JoinColumn)({ name: 'customer_id', referencedColumnName: 'name' }),
    __metadata("design:type", customer_1.TabiotCustomer)
], IotCustomerUser.prototype, "iot_customer", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 140, nullable: true }),
    __metadata("design:type", String)
], IotCustomerUser.prototype, "iot_dynamic_role", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => dynamicRole_1.IotDynamicRole, dynamicRole => dynamicRole.users, { onDelete: 'SET NULL' }),
    (0, typeorm_1.JoinColumn)({ name: 'iot_dynamic_role', referencedColumnName: 'name' }),
    __metadata("design:type", dynamicRole_1.IotDynamicRole)
], IotCustomerUser.prototype, "dynamicRole", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => customer_user_credentials_1.IotCustomerUserCredentials, credential => credential.user)
    // @JoinColumn({ name: 'name', referencedColumnName: 'user_id' })
    ,
    __metadata("design:type", customer_user_credentials_1.IotCustomerUserCredentials)
], IotCustomerUser.prototype, "credential", void 0);
exports.IotCustomerUser = IotCustomerUser = __decorate([
    (0, typeorm_1.Entity)('tabiot_customer_user')
], IotCustomerUser);

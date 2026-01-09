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
exports.TabiotDeviceProfile = void 0;
const typeorm_1 = require("typeorm");
const Base_1 = require("../base/Base");
let TabiotDeviceProfile = class TabiotDeviceProfile extends Base_1.CustomBaseEntity {
};
exports.TabiotDeviceProfile = TabiotDeviceProfile;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "tb_device_profile_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "label", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "image", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['DEFAULT', 'MQTT', 'CoAP', 'LWM2M', 'SNMP'],
        nullable: true,
    }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "transport_type", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['DISABLED', 'ALLOW_CREATE_NEW_DEVICES'],
        nullable: true,
    }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "provision_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], TabiotDeviceProfile.prototype, "profile_data", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', nullable: true }),
    __metadata("design:type", Boolean)
], TabiotDeviceProfile.prototype, "is_default", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "firmware_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "software_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "default_rule_chain_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "default_dashboard_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "default_queue", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], TabiotDeviceProfile.prototype, "provision_device_key", void 0);
exports.TabiotDeviceProfile = TabiotDeviceProfile = __decorate([
    (0, typeorm_1.Entity)('tabiot_device_profile')
], TabiotDeviceProfile);

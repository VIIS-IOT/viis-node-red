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
exports.DeviceOfflineAutomationIntent = void 0;
const typeorm_1 = require("typeorm");
const TabiotDevice_1 = require("../device/TabiotDevice");
const Base_1 = require("../base/Base");
let DeviceOfflineAutomationIntent = class DeviceOfflineAutomationIntent extends Base_1.CustomBaseEntity {
};
exports.DeviceOfflineAutomationIntent = DeviceOfflineAutomationIntent;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'varchar', length: 36 }),
    __metadata("design:type", String)
], DeviceOfflineAutomationIntent.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], DeviceOfflineAutomationIntent.prototype, "label", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'tinyint', default: 1 }),
    __metadata("design:type", Boolean)
], DeviceOfflineAutomationIntent.prototype, "enable", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], DeviceOfflineAutomationIntent.prototype, "intent_json", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", String)
], DeviceOfflineAutomationIntent.prototype, "device_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => TabiotDevice_1.TabiotDevice),
    (0, typeorm_1.JoinColumn)({ name: 'device_id' }),
    __metadata("design:type", TabiotDevice_1.TabiotDevice)
], DeviceOfflineAutomationIntent.prototype, "device", void 0);
exports.DeviceOfflineAutomationIntent = DeviceOfflineAutomationIntent = __decorate([
    (0, typeorm_1.Entity)('device_offline_automation_intents')
], DeviceOfflineAutomationIntent);

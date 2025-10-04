"use strict";
/**
 * @fileoverview Enhanced Device DTOs with comprehensive validation
 *
 * This module provides sophisticated validation DTOs for device management operations
 * using advanced class-validator decorators and routing-controllers integration.
 *
 * Features:
 * - Device status enum validation
 * - Nested configuration object validation
 * - Array validation for device capabilities
 * - Location and metadata validation
 * - Custom validation for device-specific business rules
 */
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
exports.BulkDeviceOperationDto = exports.DeviceParamsDto = exports.DeviceQueryDto = exports.UpdateDeviceDto = exports.CreateDeviceDto = exports.DeviceConfigurationDto = exports.DeviceLocationDto = exports.CommunicationProtocol = exports.DeviceType = exports.DeviceStatus = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const custom_validators_1 = require("../validators/custom.validators");
/**
 * Device status enumeration
 */
var DeviceStatus;
(function (DeviceStatus) {
    DeviceStatus["ACTIVE"] = "active";
    DeviceStatus["INACTIVE"] = "inactive";
    DeviceStatus["MAINTENANCE"] = "maintenance";
    DeviceStatus["ERROR"] = "error";
    DeviceStatus["OFFLINE"] = "offline";
})(DeviceStatus || (exports.DeviceStatus = DeviceStatus = {}));
/**
 * Device type enumeration
 */
var DeviceType;
(function (DeviceType) {
    DeviceType["SENSOR"] = "sensor";
    DeviceType["ACTUATOR"] = "actuator";
    DeviceType["CONTROLLER"] = "controller";
    DeviceType["GATEWAY"] = "gateway";
    DeviceType["HYBRID"] = "hybrid";
})(DeviceType || (exports.DeviceType = DeviceType = {}));
/**
 * Communication protocol enumeration
 */
var CommunicationProtocol;
(function (CommunicationProtocol) {
    CommunicationProtocol["MODBUS_TCP"] = "modbus_tcp";
    CommunicationProtocol["MODBUS_RTU"] = "modbus_rtu";
    CommunicationProtocol["MQTT"] = "mqtt";
    CommunicationProtocol["HTTP"] = "http";
    CommunicationProtocol["WEBSOCKET"] = "websocket";
})(CommunicationProtocol || (exports.CommunicationProtocol = CommunicationProtocol = {}));
/**
 * Device location nested DTO
 */
class DeviceLocationDto {
}
exports.DeviceLocationDto = DeviceLocationDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Building must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Building name must not exceed 100 characters' }),
    __metadata("design:type", String)
], DeviceLocationDto.prototype, "building", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Floor must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Floor must not exceed 50 characters' }),
    __metadata("design:type", String)
], DeviceLocationDto.prototype, "floor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Room must be a string' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Room must not exceed 50 characters' }),
    __metadata("design:type", String)
], DeviceLocationDto.prototype, "room", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)({}, { message: 'Latitude must be a number' }),
    (0, class_validator_1.Min)(-90, { message: 'Latitude must be between -90 and 90' }),
    (0, class_validator_1.Max)(90, { message: 'Latitude must be between -90 and 90' }),
    __metadata("design:type", Number)
], DeviceLocationDto.prototype, "latitude", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)({}, { message: 'Longitude must be a number' }),
    (0, class_validator_1.Min)(-180, { message: 'Longitude must be between -180 and 180' }),
    (0, class_validator_1.Max)(180, { message: 'Longitude must be between -180 and 180' }),
    __metadata("design:type", Number)
], DeviceLocationDto.prototype, "longitude", void 0);
/**
 * Device configuration nested DTO
 */
class DeviceConfigurationDto {
}
exports.DeviceConfigurationDto = DeviceConfigurationDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIP)(undefined, { message: 'IP address format is invalid' }),
    __metadata("design:type", String)
], DeviceConfigurationDto.prototype, "ipAddress", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsPort)({ message: 'Port must be a valid port number' }),
    __metadata("design:type", Number)
], DeviceConfigurationDto.prototype, "port", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(CommunicationProtocol, {
        message: 'Protocol must be one of: modbus_tcp, modbus_rtu, mqtt, http, websocket'
    }),
    __metadata("design:type", String)
], DeviceConfigurationDto.prototype, "protocol", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)({}, { message: 'Polling interval must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Polling interval must be at least 1 second' }),
    (0, class_validator_1.Max)(3600, { message: 'Polling interval must not exceed 3600 seconds' }),
    __metadata("design:type", Number)
], DeviceConfigurationDto.prototype, "pollingInterval", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)({}, { message: 'Timeout must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Timeout must be at least 1 second' }),
    (0, class_validator_1.Max)(300, { message: 'Timeout must not exceed 300 seconds' }),
    __metadata("design:type", Number)
], DeviceConfigurationDto.prototype, "timeout", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)({ message: 'Additional settings must be an object' }),
    __metadata("design:type", Object)
], DeviceConfigurationDto.prototype, "additionalSettings", void 0);
/**
 * Enhanced create device DTO with comprehensive validation
 *
 * @example
 * ```json
 * {
 *   "name": "Temperature Sensor 01",
 *   "description": "Main hall temperature monitoring sensor",
 *   "deviceType": "sensor",
 *   "status": "active",
 *   "location": {
 *     "building": "Main Building",
 *     "floor": "1st Floor",
 *     "room": "Hall A"
 *   },
 *   "configuration": {
 *     "ipAddress": "192.168.1.100",
 *     "port": 502,
 *     "protocol": "modbus_tcp",
 *     "pollingInterval": 30
 *   },
 *   "capabilities": ["temperature", "humidity"],
 *   "tags": ["hvac", "monitoring"]
 * }
 * ```
 */
class CreateDeviceDto {
    constructor() {
        /**
         * Device status with enum validation
         */
        this.status = DeviceStatus.INACTIVE;
    }
}
exports.CreateDeviceDto = CreateDeviceDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Device name is required' }),
    (0, class_validator_1.IsString)({ message: 'Device name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Device name cannot be empty' }),
    (0, class_validator_1.MinLength)(2, { message: 'Device name must be at least 2 characters long' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Device name must not exceed 100 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], CreateDeviceDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Description must be a string' }),
    (0, class_validator_1.MaxLength)(500, { message: 'Description must not exceed 500 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], CreateDeviceDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Device type is required' }),
    (0, class_validator_1.IsEnum)(DeviceType, {
        message: 'Device type must be one of: sensor, actuator, controller, gateway, hybrid'
    }),
    __metadata("design:type", String)
], CreateDeviceDto.prototype, "deviceType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(DeviceStatus, {
        message: 'Status must be one of: active, inactive, maintenance, error, offline'
    }),
    __metadata("design:type", String)
], CreateDeviceDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)({ message: 'Location information is invalid' }),
    (0, class_transformer_1.Type)(() => DeviceLocationDto),
    __metadata("design:type", DeviceLocationDto)
], CreateDeviceDto.prototype, "location", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)({ message: 'Configuration is invalid' }),
    (0, class_transformer_1.Type)(() => DeviceConfigurationDto),
    (0, custom_validators_1.DeviceConfigValid)({ message: 'Device configuration is invalid for the specified device type' }),
    __metadata("design:type", DeviceConfigurationDto)
], CreateDeviceDto.prototype, "configuration", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Capabilities must be an array' }),
    (0, class_validator_1.IsString)({ each: true, message: 'Each capability must be a string' }),
    (0, custom_validators_1.ArrayUnique)({ message: 'Capabilities must be unique' }),
    (0, class_transformer_1.Transform)(({ value }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.trim() : v) : value),
    __metadata("design:type", Array)
], CreateDeviceDto.prototype, "capabilities", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Tags must be an array' }),
    (0, class_validator_1.IsString)({ each: true, message: 'Each tag must be a string' }),
    (0, custom_validators_1.ArrayUnique)({ message: 'Tags must be unique' }),
    (0, class_transformer_1.Transform)(({ value }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.trim().toLowerCase() : v) : value),
    __metadata("design:type", Array)
], CreateDeviceDto.prototype, "tags", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(4, { message: 'Customer ID must be a valid UUID' }),
    __metadata("design:type", String)
], CreateDeviceDto.prototype, "customerId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Serial number must be a string' }),
    (0, class_validator_1.Matches)(/^[A-Z0-9-]+$/, { message: 'Serial number can only contain uppercase letters, numbers, and hyphens' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Serial number must not exceed 50 characters' }),
    __metadata("design:type", String)
], CreateDeviceDto.prototype, "serialNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Manufacturer must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Manufacturer must not exceed 100 characters' }),
    __metadata("design:type", String)
], CreateDeviceDto.prototype, "manufacturer", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Model must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Model must not exceed 100 characters' }),
    __metadata("design:type", String)
], CreateDeviceDto.prototype, "model", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Firmware version must be a string' }),
    (0, class_validator_1.Matches)(/^\d+\.\d+\.\d+$/, { message: 'Firmware version must be in format x.y.z' }),
    __metadata("design:type", String)
], CreateDeviceDto.prototype, "firmwareVersion", void 0);
/**
 * Enhanced update device DTO with partial validation
 * All fields are optional for partial updates
 *
 * @example
 * ```json
 * {
 *   "name": "Updated Temperature Sensor 01",
 *   "status": "maintenance",
 *   "configuration": {
 *     "pollingInterval": 60
 *   }
 * }
 * ```
 */
class UpdateDeviceDto {
}
exports.UpdateDeviceDto = UpdateDeviceDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Device name must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Device name cannot be empty' }),
    (0, class_validator_1.MinLength)(2, { message: 'Device name must be at least 2 characters long' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Device name must not exceed 100 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], UpdateDeviceDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Description must be a string' }),
    (0, class_validator_1.MaxLength)(500, { message: 'Description must not exceed 500 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], UpdateDeviceDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(DeviceType, {
        message: 'Device type must be one of: sensor, actuator, controller, gateway, hybrid'
    }),
    __metadata("design:type", String)
], UpdateDeviceDto.prototype, "deviceType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(DeviceStatus, {
        message: 'Status must be one of: active, inactive, maintenance, error, offline'
    }),
    __metadata("design:type", String)
], UpdateDeviceDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)({ message: 'Location information is invalid' }),
    (0, class_transformer_1.Type)(() => DeviceLocationDto),
    __metadata("design:type", DeviceLocationDto)
], UpdateDeviceDto.prototype, "location", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)({ message: 'Configuration is invalid' }),
    (0, class_transformer_1.Type)(() => DeviceConfigurationDto),
    __metadata("design:type", DeviceConfigurationDto)
], UpdateDeviceDto.prototype, "configuration", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Capabilities must be an array' }),
    (0, class_validator_1.IsString)({ each: true, message: 'Each capability must be a string' }),
    (0, class_transformer_1.Transform)(({ value }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.trim() : v) : value),
    __metadata("design:type", Array)
], UpdateDeviceDto.prototype, "capabilities", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: 'Tags must be an array' }),
    (0, class_validator_1.IsString)({ each: true, message: 'Each tag must be a string' }),
    (0, class_transformer_1.Transform)(({ value }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.trim().toLowerCase() : v) : value),
    __metadata("design:type", Array)
], UpdateDeviceDto.prototype, "tags", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Serial number must be a string' }),
    (0, class_validator_1.Matches)(/^[A-Z0-9-]+$/, { message: 'Serial number can only contain uppercase letters, numbers, and hyphens' }),
    (0, class_validator_1.MaxLength)(50, { message: 'Serial number must not exceed 50 characters' }),
    __metadata("design:type", String)
], UpdateDeviceDto.prototype, "serialNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Manufacturer must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Manufacturer must not exceed 100 characters' }),
    __metadata("design:type", String)
], UpdateDeviceDto.prototype, "manufacturer", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Model must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Model must not exceed 100 characters' }),
    __metadata("design:type", String)
], UpdateDeviceDto.prototype, "model", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Firmware version must be a string' }),
    (0, class_validator_1.Matches)(/^\d+\.\d+\.\d+$/, { message: 'Firmware version must be in format x.y.z' }),
    __metadata("design:type", String)
], UpdateDeviceDto.prototype, "firmwareVersion", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)({}, { message: 'Last maintenance date must be a valid ISO date string' }),
    __metadata("design:type", String)
], UpdateDeviceDto.prototype, "lastMaintenanceDate", void 0);
/**
 * Enhanced device query DTO with comprehensive filtering and pagination
 *
 * @example
 * ```json
 * {
 *   "page": 1,
 *   "limit": 20,
 *   "search": "temperature",
 *   "status": ["active", "maintenance"],
 *   "deviceType": "sensor",
 *   "tags": ["hvac"],
 *   "sortBy": "name",
 *   "sortOrder": "ASC"
 * }
 * ```
 */
class DeviceQueryDto {
    constructor() {
        /**
         * Page number for pagination
         */
        this.page = 1;
        /**
         * Number of items per page
         */
        this.limit = 10;
        /**
         * Sort field
         */
        this.sortBy = 'name';
        /**
         * Sort order
         */
        this.sortOrder = 'ASC';
        /**
         * Include inactive devices in results
         */
        this.includeInactive = false;
    }
}
exports.DeviceQueryDto = DeviceQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Page must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Page must be at least 1' }),
    __metadata("design:type", Number)
], DeviceQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)({}, { message: 'Limit must be a number' }),
    (0, class_validator_1.Min)(1, { message: 'Limit must be at least 1' }),
    (0, class_validator_1.Max)(100, { message: 'Limit must not exceed 100' }),
    __metadata("design:type", Number)
], DeviceQueryDto.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Search term must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Search term must not exceed 100 characters' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' ? value.trim() : value),
    __metadata("design:type", String)
], DeviceQueryDto.prototype, "search", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return [value];
        }
        return Array.isArray(value) ? value : undefined;
    }),
    (0, class_validator_1.IsArray)({ message: 'Status filter must be an array' }),
    (0, class_validator_1.IsEnum)(DeviceStatus, {
        each: true,
        message: 'Each status must be one of: active, inactive, maintenance, error, offline'
    }),
    __metadata("design:type", Array)
], DeviceQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(DeviceType, {
        message: 'Device type must be one of: sensor, actuator, controller, gateway, hybrid'
    }),
    __metadata("design:type", String)
], DeviceQueryDto.prototype, "deviceType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(4, { message: 'Customer ID must be a valid UUID' }),
    __metadata("design:type", String)
], DeviceQueryDto.prototype, "customerId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return [value];
        }
        return Array.isArray(value) ? value : undefined;
    }),
    (0, class_validator_1.IsArray)({ message: 'Tags filter must be an array' }),
    (0, class_validator_1.IsString)({ each: true, message: 'Each tag must be a string' }),
    __metadata("design:type", Array)
], DeviceQueryDto.prototype, "tags", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return [value];
        }
        return Array.isArray(value) ? value : undefined;
    }),
    (0, class_validator_1.IsArray)({ message: 'Capabilities filter must be an array' }),
    (0, class_validator_1.IsString)({ each: true, message: 'Each capability must be a string' }),
    __metadata("design:type", Array)
], DeviceQueryDto.prototype, "capabilities", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Manufacturer must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Manufacturer must not exceed 100 characters' }),
    __metadata("design:type", String)
], DeviceQueryDto.prototype, "manufacturer", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: 'Building must be a string' }),
    (0, class_validator_1.MaxLength)(100, { message: 'Building must not exceed 100 characters' }),
    __metadata("design:type", String)
], DeviceQueryDto.prototype, "building", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['name', 'status', 'deviceType', 'createdAt', 'updatedAt'], {
        message: 'Sort field must be one of: name, status, deviceType, createdAt, updatedAt'
    }),
    __metadata("design:type", String)
], DeviceQueryDto.prototype, "sortBy", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['ASC', 'DESC'], { message: 'Sort order must be ASC or DESC' }),
    __metadata("design:type", String)
], DeviceQueryDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Boolean),
    (0, class_validator_1.IsBoolean)({ message: 'Include inactive must be a boolean' }),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    }),
    __metadata("design:type", Boolean)
], DeviceQueryDto.prototype, "includeInactive", void 0);
/**
 * Device parameter DTO for URL parameters
 */
class DeviceParamsDto {
}
exports.DeviceParamsDto = DeviceParamsDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Device ID is required' }),
    (0, class_validator_1.IsString)({ message: 'Device ID must be a string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Device ID cannot be empty' }),
    (0, class_validator_1.IsUUID)(4, { message: 'Device ID must be a valid UUID' }),
    __metadata("design:type", String)
], DeviceParamsDto.prototype, "id", void 0);
/**
 * Bulk device operation DTO
 *
 * @example
 * ```json
 * {
 *   "deviceIds": ["uuid1", "uuid2", "uuid3"],
 *   "operation": "activate",
 *   "parameters": {
 *     "reason": "Maintenance completed"
 *   }
 * }
 * ```
 */
class BulkDeviceOperationDto {
}
exports.BulkDeviceOperationDto = BulkDeviceOperationDto;
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Device IDs are required' }),
    (0, class_validator_1.IsArray)({ message: 'Device IDs must be an array' }),
    (0, class_validator_1.IsUUID)(4, { each: true, message: 'Each device ID must be a valid UUID' }),
    __metadata("design:type", Array)
], BulkDeviceOperationDto.prototype, "deviceIds", void 0);
__decorate([
    (0, class_validator_1.IsDefined)({ message: 'Operation is required' }),
    (0, class_validator_1.IsIn)(['activate', 'deactivate', 'maintenance', 'delete'], {
        message: 'Operation must be one of: activate, deactivate, maintenance, delete'
    }),
    __metadata("design:type", String)
], BulkDeviceOperationDto.prototype, "operation", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)({ message: 'Parameters must be an object' }),
    __metadata("design:type", Object)
], BulkDeviceOperationDto.prototype, "parameters", void 0);

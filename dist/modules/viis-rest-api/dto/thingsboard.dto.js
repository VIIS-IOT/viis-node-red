"use strict";
/**
 * @fileoverview ThingsBoard RPC DTOs for request/response validation
 * Uses class-validator decorators for automatic validation
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
exports.RpcExecutionResultDto = exports.TelemetryQueryDto = exports.MqttPublishOptionsDto = exports.DeviceStatusDto = exports.ThingsBoardRpcResponseDto = exports.CustomCommandRpcDto = exports.DeviceControlRpcDto = exports.SetTelemetryRpcDto = exports.TelemetryDataDto = exports.ThingsBoardRpcRequestDto = exports.BaseRpcRequestDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
/**
 * Base RPC request DTO with common validation
 */
class BaseRpcRequestDto {
    constructor() {
        this.timeout = 30000;
        this.persistent = false;
        this.retries = 3;
    }
}
exports.BaseRpcRequestDto = BaseRpcRequestDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Length)(1, 100),
    __metadata("design:type", String)
], BaseRpcRequestDto.prototype, "method", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1000),
    (0, class_validator_1.Max)(300000),
    __metadata("design:type", Number)
], BaseRpcRequestDto.prototype, "timeout", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], BaseRpcRequestDto.prototype, "persistent", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(10),
    __metadata("design:type", Number)
], BaseRpcRequestDto.prototype, "retries", void 0);
/**
 * ThingsBoard RPC request DTO with enhanced validation
 */
class ThingsBoardRpcRequestDto extends BaseRpcRequestDto {
    constructor() {
        super(...arguments);
        this.qos = 1;
        this.retain = false;
    }
}
exports.ThingsBoardRpcRequestDto = ThingsBoardRpcRequestDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    (0, class_transformer_1.Transform)(({ value }) => {
        // Sanitize and validate params object
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            }
            catch (_a) {
                return {};
            }
        }
        return value || {};
    }),
    __metadata("design:type", Object)
], ThingsBoardRpcRequestDto.prototype, "params", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 50),
    __metadata("design:type", String)
], ThingsBoardRpcRequestDto.prototype, "requestId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)([0, 1, 2]),
    __metadata("design:type", Number)
], ThingsBoardRpcRequestDto.prototype, "qos", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ThingsBoardRpcRequestDto.prototype, "retain", void 0);
/**
 * Telemetry data DTO for validation
 */
class TelemetryDataDto {
}
exports.TelemetryDataDto = TelemetryDataDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Length)(1, 100),
    __metadata("design:type", String)
], TelemetryDataDto.prototype, "key", void 0);
__decorate([
    (0, class_transformer_1.Transform)(({ value }) => {
        // Handle various value types
        if (value === null || value === undefined) {
            return null;
        }
        // Try to parse JSON strings
        if (typeof value === 'string') {
            // Check if it's a JSON string
            if ((value.startsWith('{') && value.endsWith('}')) ||
                (value.startsWith('[') && value.endsWith(']'))) {
                try {
                    return JSON.parse(value);
                }
                catch (_a) {
                    return value;
                }
            }
            // Check if it's a boolean string
            if (value.toLowerCase() === 'true')
                return true;
            if (value.toLowerCase() === 'false')
                return false;
            // Check if it's a number string
            const numValue = Number(value);
            if (!isNaN(numValue) && isFinite(numValue)) {
                return numValue;
            }
        }
        return value;
    }),
    __metadata("design:type", Object)
], TelemetryDataDto.prototype, "value", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], TelemetryDataDto.prototype, "timestamp", void 0);
/**
 * Set telemetry RPC request DTO
 */
class SetTelemetryRpcDto extends BaseRpcRequestDto {
}
exports.SetTelemetryRpcDto = SetTelemetryRpcDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['setTelemetry']),
    __metadata("design:type", String)
], SetTelemetryRpcDto.prototype, "method", void 0);
__decorate([
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => TelemetryDataDto),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (!value || typeof value !== 'object') {
            return {};
        }
        // Convert flat object to telemetry data format
        return Object.entries(value).map(([key, val]) => ({
            key,
            value: val,
            timestamp: Date.now()
        }));
    }),
    __metadata("design:type", Object)
], SetTelemetryRpcDto.prototype, "params", void 0);
/**
 * Device control RPC request DTO
 */
class DeviceControlRpcDto extends BaseRpcRequestDto {
}
exports.DeviceControlRpcDto = DeviceControlRpcDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['controlDevice']),
    __metadata("design:type", String)
], DeviceControlRpcDto.prototype, "method", void 0);
__decorate([
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], DeviceControlRpcDto.prototype, "params", void 0);
/**
 * Custom command RPC request DTO
 */
class CustomCommandRpcDto extends BaseRpcRequestDto {
}
exports.CustomCommandRpcDto = CustomCommandRpcDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CustomCommandRpcDto.prototype, "method", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], CustomCommandRpcDto.prototype, "params", void 0);
/**
 * RPC response DTO
 */
class ThingsBoardRpcResponseDto {
}
exports.ThingsBoardRpcResponseDto = ThingsBoardRpcResponseDto;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ThingsBoardRpcResponseDto.prototype, "success", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ThingsBoardRpcResponseDto.prototype, "result", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ThingsBoardRpcResponseDto.prototype, "error", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], ThingsBoardRpcResponseDto.prototype, "timestamp", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ThingsBoardRpcResponseDto.prototype, "deviceId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ThingsBoardRpcResponseDto.prototype, "method", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ThingsBoardRpcResponseDto.prototype, "processingTime", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ThingsBoardRpcResponseDto.prototype, "requestId", void 0);
/**
 * Device status DTO
 */
class DeviceStatusDto {
}
exports.DeviceStatusDto = DeviceStatusDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], DeviceStatusDto.prototype, "deviceId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['online', 'offline', 'unknown']),
    __metadata("design:type", String)
], DeviceStatusDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], DeviceStatusDto.prototype, "lastSeen", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], DeviceStatusDto.prototype, "attributes", void 0);
/**
 * MQTT publish options DTO
 */
class MqttPublishOptionsDto {
    constructor() {
        this.qos = 1;
        this.retain = false;
        this.timeout = 30000;
        this.retries = 3;
        this.retryDelay = 1000;
    }
}
exports.MqttPublishOptionsDto = MqttPublishOptionsDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)([0, 1, 2]),
    __metadata("design:type", Number)
], MqttPublishOptionsDto.prototype, "qos", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], MqttPublishOptionsDto.prototype, "retain", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1000),
    (0, class_validator_1.Max)(300000),
    __metadata("design:type", Number)
], MqttPublishOptionsDto.prototype, "timeout", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(10),
    __metadata("design:type", Number)
], MqttPublishOptionsDto.prototype, "retries", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(100),
    (0, class_validator_1.Max)(60000),
    __metadata("design:type", Number)
], MqttPublishOptionsDto.prototype, "retryDelay", void 0);
/**
 * Telemetry query DTO
 */
class TelemetryQueryDto {
    constructor() {
        this.limit = 100;
    }
}
exports.TelemetryQueryDto = TelemetryQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 100),
    __metadata("design:type", String)
], TelemetryQueryDto.prototype, "deviceId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], TelemetryQueryDto.prototype, "startTime", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], TelemetryQueryDto.prototype, "endTime", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TelemetryQueryDto.prototype, "keys", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(1000),
    __metadata("design:type", Number)
], TelemetryQueryDto.prototype, "limit", void 0);
/**
 * RPC execution result DTO
 */
class RpcExecutionResultDto {
}
exports.RpcExecutionResultDto = RpcExecutionResultDto;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RpcExecutionResultDto.prototype, "success", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], RpcExecutionResultDto.prototype, "deviceId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], RpcExecutionResultDto.prototype, "method", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], RpcExecutionResultDto.prototype, "telemetryRecordsCount", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RpcExecutionResultDto.prototype, "mqttPublished", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], RpcExecutionResultDto.prototype, "mqttTopic", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], RpcExecutionResultDto.prototype, "processingTime", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], RpcExecutionResultDto.prototype, "errors", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], RpcExecutionResultDto.prototype, "warnings", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RpcExecutionResultDto.prototype, "requestId", void 0);

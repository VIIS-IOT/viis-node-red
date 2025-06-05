/**
 * @fileoverview ThingsBoard RPC DTOs for request/response validation
 * Uses class-validator decorators for automatic validation
 */

import {
    IsString,
    IsOptional,
    IsObject,
    IsNumber,
    IsBoolean,
    IsEnum,
    IsNotEmpty,
    ValidateNested,
    Min,
    Max,
    Length,
    IsUUID,
    IsIn
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { RpcMethod, TelemetryValue } from '../types/thingsboard.types';

/**
 * Base RPC request DTO with common validation
 */
export class BaseRpcRequestDto {
    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    method: string;

    @IsOptional()
    @IsNumber()
    @Min(1000)
    @Max(300000)
    timeout?: number = 30000;

    @IsOptional()
    @IsBoolean()
    persistent?: boolean = false;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(10)
    retries?: number = 3;
}

/**
 * ThingsBoard RPC request DTO with enhanced validation
 */
export class ThingsBoardRpcRequestDto extends BaseRpcRequestDto {
    @IsOptional()
    @IsObject()
    @Transform(({ value }) => {
        // Sanitize and validate params object
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return {};
            }
        }
        return value || {};
    })
    params?: Record<string, any>;

    @IsOptional()
    @IsString()
    @Length(1, 50)
    requestId?: string;

    @IsOptional()
    @IsIn([0, 1, 2])
    qos?: 0 | 1 | 2 = 1;

    @IsOptional()
    @IsBoolean()
    retain?: boolean = false;
}

/**
 * Telemetry data DTO for validation
 */
export class TelemetryDataDto {
    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    key: string;

    @Transform(({ value }) => {
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
                } catch {
                    return value;
                }
            }
            
            // Check if it's a boolean string
            if (value.toLowerCase() === 'true') return true;
            if (value.toLowerCase() === 'false') return false;
            
            // Check if it's a number string
            const numValue = Number(value);
            if (!isNaN(numValue) && isFinite(numValue)) {
                return numValue;
            }
        }
        
        return value;
    })
    value: TelemetryValue;

    @IsOptional()
    @IsNumber()
    @Min(0)
    timestamp?: number;
}

/**
 * Set telemetry RPC request DTO
 */
export class SetTelemetryRpcDto extends BaseRpcRequestDto {
    @IsString()
    @IsIn(['setTelemetry'])
    method: 'setTelemetry';

    @IsObject()
    @ValidateNested({ each: true })
    @Type(() => TelemetryDataDto)
    @Transform(({ value }) => {
        if (!value || typeof value !== 'object') {
            return {};
        }
        
        // Convert flat object to telemetry data format
        return Object.entries(value).map(([key, val]) => ({
            key,
            value: val,
            timestamp: Date.now()
        }));
    })
    params: Record<string, any>;
}

/**
 * Device control RPC request DTO
 */
export class DeviceControlRpcDto extends BaseRpcRequestDto {
    @IsString()
    @IsIn(['controlDevice'])
    method: 'controlDevice';

    @IsObject()
    params: {
        command: string;
        parameters?: Record<string, any>;
    };
}

/**
 * Custom command RPC request DTO
 */
export class CustomCommandRpcDto extends BaseRpcRequestDto {
    @IsString()
    @IsNotEmpty()
    method: string;

    @IsOptional()
    @IsObject()
    params?: Record<string, any>;
}

/**
 * RPC response DTO
 */
export class ThingsBoardRpcResponseDto {
    @IsBoolean()
    success: boolean;

    @IsOptional()
    result?: any;

    @IsOptional()
    @IsString()
    error?: string;

    @IsNumber()
    timestamp: number;

    @IsString()
    @IsNotEmpty()
    deviceId: string;

    @IsString()
    @IsNotEmpty()
    method: string;

    @IsNumber()
    @Min(0)
    processingTime: number;

    @IsOptional()
    @IsString()
    requestId?: string;
}

/**
 * Device status DTO
 */
export class DeviceStatusDto {
    @IsString()
    @IsNotEmpty()
    deviceId: string;

    @IsString()
    @IsIn(['online', 'offline', 'unknown'])
    status: 'online' | 'offline' | 'unknown';

    @IsNumber()
    @Min(0)
    lastSeen: number;

    @IsOptional()
    @IsObject()
    attributes?: Record<string, any>;
}

/**
 * MQTT publish options DTO
 */
export class MqttPublishOptionsDto {
    @IsOptional()
    @IsIn([0, 1, 2])
    qos?: 0 | 1 | 2 = 1;

    @IsOptional()
    @IsBoolean()
    retain?: boolean = false;

    @IsOptional()
    @IsNumber()
    @Min(1000)
    @Max(300000)
    timeout?: number = 30000;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(10)
    retries?: number = 3;

    @IsOptional()
    @IsNumber()
    @Min(100)
    @Max(60000)
    retryDelay?: number = 1000;
}

/**
 * Telemetry query DTO
 */
export class TelemetryQueryDto {
    @IsOptional()
    @IsString()
    @Length(1, 100)
    deviceId?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    startTime?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    endTime?: number;

    @IsOptional()
    @IsString()
    keys?: string;

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(1000)
    limit?: number = 100;
}

/**
 * RPC execution result DTO
 */
export class RpcExecutionResultDto {
    @IsBoolean()
    success: boolean;

    @IsString()
    @IsNotEmpty()
    deviceId: string;

    @IsString()
    @IsNotEmpty()
    method: string;

    @IsNumber()
    @Min(0)
    telemetryRecordsCount: number;

    @IsBoolean()
    mqttPublished: boolean;

    @IsString()
    @IsNotEmpty()
    mqttTopic: string;

    @IsNumber()
    @Min(0)
    processingTime: number;

    @IsOptional()
    errors?: string[];

    @IsOptional()
    warnings?: string[];

    @IsOptional()
    @IsString()
    requestId?: string;
}

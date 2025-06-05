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

import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEnum,
    IsIn,
    ValidateNested,
    IsArray,
    IsBoolean,
    IsNumber,
    IsUUID,
    IsDefined,
    Min,
    Max,
    IsDateString,
    Matches,
    IsObject,
    IsIP,
    IsPort,
    IsUrl,
    MaxLength,
    MinLength
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { DeviceConfigValid, ArrayUnique, ConditionalRequired } from '../validators/custom.validators';

/**
 * Device status enumeration
 */
export enum DeviceStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    MAINTENANCE = 'maintenance',
    ERROR = 'error',
    OFFLINE = 'offline'
}

/**
 * Device type enumeration
 */
export enum DeviceType {
    SENSOR = 'sensor',
    ACTUATOR = 'actuator',
    CONTROLLER = 'controller',
    GATEWAY = 'gateway',
    HYBRID = 'hybrid'
}

/**
 * Communication protocol enumeration
 */
export enum CommunicationProtocol {
    MODBUS_TCP = 'modbus_tcp',
    MODBUS_RTU = 'modbus_rtu',
    MQTT = 'mqtt',
    HTTP = 'http',
    WEBSOCKET = 'websocket'
}

/**
 * Device location nested DTO
 */
export class DeviceLocationDto {
    @IsOptional()
    @IsString({ message: 'Building must be a string' })
    @MaxLength(100, { message: 'Building name must not exceed 100 characters' })
    building?: string;

    @IsOptional()
    @IsString({ message: 'Floor must be a string' })
    @MaxLength(50, { message: 'Floor must not exceed 50 characters' })
    floor?: string;

    @IsOptional()
    @IsString({ message: 'Room must be a string' })
    @MaxLength(50, { message: 'Room must not exceed 50 characters' })
    room?: string;

    @IsOptional()
    @IsNumber({}, { message: 'Latitude must be a number' })
    @Min(-90, { message: 'Latitude must be between -90 and 90' })
    @Max(90, { message: 'Latitude must be between -90 and 90' })
    latitude?: number;

    @IsOptional()
    @IsNumber({}, { message: 'Longitude must be a number' })
    @Min(-180, { message: 'Longitude must be between -180 and 180' })
    @Max(180, { message: 'Longitude must be between -180 and 180' })
    longitude?: number;
}

/**
 * Device configuration nested DTO
 */
export class DeviceConfigurationDto {
    @IsOptional()
    @IsIP(undefined, { message: 'IP address format is invalid' })
    ipAddress?: string;

    @IsOptional()
    @IsPort({ message: 'Port must be a valid port number' })
    port?: number;

    @IsOptional()
    @IsEnum(CommunicationProtocol, {
        message: 'Protocol must be one of: modbus_tcp, modbus_rtu, mqtt, http, websocket'
    })
    protocol?: CommunicationProtocol;

    @IsOptional()
    @IsNumber({}, { message: 'Polling interval must be a number' })
    @Min(1, { message: 'Polling interval must be at least 1 second' })
    @Max(3600, { message: 'Polling interval must not exceed 3600 seconds' })
    pollingInterval?: number;

    @IsOptional()
    @IsNumber({}, { message: 'Timeout must be a number' })
    @Min(1, { message: 'Timeout must be at least 1 second' })
    @Max(300, { message: 'Timeout must not exceed 300 seconds' })
    timeout?: number;

    @IsOptional()
    @IsObject({ message: 'Additional settings must be an object' })
    additionalSettings?: Record<string, any>;
}

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
export class CreateDeviceDto {
    /**
     * Device name with validation
     */
    @IsDefined({ message: 'Device name is required' })
    @IsString({ message: 'Device name must be a string' })
    @IsNotEmpty({ message: 'Device name cannot be empty' })
    @MinLength(2, { message: 'Device name must be at least 2 characters long' })
    @MaxLength(100, { message: 'Device name must not exceed 100 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    name: string;

    /**
     * Device description
     */
    @IsOptional()
    @IsString({ message: 'Description must be a string' })
    @MaxLength(500, { message: 'Description must not exceed 500 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    description?: string;

    /**
     * Device type with enum validation
     */
    @IsDefined({ message: 'Device type is required' })
    @IsEnum(DeviceType, {
        message: 'Device type must be one of: sensor, actuator, controller, gateway, hybrid'
    })
    deviceType: DeviceType;

    /**
     * Device status with enum validation
     */
    @IsOptional()
    @IsEnum(DeviceStatus, {
        message: 'Status must be one of: active, inactive, maintenance, error, offline'
    })
    status?: DeviceStatus = DeviceStatus.INACTIVE;

    /**
     * Device location (nested validation)
     */
    @IsOptional()
    @ValidateNested({ message: 'Location information is invalid' })
    @Type(() => DeviceLocationDto)
    location?: DeviceLocationDto;

    /**
     * Device configuration (nested validation with custom business rules)
     */
    @IsOptional()
    @ValidateNested({ message: 'Configuration is invalid' })
    @Type(() => DeviceConfigurationDto)
    @DeviceConfigValid({ message: 'Device configuration is invalid for the specified device type' })
    configuration?: DeviceConfigurationDto;

    /**
     * Device capabilities array with unique validation
     */
    @IsOptional()
    @IsArray({ message: 'Capabilities must be an array' })
    @IsString({ each: true, message: 'Each capability must be a string' })
    @ArrayUnique({ message: 'Capabilities must be unique' })
    @Transform(({ value }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.trim() : v) : value)
    capabilities?: string[];

    /**
     * Device tags for categorization with unique validation
     */
    @IsOptional()
    @IsArray({ message: 'Tags must be an array' })
    @IsString({ each: true, message: 'Each tag must be a string' })
    @ArrayUnique({ message: 'Tags must be unique' })
    @Transform(({ value }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.trim().toLowerCase() : v) : value)
    tags?: string[];

    /**
     * Customer ID for organization assignment
     */
    @IsOptional()
    @IsUUID(4, { message: 'Customer ID must be a valid UUID' })
    customerId?: string;

    /**
     * Serial number with format validation
     */
    @IsOptional()
    @IsString({ message: 'Serial number must be a string' })
    @Matches(/^[A-Z0-9-]+$/, { message: 'Serial number can only contain uppercase letters, numbers, and hyphens' })
    @MaxLength(50, { message: 'Serial number must not exceed 50 characters' })
    serialNumber?: string;

    /**
     * Manufacturer information
     */
    @IsOptional()
    @IsString({ message: 'Manufacturer must be a string' })
    @MaxLength(100, { message: 'Manufacturer must not exceed 100 characters' })
    manufacturer?: string;

    /**
     * Model information
     */
    @IsOptional()
    @IsString({ message: 'Model must be a string' })
    @MaxLength(100, { message: 'Model must not exceed 100 characters' })
    model?: string;

    /**
     * Firmware version
     */
    @IsOptional()
    @IsString({ message: 'Firmware version must be a string' })
    @Matches(/^\d+\.\d+\.\d+$/, { message: 'Firmware version must be in format x.y.z' })
    firmwareVersion?: string;
}

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
export class UpdateDeviceDto {
    /**
     * Updated device name
     */
    @IsOptional()
    @IsString({ message: 'Device name must be a string' })
    @IsNotEmpty({ message: 'Device name cannot be empty' })
    @MinLength(2, { message: 'Device name must be at least 2 characters long' })
    @MaxLength(100, { message: 'Device name must not exceed 100 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    name?: string;

    /**
     * Updated device description
     */
    @IsOptional()
    @IsString({ message: 'Description must be a string' })
    @MaxLength(500, { message: 'Description must not exceed 500 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    description?: string;

    /**
     * Updated device type
     */
    @IsOptional()
    @IsEnum(DeviceType, {
        message: 'Device type must be one of: sensor, actuator, controller, gateway, hybrid'
    })
    deviceType?: DeviceType;

    /**
     * Updated device status
     */
    @IsOptional()
    @IsEnum(DeviceStatus, {
        message: 'Status must be one of: active, inactive, maintenance, error, offline'
    })
    status?: DeviceStatus;

    /**
     * Updated device location
     */
    @IsOptional()
    @ValidateNested({ message: 'Location information is invalid' })
    @Type(() => DeviceLocationDto)
    location?: DeviceLocationDto;

    /**
     * Updated device configuration
     */
    @IsOptional()
    @ValidateNested({ message: 'Configuration is invalid' })
    @Type(() => DeviceConfigurationDto)
    configuration?: DeviceConfigurationDto;

    /**
     * Updated device capabilities
     */
    @IsOptional()
    @IsArray({ message: 'Capabilities must be an array' })
    @IsString({ each: true, message: 'Each capability must be a string' })
    @Transform(({ value }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.trim() : v) : value)
    capabilities?: string[];

    /**
     * Updated device tags
     */
    @IsOptional()
    @IsArray({ message: 'Tags must be an array' })
    @IsString({ each: true, message: 'Each tag must be a string' })
    @Transform(({ value }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.trim().toLowerCase() : v) : value)
    tags?: string[];

    /**
     * Updated serial number
     */
    @IsOptional()
    @IsString({ message: 'Serial number must be a string' })
    @Matches(/^[A-Z0-9-]+$/, { message: 'Serial number can only contain uppercase letters, numbers, and hyphens' })
    @MaxLength(50, { message: 'Serial number must not exceed 50 characters' })
    serialNumber?: string;

    /**
     * Updated manufacturer
     */
    @IsOptional()
    @IsString({ message: 'Manufacturer must be a string' })
    @MaxLength(100, { message: 'Manufacturer must not exceed 100 characters' })
    manufacturer?: string;

    /**
     * Updated model
     */
    @IsOptional()
    @IsString({ message: 'Model must be a string' })
    @MaxLength(100, { message: 'Model must not exceed 100 characters' })
    model?: string;

    /**
     * Updated firmware version
     */
    @IsOptional()
    @IsString({ message: 'Firmware version must be a string' })
    @Matches(/^\d+\.\d+\.\d+$/, { message: 'Firmware version must be in format x.y.z' })
    firmwareVersion?: string;

    /**
     * Last maintenance date
     */
    @IsOptional()
    @IsDateString({}, { message: 'Last maintenance date must be a valid ISO date string' })
    lastMaintenanceDate?: string;
}

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
export class DeviceQueryDto {
    /**
     * Page number for pagination
     */
    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Page must be a number' })
    @Min(1, { message: 'Page must be at least 1' })
    page?: number = 1;

    /**
     * Number of items per page
     */
    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Limit must be a number' })
    @Min(1, { message: 'Limit must be at least 1' })
    @Max(100, { message: 'Limit must not exceed 100' })
    limit?: number = 10;

    /**
     * Search term for device name, description, or serial number
     */
    @IsOptional()
    @IsString({ message: 'Search term must be a string' })
    @MaxLength(100, { message: 'Search term must not exceed 100 characters' })
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    search?: string;

    /**
     * Filter by device status (supports multiple values)
     */
    @IsOptional()
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return [value];
        }
        return Array.isArray(value) ? value : undefined;
    })
    @IsArray({ message: 'Status filter must be an array' })
    @IsEnum(DeviceStatus, {
        each: true,
        message: 'Each status must be one of: active, inactive, maintenance, error, offline'
    })
    status?: DeviceStatus[];

    /**
     * Filter by device type
     */
    @IsOptional()
    @IsEnum(DeviceType, {
        message: 'Device type must be one of: sensor, actuator, controller, gateway, hybrid'
    })
    deviceType?: DeviceType;

    /**
     * Filter by customer ID
     */
    @IsOptional()
    @IsUUID(4, { message: 'Customer ID must be a valid UUID' })
    customerId?: string;

    /**
     * Filter by tags (supports multiple values)
     */
    @IsOptional()
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return [value];
        }
        return Array.isArray(value) ? value : undefined;
    })
    @IsArray({ message: 'Tags filter must be an array' })
    @IsString({ each: true, message: 'Each tag must be a string' })
    tags?: string[];

    /**
     * Filter by capabilities (supports multiple values)
     */
    @IsOptional()
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return [value];
        }
        return Array.isArray(value) ? value : undefined;
    })
    @IsArray({ message: 'Capabilities filter must be an array' })
    @IsString({ each: true, message: 'Each capability must be a string' })
    capabilities?: string[];

    /**
     * Filter by manufacturer
     */
    @IsOptional()
    @IsString({ message: 'Manufacturer must be a string' })
    @MaxLength(100, { message: 'Manufacturer must not exceed 100 characters' })
    manufacturer?: string;

    /**
     * Filter by location building
     */
    @IsOptional()
    @IsString({ message: 'Building must be a string' })
    @MaxLength(100, { message: 'Building must not exceed 100 characters' })
    building?: string;

    /**
     * Sort field
     */
    @IsOptional()
    @IsIn(['name', 'status', 'deviceType', 'createdAt', 'updatedAt'], {
        message: 'Sort field must be one of: name, status, deviceType, createdAt, updatedAt'
    })
    sortBy?: string = 'name';

    /**
     * Sort order
     */
    @IsOptional()
    @IsIn(['ASC', 'DESC'], { message: 'Sort order must be ASC or DESC' })
    sortOrder?: 'ASC' | 'DESC' = 'ASC';

    /**
     * Include inactive devices in results
     */
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean({ message: 'Include inactive must be a boolean' })
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return Boolean(value);
    })
    includeInactive?: boolean = false;
}

/**
 * Device parameter DTO for URL parameters
 */
export class DeviceParamsDto {
    /**
     * Device ID parameter
     */
    @IsDefined({ message: 'Device ID is required' })
    @IsString({ message: 'Device ID must be a string' })
    @IsNotEmpty({ message: 'Device ID cannot be empty' })
    @IsUUID(4, { message: 'Device ID must be a valid UUID' })
    id: string;
}

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
export class BulkDeviceOperationDto {
    /**
     * Array of device IDs to operate on
     */
    @IsDefined({ message: 'Device IDs are required' })
    @IsArray({ message: 'Device IDs must be an array' })
    @IsUUID(4, { each: true, message: 'Each device ID must be a valid UUID' })
    deviceIds: string[];

    /**
     * Operation to perform
     */
    @IsDefined({ message: 'Operation is required' })
    @IsIn(['activate', 'deactivate', 'maintenance', 'delete'], {
        message: 'Operation must be one of: activate, deactivate, maintenance, delete'
    })
    operation: string;

    /**
     * Optional parameters for the operation
     */
    @IsOptional()
    @IsObject({ message: 'Parameters must be an object' })
    parameters?: Record<string, any>;
}
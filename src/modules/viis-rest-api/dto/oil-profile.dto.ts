/**
 * @fileoverview Oil Profile DTOs for Marine IoT System
 * 
 * Provides validation DTOs for oil profile management operations:
 * - Create oil profile (BO/DO with density and temperature)
 * - Update oil profile
 * - Activate/deactivate profiles
 * - Query profiles with filters
 */

import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEnum,
    IsBoolean,
    IsNumber,
    Min,
    Max,
    MaxLength,
    MinLength,
    IsUUID
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Oil type enumeration
 */
export enum OilType {
    BO = 'BO',  // Bunker Oil
    DO = 'DO'   // Diesel Oil
}

/**
 * DTO for creating a new oil profile
 */
export class CreateOilProfileDto {
    @IsOptional()
    @IsString()
    @MinLength(3)
    @MaxLength(255)
    name?: string;  // Auto-generated if not provided

    @IsNotEmpty({ message: 'device_id is required' })
    @IsString()
    @MaxLength(255)
    device_id!: string;

    @IsNotEmpty({ message: 'oil_type is required' })
    @IsEnum(OilType, { message: 'oil_type must be either BO or DO' })
    oil_type!: OilType;

    @IsNotEmpty({ message: 'operating_temperature is required' })
    @IsNumber({}, { message: 'operating_temperature must be a number' })
    @Min(-50, { message: 'operating_temperature must be at least -50°C' })
    @Max(200, { message: 'operating_temperature must not exceed 200°C' })
    operating_temperature!: number;

    @IsNotEmpty({ message: 'density is required' })
    @IsNumber({}, { message: 'density must be a number' })
    @Min(500, { message: 'density must be at least 500 kg/m³' })
    @Max(2000, { message: 'density must not exceed 2000 kg/m³' })
    density!: number;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    label?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === true || value === 'true' || value === 1)
    is_active?: boolean;
}

/**
 * DTO for updating an existing oil profile
 */
export class UpdateOilProfileDto {
    @IsOptional()
    @IsEnum(OilType, { message: 'oil_type must be either BO or DO' })
    oil_type?: OilType;

    @IsOptional()
    @IsNumber({}, { message: 'operating_temperature must be a number' })
    @Min(-50, { message: 'operating_temperature must be at least -50°C' })
    @Max(200, { message: 'operating_temperature must not exceed 200°C' })
    operating_temperature?: number;

    @IsOptional()
    @IsNumber({}, { message: 'density must be a number' })
    @Min(500, { message: 'density must be at least 500 kg/m³' })
    @Max(2000, { message: 'density must not exceed 2000 kg/m³' })
    density?: number;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    label?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === true || value === 'true' || value === 1)
    is_active?: boolean;
}

/**
 * DTO for activating a profile
 */
export class ActivateProfileDto {
    @IsNotEmpty({ message: 'profile_name is required' })
    @IsString()
    @MaxLength(255)
    profile_name!: string;
}

/**
 * DTO for querying profiles
 */
export class QueryOilProfileDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    device_id?: string;

    @IsOptional()
    @IsEnum(OilType)
    oil_type?: OilType;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === true || value === 'true' || value === 1)
    is_active?: boolean;

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(100)
    @Transform(({ value }) => parseInt(value, 10))
    limit?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Transform(({ value }) => parseInt(value, 10))
    offset?: number;
}

/**
 * Oil profile response DTO
 */
export interface OilProfileResponseDto {
    name: string;
    device_id: string;
    oil_type: OilType;
    operating_temperature: number;
    density: number;
    label?: string;
    description?: string;
    is_active: boolean;
    creation?: Date;
    modified?: Date;
}

/**
 * Paginated oil profiles response
 */
export interface OilProfileListResponseDto {
    profiles: OilProfileResponseDto[];
    total: number;
    limit: number;
    offset: number;
}

/**
 * @fileoverview Trip Management DTOs
 * 
 * DTOs for trip/voyage management endpoints
 */

import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';

/**
 * Request to start a new trip
 */
export class StartTripDto {
    @IsString()
    device_id!: string;

    @IsOptional()
    @IsString()
    trip_name?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

/**
 * Request to end a trip
 */
export class EndTripDto {
    @IsString()
    trip_id!: string;
}

/**
 * Request to cancel a trip
 */
export class CancelTripDto {
    @IsString()
    trip_id!: string;

    @IsOptional()
    @IsString()
    reason?: string;
}

/**
 * Trip status type (matches entity type)
 */
export type TripStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

/**
 * Query parameters for trip history
 */
export class TripHistoryQueryDto {
    @IsOptional()
    @IsNumber()
    limit?: number;

    @IsOptional()
    @IsString()
    status?: TripStatus;
}

/**
 * Trip response DTO
 */
export interface TripResponseDto {
    id: string;
    device_id: string;
    trip_name: string | null;
    start_time: number;
    end_time: number | null;
    status: TripStatus;
    notes: string | null;
    created_at: string;
    updated_at: string | null;
}

/**
 * Trip with statistics response
 */
export interface TripWithStatsResponseDto extends TripResponseDto {
    total_consumption_m3: number;
    total_consumption_tons: number;
    duration_hours: number;
}

/**
 * Sensor accumulation data
 */
export interface SensorAccumulationDto {
    sensor_key: string;
    total_volume_m3: number;
    total_volume_tons: number;
    oil_profile_id: string | null;
    current_density: number | null;
    last_update_time: number | null;
    sample_count: number;
}

/**
 * Trip accumulation response
 */
export interface TripAccumulationResponseDto {
    trip_id: string;
    device_id: string;
    sensors: SensorAccumulationDto[];
    total_consumption: {
        m3: number;
        tons: number;
    };
}

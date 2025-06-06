/**
 * @fileoverview IoT Schedule Log DTOs for validation and transformation
 */

import {
    IsOptional,
    IsString,
    IsNumber,
    IsDate,
    MinLength,
    MaxLength,
    IsNotEmpty,
    IsDefined,
    Min,
    Max,
    IsDateString
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Query parameters for listing IoT schedule logs
 */
export class IotScheduleLogQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Page must be a number' })
    @Min(1, { message: 'Page must be at least 1' })
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Size must be a number' })
    @Min(1, { message: 'Size must be at least 1' })
    @Max(100, { message: 'Size must not exceed 100' })
    size?: number = 100;

    @IsOptional()
    @IsString({ message: 'Order by must be a string' })
    order_by?: string;

    @IsOptional()
    @IsString({ message: 'Filters must be a string' })
    filters?: string;

    @IsOptional()
    @IsString({ message: 'Search term must be a string' })
    @MaxLength(100, { message: 'Search term must not exceed 100 characters' })
    search?: string;

    @IsOptional()
    @IsString({ message: 'Schedule ID must be a string' })
    schedule_id?: string;

    @IsOptional()
    @IsString({ message: 'Customer user must be a string' })
    customer_user?: string;

    @IsOptional()
    @IsString({ message: 'Start time must be a string' })
    start_time?: string;

    @IsOptional()
    @IsString({ message: 'End time must be a string' })
    end_time?: string;

    @IsOptional()
    @IsDateString({}, { message: 'Start date must be a valid date string' })
    start_date?: string;

    @IsOptional()
    @IsDateString({}, { message: 'End date must be a valid date string' })
    end_date?: string;
}

/**
 * DTO for creating a new IoT schedule log
 */
export class CreateIotScheduleLogDto {
    @IsDefined({ message: 'Name is required' })
    @IsString({ message: 'Name must be a string' })
    @IsNotEmpty({ message: 'Name cannot be empty' })
    @MinLength(3, { message: 'Name must be at least 3 characters long' })
    @MaxLength(255, { message: 'Name must not exceed 255 characters' })
    name: string;

    @IsOptional()
    @IsString({ message: 'Start time must be a string' })
    start_time?: string;

    @IsOptional()
    @IsString({ message: 'End time must be a string' })
    end_time?: string;

    @IsOptional()
    @IsString({ message: 'Schedule ID must be a string' })
    @MaxLength(255, { message: 'Schedule ID must not exceed 255 characters' })
    schedule_id?: string;

    @IsOptional()
    @IsString({ message: 'Customer user must be a string' })
    @MaxLength(255, { message: 'Customer user must not exceed 255 characters' })
    customer_user?: string;
}

/**
 * DTO for updating an existing IoT schedule log
 */
export class UpdateIotScheduleLogDto {
    @IsOptional()
    @IsString({ message: 'Start time must be a string' })
    start_time?: string;

    @IsOptional()
    @IsString({ message: 'End time must be a string' })
    end_time?: string;

    @IsOptional()
    @IsString({ message: 'Schedule ID must be a string' })
    @MaxLength(255, { message: 'Schedule ID must not exceed 255 characters' })
    schedule_id?: string;

    @IsOptional()
    @IsString({ message: 'Customer user must be a string' })
    @MaxLength(255, { message: 'Customer user must not exceed 255 characters' })
    customer_user?: string;
}

/**
 * DTO for IoT schedule log path parameters
 */
export class IotScheduleLogParamsDto {
    @IsDefined({ message: 'Schedule log name is required' })
    @IsString({ message: 'Schedule log name must be a string' })
    @IsNotEmpty({ message: 'Schedule log name cannot be empty' })
    name: string;
}

/**
 * Response DTO for schedule log with telemetry data
 */
export class ScheduleLogWithTelemetryDto {
    name?: string;
    start_time?: string;
    end_time?: string;
    schedule_id?: string;
    customer_user?: string;
    schedule?: {
        name?: string;
        device_id?: string;
        label?: string;
        action?: string;
        enable?: number;
    };
    telemetry?: Array<{
        device_id?: string;
        timestamp?: Date;
        data?: any;
        [key: string]: any;
    }>;
}

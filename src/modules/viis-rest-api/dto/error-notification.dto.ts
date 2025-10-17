/**
 * @fileoverview DTOs for Error Notification endpoints
 */

import { IsOptional, IsString, IsNumber, IsBoolean, Min, Max, IsIn } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Query parameters for error notification listing
 */
export class ErrorNotificationQueryDto {
    @IsOptional()
    @IsString()
    err_code?: string;

    @IsOptional()
    @IsString()
    @IsIn(['low', 'medium', 'high', 'critical'])
    severity?: string;

    @IsOptional()
    @IsString()
    @IsIn(['info', 'warning', 'error', 'alert'])
    type?: string;

    @IsOptional()
    @IsString()
    entity?: string;

    @IsOptional()
    @Transform(({ value }) => value === 'true' || value === true || value === 1 || value === '1')
    @IsBoolean()
    is_read?: boolean;

    @IsOptional()
    @IsString()
    board_id?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(100)
    size?: number = 20;

    @IsOptional()
    @IsString()
    sortBy?: string = 'created_at';

    @IsOptional()
    @IsString()
    @IsIn(['ASC', 'DESC', 'asc', 'desc'])
    sortOrder?: string = 'DESC';
}

/**
 * DTO for creating error notification manually
 */
export class CreateErrorNotificationDto {
    @IsString()
    err_code!: string;

    @IsString()
    message!: string;

    @IsString()
    @IsIn(['low', 'medium', 'high', 'critical'])
    severity!: string;

    @IsString()
    @IsIn(['info', 'warning', 'error', 'alert'])
    type!: string;

    @IsString()
    entity!: string;

    @IsOptional()
    @IsString()
    entity_label?: string;

    @IsOptional()
    metadata?: Record<string, any>;
}

/**
 * DTO for updating error notification
 */
export class UpdateErrorNotificationDto {
    @IsOptional()
    @IsString()
    message?: string;

    @IsOptional()
    @Transform(({ value }) => value === 'true' || value === true || value === 1 || value === '1')
    @IsBoolean()
    is_read?: boolean;

    @IsOptional()
    metadata?: Record<string, any>;
}

/**
 * DTO for bulk resolve notifications
 */
export class BulkResolveDto {
    @IsOptional()
    @IsString()
    err_code?: string;

    @IsOptional()
    @IsString()
    entity?: string;

    @IsOptional()
    @IsString()
    board_id?: string;
}

/**
 * @fileoverview IoT Notification DTOs for validation and transformation
 */

import {
    IsOptional,
    IsString,
    IsNumber,
    IsBoolean,
    IsDate,
    MinLength,
    MaxLength,
    IsNotEmpty,
    IsDefined,
    Min,
    Max,
    IsEnum
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Enum for notification severity levels
 */
export enum NotificationSeverity {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical'
}

/**
 * Enum for notification types
 */
export enum NotificationType {
    ALERT = 'alert',
    WARNING = 'warning',
    INFO = 'info',
    ERROR = 'error'
}

/**
 * Query parameters for listing IoT notifications
 */
export class IotNotificationQueryDto {
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
    size?: number = 10;

    @IsOptional()
    @IsString({ message: 'Order by must be a string' })
    order_by?: string;

    @IsOptional()
    @IsString({ message: 'Filters must be a string' })
    filters?: string;

    @IsOptional()
    @IsString({ message: 'OR filters must be a string' })
    or_filters?: string;

    @IsOptional()
    @IsString({ message: 'Search term must be a string' })
    @MaxLength(100, { message: 'Search term must not exceed 100 characters' })
    search?: string;

    @IsOptional()
    @IsString({ message: 'Customer user must be a string' })
    customer_user?: string;

    @IsOptional()
    @IsString({ message: 'Customer ID must be a string' })
    customer_id?: string;

    @IsOptional()
    @IsEnum(NotificationType, { message: 'Invalid notification type' })
    type?: NotificationType;

    @IsOptional()
    @IsEnum(NotificationSeverity, { message: 'Invalid notification severity' })
    severity?: NotificationSeverity;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean({ message: 'Is read must be a boolean' })
    is_read?: boolean;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean({ message: 'Is sent must be a boolean' })
    is_sent?: boolean;
}

/**
 * DTO for creating a new IoT notification
 */
export class CreateIotNotificationDto {
    @IsDefined({ message: 'Name is required' })
    @IsString({ message: 'Name must be a string' })
    @IsNotEmpty({ message: 'Name cannot be empty' })
    @MinLength(3, { message: 'Name must be at least 3 characters long' })
    @MaxLength(140, { message: 'Name must not exceed 140 characters' })
    name: string;

    @IsOptional()
    @IsString({ message: 'Customer user must be a string' })
    @MaxLength(140, { message: 'Customer user must not exceed 140 characters' })
    customer_user?: string;

    @IsOptional()
    @IsString({ message: 'Message must be a string' })
    message?: string;

    @IsOptional()
    @IsString({ message: 'Entity must be a string' })
    @MaxLength(140, { message: 'Entity must not exceed 140 characters' })
    entity?: string;

    @IsOptional()
    @IsEnum(NotificationType, { message: 'Invalid notification type' })
    type?: NotificationType;

    @IsOptional()
    @IsString({ message: 'Customer ID must be a string' })
    @MaxLength(140, { message: 'Customer ID must not exceed 140 characters' })
    customer_id?: string;

    @IsOptional()
    @IsString({ message: 'Error code must be a string' })
    @MaxLength(140, { message: 'Error code must not exceed 140 characters' })
    err_code?: string;

    @IsOptional()
    @IsString({ message: 'Entity label must be a string' })
    @MaxLength(140, { message: 'Entity label must not exceed 140 characters' })
    entity_label?: string;

    @IsOptional()
    @IsEnum(NotificationSeverity, { message: 'Invalid notification severity' })
    severity?: NotificationSeverity;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Is read must be a number (0 or 1)' })
    @Min(0, { message: 'Is read must be 0 or 1' })
    @Max(1, { message: 'Is read must be 0 or 1' })
    is_read?: number = 0;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Is sent must be a number (0 or 1)' })
    @Min(0, { message: 'Is sent must be 0 or 1' })
    @Max(1, { message: 'Is sent must be 0 or 1' })
    is_sent?: number = 0;
}

/**
 * DTO for updating an existing IoT notification
 */
export class UpdateIotNotificationDto {
    @IsOptional()
    @IsString({ message: 'Customer user must be a string' })
    @MaxLength(140, { message: 'Customer user must not exceed 140 characters' })
    customer_user?: string;

    @IsOptional()
    @IsString({ message: 'Message must be a string' })
    message?: string;

    @IsOptional()
    @IsString({ message: 'Entity must be a string' })
    @MaxLength(140, { message: 'Entity must not exceed 140 characters' })
    entity?: string;

    @IsOptional()
    @IsEnum(NotificationType, { message: 'Invalid notification type' })
    type?: NotificationType;

    @IsOptional()
    @IsString({ message: 'Customer ID must be a string' })
    @MaxLength(140, { message: 'Customer ID must not exceed 140 characters' })
    customer_id?: string;

    @IsOptional()
    @IsString({ message: 'Error code must be a string' })
    @MaxLength(140, { message: 'Error code must not exceed 140 characters' })
    err_code?: string;

    @IsOptional()
    @IsString({ message: 'Entity label must be a string' })
    @MaxLength(140, { message: 'Entity label must not exceed 140 characters' })
    entity_label?: string;

    @IsOptional()
    @IsEnum(NotificationSeverity, { message: 'Invalid notification severity' })
    severity?: NotificationSeverity;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Is read must be a number (0 or 1)' })
    @Min(0, { message: 'Is read must be 0 or 1' })
    @Max(1, { message: 'Is read must be 0 or 1' })
    is_read?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({}, { message: 'Is sent must be a number (0 or 1)' })
    @Min(0, { message: 'Is sent must be 0 or 1' })
    @Max(1, { message: 'Is sent must be 0 or 1' })
    is_sent?: number;
}

/**
 * DTO for IoT notification path parameters
 */
export class IotNotificationParamsDto {
    @IsDefined({ message: 'Notification name is required' })
    @IsString({ message: 'Notification name must be a string' })
    @IsNotEmpty({ message: 'Notification name cannot be empty' })
    name: string;
}

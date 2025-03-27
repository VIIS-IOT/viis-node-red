import { IsString, IsInt, IsEnum, IsOptional, IsBoolean, IsDateString, IsDefined, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class TabiotSchedulePlanDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    label: string;

    @IsInt()
    @IsOptional()
    schedule_count: number;

    @IsEnum(['active', 'inactive'])
    @IsOptional()
    status: 'active' | 'inactive';

    @IsNumber()
    @IsOptional()
    enable?: number; // Using number since the entity uses tinyint, but you could map it to boolean if preferred

    @IsString()
    @IsDefined()
    device_id!: string;

    @IsDateString()
    @IsOptional()
    start_date?: string;

    @IsDateString()
    @IsOptional()
    end_date?: string;

    // Optional: Include related schedules as a nested DTO if needed
    // @Type(() => TabiotScheduleDto)
    // @IsOptional()
    // schedules?: TabiotScheduleDto[];
}
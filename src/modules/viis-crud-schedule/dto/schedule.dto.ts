import { IsString, IsOptional, IsEnum, IsDefined, IsNumber } from 'class-validator';

export class TabiotScheduleDto {
    @IsString()
    name: string;

    @IsString()
    @IsDefined()
    device_id!: string;

    @IsDefined()
    action?: string;

    @IsEnum(['', 'circulate', 'period', 'fixed', 'interval'])
    type: '' | 'circulate' | 'period' | 'fixed' | 'interval';

    @IsString()
    @IsOptional()
    interval?: string;

    @IsString()
    @IsOptional()
    start_date?: string;

    @IsString()
    @IsOptional()
    end_date?: string;

    @IsString()
    @IsOptional()
    start_time?: string;

    @IsString()
    @IsOptional()
    end_time?: string;

    @IsString()
    @IsDefined()
    schedule_plan_id?: string;

    @IsEnum(['running', 'stopped', 'finished', ''])
    status: 'running' | 'stopped' | 'finished' | '';

    @IsNumber()
    @IsOptional()
    enable?: string;

    @IsNumber()
    @IsOptional()
    is_deleted?: string;
}
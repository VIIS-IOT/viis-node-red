/**
 * @fileoverview Marine IoT Telemetry DTOs
 * 
 * DTOs for Marine IoT specific telemetry data endpoints
 * Separate from general telemetry to keep marine-specific logic isolated
 */

import { IsString, IsOptional, IsNumber, Min, Max, IsEnum } from 'class-validator';

/**
 * Machine types supported by Marine IoT
 */
export enum MachineType {
    GENERATOR = 'GENERATOR',
    MAIN_ENGINE = 'MAIN_ENGINE',
    BOILER = 'BOILER'
}

/**
 * Query parameters for getting latest telemetry
 */
export class MarineTelemetryQueryDto {
    @IsOptional()
    @IsString()
    keys?: string; // Comma-separated list: "fs01,fs02,fs03,fs04,fs05,fs06"
}

/**
 * Query parameters for getting telemetry history
 */
export class MarineTelemetryHistoryQueryDto extends MarineTelemetryQueryDto {
    @IsNumber()
    @Min(0)
    start_time!: number;

    @IsNumber()
    @Min(0)
    end_time!: number;

    @IsOptional()
    @IsNumber()
    @Min(1000)
    @Max(3600000) // Max 1 hour interval
    interval?: number;

    @IsOptional()
    @IsEnum(MachineType)
    machine_type?: MachineType;
}

/**
 * Single telemetry data point
 */
export interface TelemetryDataPoint {
    key_name: string;
    value: number;           // m³/h
    value_tons: number;      // T/h
    oil_profile_id: string | null;
    density_snapshot: number | null;
    machine_type: MachineType;
}

/**
 * Flow data for a machine
 */
export interface MachineFlowData {
    key: string;
    m3h: number;
    th: number;
}

/**
 * Consumption rate for a machine
 */
export interface ConsumptionRate {
    m3h: number;
    th: number;
}

/**
 * Machine data aggregated
 */
export interface MachineData {
    flow_in: MachineFlowData;
    flow_return: MachineFlowData;
    consumption_rate: ConsumptionRate;
    oil_profile: string | null;
    density: number;
}

/**
 * Latest telemetry response
 */
export interface LatestTelemetryResponseDto {
    device_id: string;
    timestamp: number;
    data: TelemetryDataPoint[];
    machines: {
        [MachineType.GENERATOR]?: MachineData;
        [MachineType.MAIN_ENGINE]?: MachineData;
        [MachineType.BOILER]?: MachineData;
    };
}

/**
 * Historical data point with all sensors
 */
export interface HistoricalDataPoint {
    timestamp: number;
    fs01?: number;
    fs02?: number;
    fs03?: number;
    fs04?: number;
    fs05?: number;
    fs06?: number;
    profiles?: {
        [key in MachineType]?: {
            id: string;
            density: number;
        };
    };
}

/**
 * Telemetry history response
 */
export interface TelemetryHistoryResponseDto {
    device_id: string;
    time_range: {
        start: number;
        end: number;
    };
    interval: number;
    data: HistoricalDataPoint[];
}

/**
 * Machine status
 */
export enum MachineStatus {
    OPERATIONAL = 'OPERATIONAL',
    WARNING = 'WARNING',
    ERROR = 'ERROR',
    NO_DATA = 'NO_DATA'
}

/**
 * Machine profile info
 */
export interface MachineProfile {
    id: string;
    oil_type: 'BO' | 'DO' | 'HFO';
    density: number;
    label: string;
}

/**
 * Machine summary info
 */
export interface MachineSummary {
    type: MachineType;
    sensors: {
        flow_in: string;
        flow_return: string;
    };
    current_profile: MachineProfile | null;
    status: MachineStatus;
    last_update: number;
}

/**
 * Machines summary response
 */
export interface MachinesSummaryResponseDto {
    device_id: string;
    machines: MachineSummary[];
}

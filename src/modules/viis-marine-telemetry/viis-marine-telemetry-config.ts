/**
 * Configuration types for viis-marine-telemetry node
 * Extends viis-telemetry configuration with Marine IoT specific settings
 */

import { ViisTelemetryNodeDef } from '../viis-telemetry/viis-telemetry-config';

export interface ViisMarinetTelemetryNodeDef extends ViisTelemetryNodeDef {
    enableMarineIoT?: boolean;
    flowSensorKeys?: string; // Comma-separated list, default: fs01,fs02,fs03,fs04,fs05,fs06
    profileCacheDuration?: number; // Cache duration in milliseconds, default: 300000 (5 min)
}

export interface MarineIoTConfig {
    enabled: boolean;
    flowSensorKeys: string[];
    profileCacheDuration: number;
}

export interface OilProfileCache {
    profile: OilProfile | null;
    timestamp: number;
}

export interface OilProfile {
    name: string;
    device_id: string;
    machine_type: "BOILER" | "MAIN_ENGINE" | "GENERATOR_HFO" | "GENERATOR_DO"
    oil_type: 'DO' | 'FO';
    operating_temperature: number;
    density: number; // kg/m³ (SI unit)
    label?: string;
    is_active: boolean;
}

/**
 * Configuration interfaces for viis-flow-accumulation node
 */

import { NodeDef } from 'node-red';

/**
 * Node-RED configuration for flow accumulation
 */
export interface ViisFlowAccumulationNodeDef extends NodeDef {
    name: string;
    enableAutoCalculation: boolean;
    cronSchedule: string;
    publishToMqtt: boolean;
    mqttTopic: string;
    enableBackfill: boolean;
    useTfsKeyFormat?: boolean; // Use tfs01_hourly_m3 instead of fs01_accumulated_m3
}

/**
 * Manual calculation request
 */
export interface ManualCalculationRequest {
    hourStart?: Date | string;
}

/**
 * Backfill request
 */
export interface BackfillRequest {
    startDate: Date | string;
    endDate: Date | string;
}

/**
 * Accumulation result for MQTT publishing (ThingsBoard format)
 * Flat structure with ts field and sensor-prefixed keys
 */
export interface AccumulationPayload {
    ts: number;
    hour_start: string;
    hour_end: string;
    [key: string]: any; // Dynamic sensor keys: fs01_avg_flow_m3h, fs01_accumulated_m3, etc.
}

/**
 * Node status
 */
export interface AccumulationStatus {
    lastCalculation: number | null;
    lastSuccess: boolean;
    totalCalculations: number;
    failedCalculations: number;
    nextScheduled: number | null;
}

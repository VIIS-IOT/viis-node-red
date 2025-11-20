/**
 * Configuration interfaces for viis-trip-realtime-telemetry node
 */

import { NodeDef } from 'node-red';

/**
 * Node-RED configuration for trip realtime telemetry
 */
export interface ViisTripRealtimeTelemetryNodeDef extends NodeDef {
    name: string;
    updateInterval: number; // Seconds: 30, 60, 120, 300 (default: 300 = 5 minutes)
    publishToMqtt: boolean;
    mqttTopic: string;
    includeConsumption: boolean; // Include machine consumption (flow_in - flow_return)
}

/**
 * Trip telemetry payload (ThingsBoard format)
 * Real-time running totals from trip start
 */
export interface TripTelemetryPayload {
    ts: number;
    trip_id: string;
    trip_start: number;
    trip_status: string;
    trip_duration_hours: number;
    
    // Sensor running totals
    [key: string]: any; // fs01_trip_total_m3, fs01_trip_total_tons, etc.
}

/**
 * Machine consumption data
 */
export interface MachineConsumption {
    machine_name: string;
    flow_in_sensor: string;
    flow_return_sensor: string;
    consumption_m3: number;
    consumption_tons: number;
}

/**
 * Node status
 */
export interface TripTelemetryStatus {
    lastUpdate: number | null;
    tripActive: boolean;
    currentTripId: string | null;
    totalUpdates: number;
    updateInterval: number;
}

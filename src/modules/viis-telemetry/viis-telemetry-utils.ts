/**
 * Shared types and logic utilities for viis-telemetry node.
 * All functions and types here are exported for testing and reuse.
 */

import { MySqlClientCore } from "../../core/mysql-client";
import { TabiotDeviceTelemetry } from "../../orm/entities/device-telemetry/TabiotDeviceTelemetry";

/** Telemetry data structure with key-value pairs */
export interface TelemetryData {
  [key: string]: number | boolean | string;
}

/** Configuration for scaling operations on telemetry values */
export interface ScaleConfig {
  key: string;
  operation: "multiply" | "divide";
  factor: number;
  direction: "read" | "write";
}

/** Threshold configuration for change detection */
export interface ThresholdConfig {
  [key: string]: number;
}

/** MQTT client interface for publishing */
export interface MqttPublisher {
  publish: (topic: string, payload: string) => void;
}

/** Node interface for logging */
export interface NodeLogger {
  warn: (msg: string) => void;
}

/**
 * Apply scaling to a value according to scaleConfigs.
 * @param key - Telemetry key
 * @param value - Raw value
 * @param direction - "read" or "write"
 * @param scaleConfigs - Array of scale config
 * @returns Scaled value
 */
export function applyScaling(
  key: string,
  value: number,
  direction: "read" | "write",
  scaleConfigs: ScaleConfig[]
): number {
  if (!Array.isArray(scaleConfigs)) scaleConfigs = [];
  const config = scaleConfigs.find((conf) => conf.key === key && conf.direction === direction);
  if (!config) return value;
  if (config.operation === "multiply") return value * config.factor;
  if (config.operation === "divide") return value / config.factor;
  return value;
}

/**
 * Detect changed keys in telemetry data, considering threshold for numeric values.
 * Supports special key 'all' in thresholdConfig to apply default threshold for all keys.
 * @param current - Current telemetry data
 * @param previous - Previous telemetry data
 * @param thresholdConfig - Object mapping key to threshold, may include 'all'
 * @returns Object with changed keys
 */
export function getChangedKeys(
  current: TelemetryData,
  previous: TelemetryData,
  thresholdConfig: { [key: string]: number }
): TelemetryData {
  const changed: TelemetryData = {};
  const defaultThreshold = typeof thresholdConfig["all"] === "number" ? thresholdConfig["all"] : 0;
  for (const key in current) {
    if (typeof current[key] === "number" && typeof previous[key] === "number") {
      const threshold = typeof thresholdConfig[key] === "number" ? thresholdConfig[key] : defaultThreshold;
      if (Math.abs((current[key] as number) - (previous[key] as number)) >= threshold) {
        changed[key] = current[key];
      }
    } else if (current[key] !== previous[key]) {
      changed[key] = current[key];
    }
  }
  return changed;
}

/** Parameters for publishing telemetry data */
export interface PublishTelemetryParams {
  data: TelemetryData;
  emqxClient: MqttPublisher;
  thingsboardClient: MqttPublisher;
  emqxTopic: string;
  thingsboardTopic: string;
}

/** Parameters for saving telemetry data to MySQL */
export interface SaveTelemetryParams {
  data: TelemetryData;
  deviceId: string;
  mysqlClient: MySqlClientCore;
  timestamp?: number;
}

/** Parameters for debug logging */
export interface DebugLogParams {
  enable: boolean;
  node: NodeLogger;
  message: string;
}

/**
 * Publish telemetry data to both EMQX and Thingsboard clients.
 * Handles network failures gracefully to prevent crashes.
 * @param params - Publishing parameters including clients and topics
 */
export async function publishTelemetry(params: PublishTelemetryParams): Promise<void> {
  const payload = JSON.stringify(params.data);
  
  // Publish to EMQX (local) with error handling
  try {
    await params.emqxClient.publish(params.emqxTopic, payload);
  } catch (error) {
    // Log but don't crash - local MQTT may be down
    console.warn(`[Telemetry] Failed to publish to EMQX: ${(error as Error).message}`);
  }
  
  // Publish to ThingsBoard with error handling
  try {
    await params.thingsboardClient.publish(params.thingsboardTopic, payload);
  } catch (error) {
    // Log but don't crash - ThingsBoard may be unreachable due to network issues
    console.warn(`[Telemetry] Failed to publish to ThingsBoard: ${(error as Error).message}`);
  }
}

/**
 * Log debug message if enabled.
 * @param params - Debug logging parameters
 */
export function debugLog(params: DebugLogParams): void {
  if (params.enable) {
    params.node.warn(params.message);
  }
}

/**
 * List of keys that should remain as strings (not converted to numbers)
 */
const STRING_KEYS = [
  'oil_profile',
  'oil_profile_id',
  'trip_id',
  'trip_status',
  'device_id',
  'sensor_key',
  'hour_start',
  'hour_end',
  'gps_time',
  'zda_time',
  'zda_day',
  'zda_month',
  'zda_year',
  'datum_local',
  'datum_ref',
  'machine_name',
  'flow_in_sensor',
  'flow_return_sensor',
  'flow_in',
  'flow_return',
];

/**
 * Normalize telemetry value to ensure consistent data type.
 * Converts string numbers to actual numbers, preserves known string keys.
 * Arrays and objects are JSON stringified for ThingsBoard compatibility.
 * 
 * @param key - Telemetry key name
 * @param value - Raw value (may be string or number)
 * @returns Normalized value with correct type
 */
export function normalizeValue(key: string, value: any): string | number | boolean | null {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return null;
  }

  // Check if this key should remain as string
  const isStringKey = STRING_KEYS.some(sk => key.includes(sk) || key.endsWith(sk));
  if (isStringKey) {
    return String(value);
  }

  // Handle boolean
  if (typeof value === 'boolean') {
    return value;
  }

  // Handle arrays - JSON stringify for ThingsBoard compatibility
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  // Handle objects (non-array) - JSON stringify for ThingsBoard compatibility
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  // Handle string that might be a number
  if (typeof value === 'string') {
    const trimmed = value.trim();
    
    // Empty string → null
    if (trimmed === '') {
      return null;
    }
    
    // Try to parse as number
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed) && isFinite(parsed)) {
      return parsed;
    }
    
    // Keep as string if not a valid number
    return trimmed;
  }

  // Handle number
  if (typeof value === 'number') {
    // Handle NaN and Infinity
    if (!isFinite(value)) {
      return null;
    }
    return value;
  }

  // For any remaining types, JSON stringify to ensure proper serialization
  return JSON.stringify(value);
}

/**
 * Normalize all values in a telemetry object.
 * Ensures consistent data types before sending to ThingsBoard.
 * 
 * @param data - Raw telemetry data object
 * @returns Normalized telemetry data with consistent types
 */
export function normalizeTelemetryData(data: Record<string, any>): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};
  
  for (const [key, value] of Object.entries(data)) {
    // Skip ts field (always number)
    if (key === 'ts') {
      normalized[key] = typeof value === 'number' ? value : Date.now();
      continue;
    }
    
    const normalizedValue = normalizeValue(key, value);
    if (normalizedValue !== null) {
      normalized[key] = normalizedValue;
    }
  }
  
  return normalized;
}

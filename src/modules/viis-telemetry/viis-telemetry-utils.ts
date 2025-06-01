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
 * @param params - Publishing parameters including clients and topics
 */
export function publishTelemetry(params: PublishTelemetryParams): void {
  const payload = JSON.stringify(params.data);
  params.emqxClient.publish(params.emqxTopic, payload);
  params.thingsboardClient.publish(params.thingsboardTopic, payload);
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

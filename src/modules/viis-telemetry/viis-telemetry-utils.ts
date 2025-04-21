/**
 * Shared types and logic utilities for viis-telemetry node.
 * All functions and types here are exported for testing and reuse.
 */

export interface TelemetryData {
    [key: string]: number | boolean | string;
}

export interface ScaleConfig {
    key: string;
    operation: "multiply" | "divide";
    factor: number;
    direction: "read" | "write";
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
    const config = scaleConfigs.find((conf) => conf.key === key && conf.direction === direction);
    if (!config) return value;
    if (config.operation === "multiply") return value * config.factor;
    if (config.operation === "divide") return value / config.factor;
    return value;
}

/**
 * Detect changed keys in telemetry data, considering threshold for numeric values.
 * @param current - Current telemetry data
 * @param previous - Previous telemetry data
 * @param thresholdConfig - Object mapping key to threshold
 * @returns Object with changed keys
 */
export function getChangedKeys(
    current: TelemetryData,
    previous: TelemetryData,
    thresholdConfig: { [key: string]: number }
): TelemetryData {
    const changed: TelemetryData = {};
    for (const key in current) {
        if (typeof current[key] === "number" && typeof previous[key] === "number") {
            const threshold = thresholdConfig[key] ?? 0;
            if (Math.abs((current[key] as number) - (previous[key] as number)) > threshold) {
                changed[key] = current[key];
            }
        } else if (current[key] !== previous[key]) {
            changed[key] = current[key];
        }
    }
    return changed;
}

/**
 * Publish telemetry data to both EMQX and Thingsboard clients.
 * @param params Object gồm data, emqxClient, thingsboardClient, emqxTopic, thingsboardTopic
 */
export function publishTelemetry(params: {
  data: TelemetryData;
  emqxClient: { publish: (topic: string, payload: string) => void };
  thingsboardClient: { publish: (topic: string, payload: string) => void };
  emqxTopic: string;
  thingsboardTopic: string;
}): void {
  const payload: string = JSON.stringify(params.data);
  params.emqxClient.publish(params.emqxTopic, payload);
  params.thingsboardClient.publish(params.thingsboardTopic, payload);
}

/**
 * Log debug message if enabled.
 * @param params.enable Bật/tắt debug log
 * @param params.node Node instance có warn
 * @param params.message Nội dung log
 */
export function debugLog(params: {
  enable: boolean;
  node: { warn: (msg: string) => void };
  message: string;
}): void {
  if (params.enable) {
    params.node.warn(params.message);
  }
}

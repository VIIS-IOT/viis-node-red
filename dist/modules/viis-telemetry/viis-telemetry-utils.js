"use strict";
/**
 * Shared types and logic utilities for viis-telemetry node.
 * All functions and types here are exported for testing and reuse.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyScaling = applyScaling;
exports.getChangedKeys = getChangedKeys;
exports.publishTelemetry = publishTelemetry;
exports.debugLog = debugLog;
/**
 * Apply scaling to a value according to scaleConfigs.
 * @param key - Telemetry key
 * @param value - Raw value
 * @param direction - "read" or "write"
 * @param scaleConfigs - Array of scale config
 * @returns Scaled value
 */
function applyScaling(key, value, direction, scaleConfigs) {
    if (!Array.isArray(scaleConfigs))
        scaleConfigs = [];
    const config = scaleConfigs.find((conf) => conf.key === key && conf.direction === direction);
    if (!config)
        return value;
    if (config.operation === "multiply")
        return value * config.factor;
    if (config.operation === "divide")
        return value / config.factor;
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
function getChangedKeys(current, previous, thresholdConfig) {
    const changed = {};
    const defaultThreshold = typeof thresholdConfig["all"] === "number" ? thresholdConfig["all"] : 0;
    for (const key in current) {
        if (typeof current[key] === "number" && typeof previous[key] === "number") {
            const threshold = typeof thresholdConfig[key] === "number" ? thresholdConfig[key] : defaultThreshold;
            if (Math.abs(current[key] - previous[key]) >= threshold) {
                changed[key] = current[key];
            }
        }
        else if (current[key] !== previous[key]) {
            changed[key] = current[key];
        }
    }
    return changed;
}
/**
 * Publish telemetry data to both EMQX and Thingsboard clients.
 * Handles network failures gracefully to prevent crashes.
 * @param params - Publishing parameters including clients and topics
 */
async function publishTelemetry(params) {
    const payload = JSON.stringify(params.data);
    // Publish to EMQX (local) with error handling
    try {
        await params.emqxClient.publish(params.emqxTopic, payload);
    }
    catch (error) {
        // Log but don't crash - local MQTT may be down
        console.warn(`[Telemetry] Failed to publish to EMQX: ${error.message}`);
    }
    // Publish to ThingsBoard with error handling
    try {
        await params.thingsboardClient.publish(params.thingsboardTopic, payload);
    }
    catch (error) {
        // Log but don't crash - ThingsBoard may be unreachable due to network issues
        console.warn(`[Telemetry] Failed to publish to ThingsBoard: ${error.message}`);
    }
}
/**
 * Log debug message if enabled.
 * @param params - Debug logging parameters
 */
function debugLog(params) {
    if (params.enable) {
        params.node.warn(params.message);
    }
}

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
 * @param current - Current telemetry data
 * @param previous - Previous telemetry data
 * @param thresholdConfig - Object mapping key to threshold
 * @returns Object with changed keys
 */
function getChangedKeys(current, previous, thresholdConfig) {
    var _a;
    const changed = {};
    for (const key in current) {
        if (typeof current[key] === "number" && typeof previous[key] === "number") {
            const threshold = (_a = thresholdConfig[key]) !== null && _a !== void 0 ? _a : 0;
            if (Math.abs(current[key] - previous[key]) > threshold) {
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
 * @param params Object gồm data, emqxClient, thingsboardClient, emqxTopic, thingsboardTopic
 */
function publishTelemetry(params) {
    const payload = JSON.stringify(params.data);
    params.emqxClient.publish(params.emqxTopic, payload);
    params.thingsboardClient.publish(params.thingsboardTopic, payload);
}
/**
 * Log debug message if enabled.
 * @param params.enable Bật/tắt debug log
 * @param params.node Node instance có warn
 * @param params.message Nội dung log
 */
function debugLog(params) {
    if (params.enable) {
        params.node.warn(params.message);
    }
}

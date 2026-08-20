"use strict";
/**
 * Demeter / TBMQ device topic contract.
 *
 * Topic shape lives in source, not in per-node hardcodes:
 *   v1/device/{deviceId}/telemetry
 *   v1/device/{deviceId}/rpc/+
 *
 * ThingsBoard used session-aliased `v1/devices/me/...`. Demeter TBMQ routes by UUID.
 * Deploy only changes common.json (THINGSBOARD_HOST/PORT, IOT_DEVICE_TOPIC_BASE).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MQTT_PORT = exports.DEFAULT_MQTT_HOST = exports.DEFAULT_DEVICE_TOPIC_BASE = void 0;
exports.getDeviceTopicBase = getDeviceTopicBase;
exports.safeDeviceTopicSegment = safeDeviceTopicSegment;
exports.buildDeviceTelemetryTopic = buildDeviceTelemetryTopic;
exports.buildDeviceAttributesTopic = buildDeviceAttributesTopic;
exports.buildDeviceLifecycleTopic = buildDeviceLifecycleTopic;
exports.buildDeviceRpcSubscribeTopic = buildDeviceRpcSubscribeTopic;
exports.buildDeviceRpcTopic = buildDeviceRpcTopic;
exports.buildDeviceRpcResponseTopic = buildDeviceRpcResponseTopic;
exports.buildMqttBrokerUrl = buildMqttBrokerUrl;
exports.DEFAULT_DEVICE_TOPIC_BASE = 'v1/device';
exports.DEFAULT_MQTT_HOST = 'host.docker.internal';
exports.DEFAULT_MQTT_PORT = '11883';
function getDeviceTopicBase() {
    const fromEnv = (process.env.IOT_DEVICE_TOPIC_BASE || exports.DEFAULT_DEVICE_TOPIC_BASE).trim();
    return fromEnv.replace(/^\/+|\/+$/g, '') || exports.DEFAULT_DEVICE_TOPIC_BASE;
}
function safeDeviceTopicSegment(value) {
    const cleaned = String(value || '')
        .replace(/[#+/]/g, '_')
        .trim()
        .slice(0, 180);
    return cleaned || '_none';
}
function joinDeviceTopic(deviceId, suffix) {
    return [getDeviceTopicBase(), safeDeviceTopicSegment(deviceId), suffix.replace(/^\/+/, '')].join('/');
}
function buildDeviceTelemetryTopic(deviceId) {
    return joinDeviceTopic(deviceId, 'telemetry');
}
function buildDeviceAttributesTopic(deviceId) {
    return joinDeviceTopic(deviceId, 'attributes');
}
function buildDeviceLifecycleTopic(deviceId) {
    return joinDeviceTopic(deviceId, 'lifecycle');
}
function buildDeviceRpcSubscribeTopic(deviceId) {
    return joinDeviceTopic(deviceId, 'rpc/+');
}
function buildDeviceRpcTopic(deviceId, commandId = '+') {
    return joinDeviceTopic(deviceId, `rpc/${safeDeviceTopicSegment(commandId)}`);
}
function buildDeviceRpcResponseTopic(deviceId, commandId = '+') {
    return joinDeviceTopic(deviceId, `rpc/response/${safeDeviceTopicSegment(commandId)}`);
}
function buildMqttBrokerUrl(host, port) {
    const resolvedHost = (host || exports.DEFAULT_MQTT_HOST).trim() || exports.DEFAULT_MQTT_HOST;
    const resolvedPort = String(port || exports.DEFAULT_MQTT_PORT).trim() || exports.DEFAULT_MQTT_PORT;
    return `mqtt://${resolvedHost}:${resolvedPort}`;
}

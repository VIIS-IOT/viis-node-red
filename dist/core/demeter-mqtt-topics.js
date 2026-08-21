"use strict";
/**
 * Demeter / TBMQ device topic contract.
 *
 * Topic shape lives in source, not in per-node hardcodes:
 *   v1/device/{deviceId}/telemetry
 *   v1/device/{deviceId}/rpc/+
 *
 * Broker host/port come from common.json via env-loader:
 *   THINGSBOARD_MQTT_BROKER, or THINGSBOARD_HOST + THINGSBOARD_PORT.
 * Do not default to host.docker.internal / 11883 — those are local compose values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MQTT_PROTOCOL_DEFAULT_PORT = exports.DEFAULT_DEVICE_TOPIC_BASE = void 0;
exports.getDeviceTopicBase = getDeviceTopicBase;
exports.safeDeviceTopicSegment = safeDeviceTopicSegment;
exports.buildDeviceTelemetryTopic = buildDeviceTelemetryTopic;
exports.buildDeviceAttributesTopic = buildDeviceAttributesTopic;
exports.buildDeviceLifecycleTopic = buildDeviceLifecycleTopic;
exports.buildDeviceRpcSubscribeTopic = buildDeviceRpcSubscribeTopic;
exports.buildDeviceRpcTopic = buildDeviceRpcTopic;
exports.buildDeviceRpcResponseTopic = buildDeviceRpcResponseTopic;
exports.isRpcCommandId = isRpcCommandId;
exports.isHandledRpcControlMethod = isHandledRpcControlMethod;
exports.parseDeviceRpcRequestTopic = parseDeviceRpcRequestTopic;
exports.extractRpcCommandId = extractRpcCommandId;
exports.buildMqttBrokerUrl = buildMqttBrokerUrl;
exports.resolveThingsboardMqttBroker = resolveThingsboardMqttBroker;
exports.DEFAULT_DEVICE_TOPIC_BASE = 'v1/device';
/** MQTT spec default when common.json sets host but omits port. */
exports.MQTT_PROTOCOL_DEFAULT_PORT = '1883';
function getDeviceTopicBase(helper) {
    const fromHelper = helper
        ? String(helper.getEnvVar('IOT_DEVICE_TOPIC_BASE', '') || '').trim()
        : '';
    const fromEnv = (process.env.IOT_DEVICE_TOPIC_BASE || '').trim();
    const base = fromHelper || fromEnv || exports.DEFAULT_DEVICE_TOPIC_BASE;
    return base.replace(/^\/+|\/+$/g, '') || exports.DEFAULT_DEVICE_TOPIC_BASE;
}
function safeDeviceTopicSegment(value) {
    const cleaned = String(value || '')
        .replace(/[#+/]/g, '_')
        .trim()
        .slice(0, 180);
    return cleaned || '_none';
}
function joinDeviceTopic(deviceId, suffix, helper) {
    return [getDeviceTopicBase(helper), safeDeviceTopicSegment(deviceId), suffix.replace(/^\/+/, '')].join('/');
}
function buildDeviceTelemetryTopic(deviceId, helper) {
    return joinDeviceTopic(deviceId, 'telemetry', helper);
}
function buildDeviceAttributesTopic(deviceId, helper) {
    return joinDeviceTopic(deviceId, 'attributes', helper);
}
function buildDeviceLifecycleTopic(deviceId, helper) {
    return joinDeviceTopic(deviceId, 'lifecycle', helper);
}
function buildDeviceRpcSubscribeTopic(deviceId, helper) {
    return joinDeviceTopic(deviceId, 'rpc/+', helper);
}
function buildDeviceRpcTopic(deviceId, commandId = '+', helper) {
    return joinDeviceTopic(deviceId, `rpc/${safeDeviceTopicSegment(commandId)}`, helper);
}
function buildDeviceRpcResponseTopic(deviceId, commandId = '+', helper) {
    return joinDeviceTopic(deviceId, `rpc/response/${safeDeviceTopicSegment(commandId)}`, helper);
}
const RPC_COMMAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDLED_RPC_CONTROL_METHODS = new Set(['set_state', 'set_state_batch']);
function isRpcCommandId(value) {
    return typeof value === 'string' && RPC_COMMAND_ID_RE.test(value.trim());
}
/** Methods viis-rpc-control actually executes. Schedule/oneway methods stay unacked. */
function isHandledRpcControlMethod(method) {
    return HANDLED_RPC_CONTROL_METHODS.has(String(method || '').trim());
}
/**
 * Downlink is `v1/device/{id}/rpc/{commandId}`.
 * Uplink `.../rpc/response/{commandId}` must not parse as a request.
 */
function parseDeviceRpcRequestTopic(topic, helper) {
    const baseParts = getDeviceTopicBase(helper).split('/').filter(Boolean);
    const parts = String(topic || '').split('/').filter(Boolean);
    if (parts.length !== baseParts.length + 3)
        return null;
    if (!baseParts.every((part, index) => parts[index] === part))
        return null;
    if (parts[baseParts.length + 1] !== 'rpc')
        return null;
    const commandId = decodeURIComponent(parts[baseParts.length + 2] || '');
    if (!commandId || commandId === 'response')
        return null;
    return {
        deviceId: decodeURIComponent(parts[baseParts.length] || ''),
        commandId,
    };
}
function extractRpcCommandId(payload, topic) {
    const fromPayload = [
        payload === null || payload === void 0 ? void 0 : payload.command_id,
        payload === null || payload === void 0 ? void 0 : payload.commandId,
        payload === null || payload === void 0 ? void 0 : payload.requestId,
        payload === null || payload === void 0 ? void 0 : payload.request_id,
    ].find((value) => isRpcCommandId(value));
    if (fromPayload)
        return String(fromPayload).trim();
    const fromTopic = parseDeviceRpcRequestTopic(String(topic || ''));
    if (fromTopic && isRpcCommandId(fromTopic.commandId))
        return fromTopic.commandId;
    return null;
}
function buildMqttBrokerUrl(host, port) {
    const resolvedHost = (host || '').trim();
    if (!resolvedHost) {
        return '';
    }
    const resolvedPort = String(port || exports.MQTT_PROTOCOL_DEFAULT_PORT).trim() || exports.MQTT_PROTOCOL_DEFAULT_PORT;
    return `mqtt://${resolvedHost}:${resolvedPort}`;
}
/**
 * Resolve the Demeter/TBMQ MQTT broker URL from Node-RED global context (common.json).
 * Empty string means env-loader has not loaded THINGSBOARD_* yet.
 */
function resolveThingsboardMqttBroker(helper) {
    const full = String(helper.getEnvVar('THINGSBOARD_MQTT_BROKER', '') || '').trim();
    if (full) {
        return /^mqtts?:\/\//i.test(full) ? full.replace(/\/$/, '') : `mqtt://${full.replace(/\/$/, '')}`;
    }
    const host = String(helper.getEnvVar('THINGSBOARD_HOST', '') || '').trim();
    const port = String(helper.getEnvVar('THINGSBOARD_PORT', '') || '').trim();
    return buildMqttBrokerUrl(host, port);
}

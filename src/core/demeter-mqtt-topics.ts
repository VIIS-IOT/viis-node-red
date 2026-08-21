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

import { GlobalContextHelper } from '../ultils/global-context-helper';

export const DEFAULT_DEVICE_TOPIC_BASE = 'v1/device';
/** MQTT spec default when common.json sets host but omits port. */
export const MQTT_PROTOCOL_DEFAULT_PORT = '1883';

export function getDeviceTopicBase(helper?: GlobalContextHelper): string {
  const fromHelper = helper
    ? String(helper.getEnvVar('IOT_DEVICE_TOPIC_BASE', '') || '').trim()
    : '';
  const fromEnv = (process.env.IOT_DEVICE_TOPIC_BASE || '').trim();
  const base = fromHelper || fromEnv || DEFAULT_DEVICE_TOPIC_BASE;
  return base.replace(/^\/+|\/+$/g, '') || DEFAULT_DEVICE_TOPIC_BASE;
}

export function safeDeviceTopicSegment(value: string): string {
  const cleaned = String(value || '')
    .replace(/[#+/]/g, '_')
    .trim()
    .slice(0, 180);
  return cleaned || '_none';
}

function joinDeviceTopic(deviceId: string, suffix: string, helper?: GlobalContextHelper): string {
  return [getDeviceTopicBase(helper), safeDeviceTopicSegment(deviceId), suffix.replace(/^\/+/, '')].join('/');
}

export function buildDeviceTelemetryTopic(deviceId: string, helper?: GlobalContextHelper): string {
  return joinDeviceTopic(deviceId, 'telemetry', helper);
}

export function buildDeviceAttributesTopic(deviceId: string, helper?: GlobalContextHelper): string {
  return joinDeviceTopic(deviceId, 'attributes', helper);
}

export function buildDeviceLifecycleTopic(deviceId: string, helper?: GlobalContextHelper): string {
  return joinDeviceTopic(deviceId, 'lifecycle', helper);
}

export function buildDeviceRpcSubscribeTopic(deviceId: string, helper?: GlobalContextHelper): string {
  return joinDeviceTopic(deviceId, 'rpc/+', helper);
}

export function buildDeviceRpcTopic(deviceId: string, commandId = '+', helper?: GlobalContextHelper): string {
  return joinDeviceTopic(deviceId, `rpc/${safeDeviceTopicSegment(commandId)}`, helper);
}

export function buildDeviceRpcResponseTopic(deviceId: string, commandId = '+', helper?: GlobalContextHelper): string {
  return joinDeviceTopic(deviceId, `rpc/response/${safeDeviceTopicSegment(commandId)}`, helper);
}

const RPC_COMMAND_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HANDLED_RPC_CONTROL_METHODS = new Set(['set_state', 'set_state_batch']);

export function isRpcCommandId(value: unknown): value is string {
  return typeof value === 'string' && RPC_COMMAND_ID_RE.test(value.trim());
}

/** Methods viis-rpc-control actually executes. Schedule/oneway methods stay unacked. */
export function isHandledRpcControlMethod(method: unknown): boolean {
  return HANDLED_RPC_CONTROL_METHODS.has(String(method || '').trim());
}

/**
 * Downlink is `v1/device/{id}/rpc/{commandId}`.
 * Uplink `.../rpc/response/{commandId}` must not parse as a request.
 */
export function parseDeviceRpcRequestTopic(
  topic: string,
  helper?: GlobalContextHelper,
): { deviceId: string; commandId: string } | null {
  const baseParts = getDeviceTopicBase(helper).split('/').filter(Boolean);
  const parts = String(topic || '').split('/').filter(Boolean);
  if (parts.length !== baseParts.length + 3) return null;
  if (!baseParts.every((part, index) => parts[index] === part)) return null;
  if (parts[baseParts.length + 1] !== 'rpc') return null;
  const commandId = decodeURIComponent(parts[baseParts.length + 2] || '');
  if (!commandId || commandId === 'response') return null;
  return {
    deviceId: decodeURIComponent(parts[baseParts.length] || ''),
    commandId,
  };
}

export function extractRpcCommandId(payload?: Record<string, any> | null, topic?: string): string | null {
  const fromPayload = [
    payload?.command_id,
    payload?.commandId,
    payload?.requestId,
    payload?.request_id,
  ].find((value) => isRpcCommandId(value));
  if (fromPayload) return String(fromPayload).trim();

  const fromTopic = parseDeviceRpcRequestTopic(String(topic || ''));
  if (fromTopic && isRpcCommandId(fromTopic.commandId)) return fromTopic.commandId;
  return null;
}

export function buildMqttBrokerUrl(host?: string, port?: string | number): string {
  const resolvedHost = (host || '').trim();
  if (!resolvedHost) {
    return '';
  }
  const resolvedPort = String(port || MQTT_PROTOCOL_DEFAULT_PORT).trim() || MQTT_PROTOCOL_DEFAULT_PORT;
  return `mqtt://${resolvedHost}:${resolvedPort}`;
}

/**
 * Resolve the Demeter/TBMQ MQTT broker URL from Node-RED global context (common.json).
 * Empty string means env-loader has not loaded THINGSBOARD_* yet.
 */
export function resolveThingsboardMqttBroker(helper: GlobalContextHelper): string {
  const full = String(helper.getEnvVar('THINGSBOARD_MQTT_BROKER', '') || '').trim();
  if (full) {
    return /^mqtts?:\/\//i.test(full) ? full.replace(/\/$/, '') : `mqtt://${full.replace(/\/$/, '')}`;
  }
  const host = String(helper.getEnvVar('THINGSBOARD_HOST', '') || '').trim();
  const port = String(helper.getEnvVar('THINGSBOARD_PORT', '') || '').trim();
  return buildMqttBrokerUrl(host, port);
}

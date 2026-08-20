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

export const DEFAULT_DEVICE_TOPIC_BASE = 'v1/device';
export const DEFAULT_MQTT_HOST = 'host.docker.internal';
export const DEFAULT_MQTT_PORT = '11883';

export function getDeviceTopicBase(): string {
  const fromEnv = (process.env.IOT_DEVICE_TOPIC_BASE || DEFAULT_DEVICE_TOPIC_BASE).trim();
  return fromEnv.replace(/^\/+|\/+$/g, '') || DEFAULT_DEVICE_TOPIC_BASE;
}

export function safeDeviceTopicSegment(value: string): string {
  const cleaned = String(value || '')
    .replace(/[#+/]/g, '_')
    .trim()
    .slice(0, 180);
  return cleaned || '_none';
}

function joinDeviceTopic(deviceId: string, suffix: string): string {
  return [getDeviceTopicBase(), safeDeviceTopicSegment(deviceId), suffix.replace(/^\/+/, '')].join('/');
}

export function buildDeviceTelemetryTopic(deviceId: string): string {
  return joinDeviceTopic(deviceId, 'telemetry');
}

export function buildDeviceAttributesTopic(deviceId: string): string {
  return joinDeviceTopic(deviceId, 'attributes');
}

export function buildDeviceLifecycleTopic(deviceId: string): string {
  return joinDeviceTopic(deviceId, 'lifecycle');
}

export function buildDeviceRpcSubscribeTopic(deviceId: string): string {
  return joinDeviceTopic(deviceId, 'rpc/+');
}

export function buildDeviceRpcTopic(deviceId: string, commandId = '+'): string {
  return joinDeviceTopic(deviceId, `rpc/${safeDeviceTopicSegment(commandId)}`);
}

export function buildDeviceRpcResponseTopic(deviceId: string, commandId = '+'): string {
  return joinDeviceTopic(deviceId, `rpc/response/${safeDeviceTopicSegment(commandId)}`);
}

export function buildMqttBrokerUrl(host?: string, port?: string | number): string {
  const resolvedHost = (host || DEFAULT_MQTT_HOST).trim() || DEFAULT_MQTT_HOST;
  const resolvedPort = String(port || DEFAULT_MQTT_PORT).trim() || DEFAULT_MQTT_PORT;
  return `mqtt://${resolvedHost}:${resolvedPort}`;
}

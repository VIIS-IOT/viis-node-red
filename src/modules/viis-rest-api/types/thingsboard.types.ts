/**
 * @fileoverview ThingsBoard RPC types and interfaces
 * Defines TypeScript interfaces for ThingsBoard RPC messages and telemetry data
 */

/**
 * ThingsBoard RPC method types
 */
export enum RpcMethod {
    SET_TELEMETRY = 'setTelemetry',
    GET_TELEMETRY = 'getTelemetry',
    SET_ATTRIBUTES = 'setAttributes',
    GET_ATTRIBUTES = 'getAttributes',
    CONTROL_DEVICE = 'controlDevice',
    UPDATE_FIRMWARE = 'updateFirmware',
    REBOOT_DEVICE = 'rebootDevice',
    CUSTOM_COMMAND = 'customCommand'
}

/**
 * Telemetry data value types
 */
export type TelemetryValue = string | number | boolean | object;

/**
 * Raw telemetry data from RPC params
 */
export interface RawTelemetryData {
    [key: string]: any;
}

/**
 * Processed telemetry record with type detection
 */
export interface ProcessedTelemetryRecord {
    key: string;
    value: TelemetryValue;
    type: 'string' | 'number' | 'boolean' | 'object';
    timestamp: number;
}

/**
 * ThingsBoard RPC request payload structure
 */
export interface ThingsBoardRpcRequest {
    method: string;
    params?: RawTelemetryData;
    timeout?: number;
    persistent?: boolean;
    retries?: number;
}

/**
 * ThingsBoard RPC response structure
 */
export interface ThingsBoardRpcResponse {
    success: boolean;
    result?: any;
    error?: string;
    timestamp: number;
    deviceId: string;
    method: string;
    processingTime: number;
}

/**
 * MQTT message structure for ThingsBoard
 */
export interface ThingsBoardMqttMessage {
    deviceId: string;
    topic: string;
    payload: string;
    qos: 0 | 1 | 2;
    retain: boolean;
    timestamp: number;
}

/**
 * Telemetry transformation result
 */
export interface TelemetryTransformationResult {
    records: ProcessedTelemetryRecord[];
    totalRecords: number;
    transformationTime: number;
    errors: string[];
}

/**
 * RPC processing context
 */
export interface RpcProcessingContext {
    deviceId: string;
    method: string;
    requestId: string;
    startTime: number;
    clientIp?: string;
    userAgent?: string;
}

/**
 * MQTT publishing options for ThingsBoard
 */
export interface ThingsBoardMqttOptions {
    qos: 0 | 1 | 2;
    retain: boolean;
    timeout: number;
    retries: number;
    retryDelay: number;
}

/**
 * Device status for ThingsBoard
 */
export interface DeviceStatus {
    deviceId: string;
    status: 'online' | 'offline' | 'unknown';
    lastSeen: number;
    attributes?: Record<string, any>;
}

/**
 * RPC execution result
 */
export interface RpcExecutionResult {
    success: boolean;
    deviceId: string;
    method: string;
    telemetryRecords: ProcessedTelemetryRecord[];
    mqttPublished: boolean;
    mqttTopic: string;
    processingTime: number;
    errors: string[];
    warnings: string[];
}

/**
 * ThingsBoard configuration
 */
export interface ThingsBoardConfig {
    host: string;
    port: number;
    deviceToken: string;
    password?: string;
    clientId: string;
    qos: 0 | 1 | 2;
    keepalive: number;
    connectTimeout: number;
    reconnectPeriod: number;
}

/**
 * RPC validation result
 */
export interface RpcValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    sanitizedPayload?: ThingsBoardRpcRequest;
}

/**
 * Telemetry data type detection result
 */
export interface TypeDetectionResult {
    type: 'string' | 'number' | 'boolean' | 'object';
    confidence: number;
    originalValue: any;
    processedValue: TelemetryValue;
}

/**
 * MQTT retry configuration
 */
export interface MqttRetryConfig {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
    maxRetryDelay: number;
}

/**
 * RPC processing statistics
 */
export interface RpcProcessingStats {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageProcessingTime: number;
    mqttPublishSuccessRate: number;
    lastProcessedAt: number;
}

/**
 * Error context for detailed error reporting
 */
export interface RpcErrorContext {
    deviceId: string;
    method: string;
    requestId: string;
    stage: 'validation' | 'transformation' | 'mqtt_publish' | 'response_generation';
    originalPayload?: any;
    processedData?: any;
    mqttTopic?: string;
}

/**
 * ThingsBoard topic patterns
 */
export const THINGSBOARD_TOPICS = {
    RPC_REQUEST: 'v1/devices/me/rpc/request',
    RPC_RESPONSE: 'v1/devices/me/rpc/response',
    TELEMETRY: 'v1/devices/me/telemetry',
    ATTRIBUTES: 'v1/devices/me/attributes',
    DEVICE_STATUS: 'v1/devices/me/attributes'
} as const;

/**
 * Default RPC processing options
 */
export const DEFAULT_RPC_OPTIONS: ThingsBoardMqttOptions = {
    qos: 1,
    retain: false,
    timeout: 30000,
    retries: 3,
    retryDelay: 1000
};

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: MqttRetryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
    maxRetryDelay: 10000
};

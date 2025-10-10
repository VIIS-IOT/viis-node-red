import { NodeDef, Node } from "node-red";

/**
 * Node configuration interface
 */
export interface ViisModbusPollerNodeDef extends NodeDef {
    name: string;
    coilPollingInterval: number;
    inputPollingInterval: number;
    holdingPollingInterval: number;
    coilQuantity: number;
    inputQuantity: number;
    holdingQuantity: number;
    enableDebugLog: boolean;
    thresholdConfig: string; // JSON string
    periodicSnapshotInterval: number;
    boardMode?: 'auto' | 'single' | 'multi'; // Board selection mode
    boardId?: string; // Board ID for multi-board mode
}

/**
 * Polling configuration for each register type
 */
export interface PollingConfig {
    interval: number;
    quantity: number;
    startAddress: number;
}

/**
 * Threshold configuration mapping
 */
export interface ThresholdConfig {
    [key: string]: number;
}

/**
 * Modbus data structure
 */
export interface ModbusData {
    [key: string]: number | boolean;
}

/**
 * Service options interface
 */
export interface ServiceOptions {
    node: Node;
    nodeId: string;
}

/**
 * Node status interface
 */
export interface NodeStatus {
    fill: string;
    shape: string;
    text: string;
}

/**
 * Telemetry data interface
 */
export interface TelemetryData {
    [key: string]: number | boolean | string;
}

/**
 * Polling state interface
 */
export interface PollingState {
    isPolling: boolean;
    lastPollTime: number;
    consecutiveFailures: number;
    timer?: NodeJS.Timeout;
}

/**
 * Environment configuration interface
 */
export interface EnvironmentConfig {
    deviceId: string;
    modbusCoils: Record<string, number>;
    modbusInputRegisters: Record<string, number>;
    modbusHoldingRegisters: Record<string, number>;
    boardId?: string; // Optional board ID for multi-board mode
}

/**
 * Modbus client configuration interface
 */
export interface ModbusClientConfig {
    type: "TCP" | "RTU";
    host: string;
    tcpPort: number;
    serialPort: string;
    baudRate: number;
    parity: "none" | "even" | "odd";
    unitId: number;
    timeout: number;
    reconnectInterval: number;
}

/**
 * MQTT client configuration interface
 */
export interface MqttClientConfig {
    broker: string;
    clientId: string;
    username: string;
    password: string;
    qos: 0 | 1 | 2;
}

/**
 * Telemetry save parameters interface
 */
export interface TelemetrySaveParams {
    data: TelemetryData;
    deviceId: string;
    timestamp?: number;
}

/**
 * MQTT publish parameters interface
 */
export interface MqttPublishParams {
    data: TelemetryData;
    thingsboardTopic: string;
    emqxTopic: string;
}

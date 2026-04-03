/**
 * Type definitions for VIIS RPC Control Node
 */

import { NodeDef } from "node-red";

// Node configuration interface
export interface ViisRpcControlNodeDef extends NodeDef {
    name: string;
    mqttBroker: "thingsboard" | "local";
    configKeys: string;
    scaleConfigs: string;
    boardMode?: 'auto' | 'single' | 'multi'; // Board selection mode
    boardId?: string; // Board ID for multi-board mode (Note: auto-detected from key mapping in most cases)
}

// Scale configuration for value transformation
export interface ScaleConfig {
    key: string;
    operation: "multiply" | "divide";
    factor: number;
    direction: "read" | "write";
}

// Configuration keys with their expected types
export interface ConfigKey {
    [key: string]: "number" | "boolean" | "string";
}

// Configuration key values storage
export interface ConfigKeyValues {
    [key: string]: number | boolean | string;
}

// RPC message structure
export interface RpcMessage {
    method?: string;
    params?: Record<string, any>;
    timeout?: number;
    [key: string]: any;
}

// Modbus mapping result
export interface ModbusMappingResult {
    address: number;
    fc: number;
    value: number | boolean;
    boardId?: string; // Optional: Board ID in multi-board mode (auto-detected)
}

// Manual override storage
export interface ManualOverride {
    fc: number;
    value: any;
    timestamp: number;
}

export interface ManualOverrides {
    [addressKey: string]: ManualOverride;
}

// MQTT payload structure
export interface MqttPayload {
    ts: number;
    [key: string]: any;
    note?: string;
}

// Environment configuration
export interface EnvironmentConfig {
    deviceId: string;
    modbusCoils: Record<string, number>;
    modbusInputRegisters: Record<string, number>;
    modbusHoldingRegisters: Record<string, number>;
}

// Modbus client configuration
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

// MQTT client configuration
export interface MqttClientConfig {
    broker: string;
    clientId: string;
    username: string;
    password: string;
    qos: number;
}

// Service initialization options
export interface ServiceOptions {
    node: any; // Node-RED node instance
    flowContext: any;
    globalContext: any;
}

// Configuration service interface
export interface IConfigService {
    getConfigKeys(): ConfigKey;
    getScaleConfigs(): ScaleConfig[];
    getConfigKeyValues(): ConfigKeyValues;
    setConfigKeyValues(values: ConfigKeyValues): void;
    updateScaleConfigs(configs: ScaleConfig[]): void;
    updateConfigKeys(keys: ConfigKey): void;
    validateScaleConfigs(configs: ScaleConfig[]): void;
    validateConfigKeys(keys: ConfigKey): void;
    addConfigKey(key: string, value: any): void;
    removeConfigKey(key: string): void;
}

// Validation service interface
export interface IValidationService {
    validateAndConvertValue(key: string, value: any): any;
    convertValueByType(key: string, value: any, expectedType: "number" | "boolean" | "string"): any;
}

// Modbus service interface
export interface IModbusService {
    findModbusMapping(key: string): ModbusMappingResult | null;
    writeToModbus(key: string, mapping: ModbusMappingResult, value: number | boolean): Promise<void>;
    readFromModbus(key: string, mapping: ModbusMappingResult): Promise<number | boolean>;
    checkConnection(boardId?: string): Promise<void>;
    getModbusHoldingRegisters(): Record<string, number>;
    getModbusCoils(): Record<string, number>;
    updateGlobalContextCacheAfterVerification(key: string, value: number | boolean, fc: number): void;
    // HOLDING_SETML_BOM offset feature methods
    isHoldingSetmlBomOffsetEnabled(): boolean;
    getHoldingSetmlBomOffset(key: string): number | null;
    getHoldingSetmlBomOffsetConfig(): any;
}

// MQTT service interface
export interface IMqttService {
    publishResult(key: string, value: number | boolean): void;
    publishResultImmediate(key: string, value: number | boolean): Promise<void>;
    publishConfigUpdate(key: string, value: any, note?: string): Promise<void>;
    isConnected(): boolean;
    publishError(errorMessage: string): Promise<void>;
}

// Message handler interface
export interface IMessageHandler {
    generateMessageId(payload: any): string;
    isMessageProcessed(messageId: string): boolean;
    markMessageProcessed(messageId: string): void;
    clearProcessedMessages(): void;
}

// RPC handler interface
export interface IRpcHandler {
    handleRpcRequest(rpcBody: RpcMessage): Promise<void>;
}

// Scaling utility interface
export interface IScalingUtils {
    scaleValue(key: string, value: number, direction: "read" | "write"): number;
}

// Logger interface
export interface ILogger {
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}

// Input message structure for node input handling
export interface InputMessage {
    payload?: any;
    method?: string;
    params?: Record<string, any>;
    timeout?: number;
    scaleConfigs?: ScaleConfig[] | string;
    configKeys?: ConfigKey | string;
}

// Client registry interface (for dependency injection)
export interface IClientRegistry {
    getModbusClient(config: ModbusClientConfig, node: any): any;
    getThingsboardMqttClient(config: MqttClientConfig, node: any): Promise<any>;
    getLocalMqttClient(config: MqttClientConfig, node: any): Promise<any>;
    releaseClient(type: string, node: any): void;
    logConnectionCounts(node: any): void;
}

// Service factory interface
export interface IServiceFactory {
    createConfigService(options: ServiceOptions): IConfigService;
    createValidationService(options: ServiceOptions): IValidationService;
    createModbusService(options: ServiceOptions): IModbusService;
    createMqttService(options: ServiceOptions): IMqttService;
    createMessageHandler(options: ServiceOptions): IMessageHandler;
    createRpcHandler(options: ServiceOptions): IRpcHandler;
}

// Type guards
export type SupportedDataType = "number" | "boolean" | "string";
export type ScaleOperation = "multiply" | "divide";
export type ScaleDirection = "read" | "write";
export type ModbusParity = "none" | "even" | "odd";
export type ModbusType = "TCP" | "RTU";
export type MqttBrokerType = "thingsboard" | "local";

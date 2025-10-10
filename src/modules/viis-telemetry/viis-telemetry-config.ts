/**
 * Configuration management for viis-telemetry node
 */

import { NodeDef, NodeContext } from "node-red";
import {
  MIN_POLLING_INTERVAL,
  DEFAULT_POLLING_INTERVALS,
  DEFAULT_REGISTER_CONFIG,
  MQTT_TOPICS
} from "./viis-telemetry-constants";
import { GlobalContextHelper } from "../../ultils/global-context-helper";

/** Extended node definition for viis-telemetry */
export interface ViisTelemetryNodeDef extends NodeDef {
  pollIntervalCoil: string;
  pollIntervalInput: string;
  pollIntervalHolding: string;
  coilStartAddress: string;
  coilQuantity: string;
  inputStartAddress: string;
  inputQuantity: string;
  holdingStartAddress: string;
  holdingQuantity: string;
  scaleConfigs: string;
  enableDebugLog: boolean;
  thresholdConfig: string;
  pollingInterval: string;
  periodicSnapshotIntervalCoil: string;
  periodicSnapshotIntervalInput: string;
  boardMode?: 'auto' | 'single' | 'multi';
  boardId?: string;
  periodicSnapshotIntervalHolding: string;
}

/** Polling configuration for different register types */
export interface PollingConfig {
  coil: {
    interval: number;
    startAddress: number;
    quantity: number;
    periodicSnapshotInterval: number;
  };
  input: {
    interval: number;
    startAddress: number;
    quantity: number;
    periodicSnapshotInterval: number;
  };
  holding: {
    interval: number;
    startAddress: number;
    quantity: number;
    periodicSnapshotInterval: number;
  };
}

/** MQTT configuration */
export interface MqttTopicConfig {
  emqx: string;
  thingsboard: string;
}

/** Environment-based configuration */
export interface EnvironmentConfig {
  deviceId: string;
  modbusCoils: { [key: string]: number };
  modbusInputRegisters: { [key: string]: number };
  modbusHoldingRegisters: { [key: string]: number };
}

/**
 * Configuration manager for viis-telemetry node
 */
export class ViisTelemetryConfigManager {
  private readonly nodeConfig: ViisTelemetryNodeDef;
  private readonly nodeContext?: NodeContext;
  private readonly globalHelper?: GlobalContextHelper;

  constructor(nodeConfig: ViisTelemetryNodeDef, nodeContext?: NodeContext) {
    this.nodeConfig = nodeConfig;
    this.nodeContext = nodeContext;
    this.globalHelper = nodeContext ? new GlobalContextHelper(nodeContext) : undefined;
  }

  /**
   * Get validated polling configuration
   */
  getPollingConfig(): PollingConfig {
    return {
      coil: {
        interval: this.validatePollingInterval(this.nodeConfig.pollIntervalCoil, DEFAULT_POLLING_INTERVALS.COIL),
        startAddress: this.parseIntWithDefault(this.nodeConfig.coilStartAddress, DEFAULT_REGISTER_CONFIG.COIL.START_ADDRESS),
        quantity: this.parseIntWithDefault(this.nodeConfig.coilQuantity, DEFAULT_REGISTER_CONFIG.COIL.QUANTITY),
        periodicSnapshotInterval: this.parseIntWithDefault(this.nodeConfig.periodicSnapshotIntervalCoil, 0),
      },
      input: {
        interval: this.validatePollingInterval(this.nodeConfig.pollIntervalInput, DEFAULT_POLLING_INTERVALS.INPUT),
        startAddress: this.parseIntWithDefault(this.nodeConfig.inputStartAddress, DEFAULT_REGISTER_CONFIG.INPUT.START_ADDRESS),
        quantity: this.parseIntWithDefault(this.nodeConfig.inputQuantity, DEFAULT_REGISTER_CONFIG.INPUT.QUANTITY),
        periodicSnapshotInterval: this.parseIntWithDefault(this.nodeConfig.periodicSnapshotIntervalInput, 0),
      },
      holding: {
        interval: this.validatePollingInterval(this.nodeConfig.pollIntervalHolding, DEFAULT_POLLING_INTERVALS.HOLDING),
        startAddress: this.parseIntWithDefault(this.nodeConfig.holdingStartAddress, DEFAULT_REGISTER_CONFIG.HOLDING.START_ADDRESS),
        quantity: this.parseIntWithDefault(this.nodeConfig.holdingQuantity, DEFAULT_REGISTER_CONFIG.HOLDING.QUANTITY),
        periodicSnapshotInterval: this.parseIntWithDefault(this.nodeConfig.periodicSnapshotIntervalHolding, 0),
      },
    };
  }

  /**
   * Get MQTT topic configuration
   */
  getMqttTopicConfig(deviceId: string): MqttTopicConfig {
    return {
      emqx: MQTT_TOPICS.EMQX_PATTERN.replace('{deviceId}', deviceId),
      thingsboard: MQTT_TOPICS.THINGSBOARD,
    };
  }

  /**
   * Get environment-based configuration
   */
  getEnvironmentConfig(): EnvironmentConfig {
    if (this.globalHelper) {
      return {
        deviceId: this.globalHelper.getEnvVar('DEVICE_ID', 'unknown'),
        modbusCoils: this.globalHelper.getJsonEnvVar('MODBUS_COILS', {}),
        modbusInputRegisters: this.globalHelper.getJsonEnvVar('MODBUS_INPUT_REGISTERS', {}),
        modbusHoldingRegisters: this.globalHelper.getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {}),
      };
    }

    // Fallback to process.env if no global helper
    return {
      deviceId: process.env.DEVICE_ID || 'unknown',
      modbusCoils: this.parseJsonWithDefault(process.env.MODBUS_COILS, {}),
      modbusInputRegisters: this.parseJsonWithDefault(process.env.MODBUS_INPUT_REGISTERS, {}),
      modbusHoldingRegisters: this.parseJsonWithDefault(process.env.MODBUS_HOLDING_REGISTERS, {}),
    };
  }

  /**
   * Get debug log setting
   */
  getDebugLogEnabled(): boolean {
    return this.nodeConfig.enableDebugLog ?? false;
  }

  /**
   * Get threshold configuration
   */
  getThresholdConfig(): { [key: string]: number } {
    return this.parseJsonWithDefault(this.nodeConfig.thresholdConfig, {});
  }

  /**
   * Validate and ensure minimum polling interval
   */
  private validatePollingInterval(value: string, defaultValue: number): number {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < MIN_POLLING_INTERVAL) {
      return Math.max(defaultValue, MIN_POLLING_INTERVAL);
    }
    return parsed;
  }

  /**
   * Parse integer with default fallback
   */
  private parseIntWithDefault(value: string, defaultValue: number): number {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Parse JSON with default fallback
   */
  private parseJsonWithDefault<T>(value: string | undefined, defaultValue: T): T {
    if (!value) return defaultValue;
    try {
      const parsed = JSON.parse(value);
      return parsed ?? defaultValue;
    } catch {
      return defaultValue;
    }
  }
}

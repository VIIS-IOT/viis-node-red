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

  constructor(nodeConfig: ViisTelemetryNodeDef, nodeContext?: NodeContext) {
    this.nodeConfig = nodeConfig;
    this.nodeContext = nodeContext;
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
    // Try to get from global context first, fallback to process.env
    const globalContext = this.nodeContext?.global;

    const getEnvVar = (envVarName: string, defaultValue?: any): any => {
      if (globalContext) {
        // Map environment variable names to global context names
        const mapping: Record<string, string> = {
          'DEVICE_ID': 'device_id',
          'MODBUS_COILS': 'modbusCoils',
          'MODBUS_INPUT_REGISTERS': 'modbusInputRegisters',
          'MODBUS_HOLDING_REGISTERS': 'modbusHoldingRegisters'
        };

        const globalVarName = mapping[envVarName];
        if (globalVarName) {
          const globalValue = globalContext.get(globalVarName);
          if (globalValue !== undefined) {
            return globalValue;
          }
        }
      }

      // Fallback to process.env
      return process.env[envVarName] || defaultValue;
    };

    const getJsonEnvVar = (envVarName: string, defaultValue: any = {}): any => {
      const value = getEnvVar(envVarName);

      if (!value) {
        return defaultValue;
      }

      // If it's already an object (from global context), return it
      if (typeof value === 'object') {
        return value;
      }

      // If it's a string (from process.env), try to parse it
      if (typeof value === 'string') {
        return this.parseJsonWithDefault(value, defaultValue);
      }

      return defaultValue;
    };

    return {
      deviceId: getEnvVar('DEVICE_ID', "unknown"),
      modbusCoils: getJsonEnvVar('MODBUS_COILS', {}),
      modbusInputRegisters: getJsonEnvVar('MODBUS_INPUT_REGISTERS', {}),
      modbusHoldingRegisters: getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {}),
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

/**
 * Telemetry processing service for viis-telemetry node
 */

import { Node, NodeContext } from "node-red";
import { MqttClientCore } from "../../core/mqtt-client";
import { 
  TelemetryData, 
  ThresholdConfig, 
  publishTelemetry, 
  getChangedKeys, 
  debugLog 
} from "./viis-telemetry-utils";
import { CONTEXT_KEYS } from "./viis-telemetry-constants";

/** Telemetry processing configuration */
export interface TelemetryProcessorConfig {
  emqxTopic: string;
  thingsboardTopic: string;
  debugLogKey: string;
  thresholdConfigKey: string;
}

/** Telemetry data with source information */
export interface TelemetryDataEvent {
  data: TelemetryData;
  source: string;
}

/** Periodic snapshot configuration */
export interface PeriodicSnapshotConfig {
  coil: number;
  input: number;
  holding: number;
}

/**
 * Processes telemetry data and handles publishing logic
 */
export class ViisTelemetryProcessor {
  private readonly node: Node;
  private readonly nodeContext: NodeContext;
  private readonly flowContext: NodeContext;
  private readonly localMqttClient: MqttClientCore;
  private readonly thingsboardMqttClient: MqttClientCore;
  private readonly config: TelemetryProcessorConfig;
  private readonly periodicSnapshotConfig: PeriodicSnapshotConfig;

  constructor(
    node: Node,
    nodeContext: NodeContext,
    flowContext: NodeContext,
    localMqttClient: MqttClientCore,
    thingsboardMqttClient: MqttClientCore,
    config: TelemetryProcessorConfig,
    periodicSnapshotConfig: PeriodicSnapshotConfig
  ) {
    this.node = node;
    this.nodeContext = nodeContext;
    this.flowContext = flowContext;
    this.localMqttClient = localMqttClient;
    this.thingsboardMqttClient = thingsboardMqttClient;
    this.config = config;
    this.periodicSnapshotConfig = periodicSnapshotConfig;
  }

  /**
   * Process telemetry data and determine if publishing is needed
   */
  async processTelemetryData(event: TelemetryDataEvent): Promise<void> {
    const { data: currentState, source } = event;
    
    const previousState = this.getPreviousState();
    const thresholdConfig = this.getThresholdConfig();
    const changedKeys = getChangedKeys(currentState, previousState, thresholdConfig);
    
    const now = Date.now();
    const lastSent = this.getLastSent();
    const periodicInterval = this.getPeriodicSnapshotInterval(source);

    // Check if we should publish based on changes
    if (Object.keys(changedKeys).length > 0) {
      await this.publishTelemetryData(changedKeys);
      this.setLastSent(now);
      this.logDebug(`[${source}] Published telemetry (threshold) ${JSON.stringify(thresholdConfig)}: ${JSON.stringify(changedKeys)}`);
    } 
    // Check if we should publish based on periodic snapshot
    else if (periodicInterval > 0 && now - lastSent >= periodicInterval) {
      await this.publishTelemetryData(currentState);
      this.setLastSent(now);
      this.logDebug(`[${source}] Published telemetry (periodic): ${JSON.stringify(currentState)}`);
    } 
    // No publishing needed
    else {
      this.logDebug(`[${source}] No telemetry sent (no change, not timer)`);
    }

    // Update previous state and send output
    this.updatePreviousState(currentState);
    this.sendNodeOutput(currentState);
    this.updateNodeStatus(source);
  }

  /**
   * Update threshold configuration
   */
  updateThresholdConfig(newConfig: ThresholdConfig): void {
    this.flowContext.set(this.config.thresholdConfigKey, newConfig);
    this.logDebug(`[Config] Threshold config updated: ${JSON.stringify(newConfig)}`);
  }

  /**
   * Update debug log setting
   */
  updateDebugLogSetting(enabled: boolean): void {
    this.flowContext.set(this.config.debugLogKey, enabled);
    this.logDebug(`Debug log is ${enabled ? 'enabled' : 'disabled'} (updated via msg)`);
  }

  /**
   * Reset processor state
   */
  resetState(): void {
    this.nodeContext.set(CONTEXT_KEYS.PREVIOUS_STATE, {});
    this.nodeContext.set(CONTEXT_KEYS.LAST_SENT, 0);
  }

  /**
   * Get previous telemetry state
   */
  private getPreviousState(): TelemetryData {
    return this.nodeContext.get(CONTEXT_KEYS.PREVIOUS_STATE) as TelemetryData || {};
  }

  /**
   * Update previous telemetry state
   */
  private updatePreviousState(currentState: TelemetryData): void {
    const previousState = this.getPreviousState();
    Object.assign(previousState, currentState);
    this.nodeContext.set(CONTEXT_KEYS.PREVIOUS_STATE, previousState);
  }

  /**
   * Get threshold configuration
   */
  private getThresholdConfig(): ThresholdConfig {
    return this.flowContext.get(this.config.thresholdConfigKey) as ThresholdConfig || {};
  }

  /**
   * Get last sent timestamp
   */
  private getLastSent(): number {
    return this.nodeContext.get(CONTEXT_KEYS.LAST_SENT) as number || 0;
  }

  /**
   * Set last sent timestamp
   */
  private setLastSent(timestamp: number): void {
    this.nodeContext.set(CONTEXT_KEYS.LAST_SENT, timestamp);
  }

  /**
   * Get periodic snapshot interval for source
   */
  private getPeriodicSnapshotInterval(source: string): number {
    switch (source) {
      case 'Coils':
        return this.periodicSnapshotConfig.coil;
      case 'Input Registers':
        return this.periodicSnapshotConfig.input;
      case 'Holding Registers':
        return this.periodicSnapshotConfig.holding;
      default:
        return 0;
    }
  }

  /**
   * Publish telemetry data to both MQTT brokers
   */
  private async publishTelemetryData(data: TelemetryData): Promise<void> {
    try {
      publishTelemetry({
        data,
        emqxClient: this.localMqttClient,
        thingsboardClient: this.thingsboardMqttClient,
        emqxTopic: this.config.emqxTopic,
        thingsboardTopic: this.config.thingsboardTopic,
      });
    } catch (error) {
      this.node.error(`Failed to publish telemetry: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Send data to node output
   */
  private sendNodeOutput(data: TelemetryData): void {
    this.node.send({ payload: data });
  }

  /**
   * Update node visual status
   */
  private updateNodeStatus(source: string): void {
    this.node.status({ 
      fill: 'green', 
      shape: 'dot', 
      text: `${source}: Data processed` 
    });
  }

  /**
   * Log debug message if enabled
   */
  private logDebug(message: string): void {
    const debugEnabled = this.flowContext.get(this.config.debugLogKey) as boolean || false;
    debugLog({
      enable: debugEnabled,
      node: this.node,
      message,
    });
  }
}

/**
 * Polling service for viis-telemetry node
 */

import { EventEmitter } from "events";
import { Node, NodeContext } from "node-red";
import { ModbusClientCore, ModbusData } from "../../core/modbus-client";
import { TelemetryData, ScaleConfig } from "./viis-telemetry-utils";
import { applyScaling } from "./viis-telemetry-utils";
import { ErrorNotificationService, BusinessLogicError } from "../../services/error-notification.service";
import {
  MAX_CONSECUTIVE_FAILURES,
  POLLING_BACKOFF_TIME,
  MAX_RETRY_ATTEMPTS,
  RETRY_DELAY,
  REGISTER_TYPES,
  GLOBAL_CONTEXT_KEYS
} from "./viis-telemetry-constants";

/** Polling state for a register type */
interface PollingState {
  isPolling: boolean;
  consecutiveFailures: number;
  interval: NodeJS.Timeout | null;
}

/** Register configuration */
interface RegisterConfig {
  startAddress: number;
  quantity: number;
  mapping: { [key: string]: number };
}

/** Polling configuration for a register type */
interface PollingConfig {
  interval: number;
  startAddress: number;
  quantity: number;
}

/**
 * Manages polling operations for different Modbus register types
 */
export class ViisTelemetryPollingService extends EventEmitter {
  private readonly node: Node;
  private readonly nodeContext: NodeContext;
  private readonly modbusClient: ModbusClientCore;
  private readonly errorNotificationService: ErrorNotificationService;

  private readonly pollingStates: {
    coils: PollingState;
    inputRegisters: PollingState;
    holdingRegisters: PollingState;
  };

  private isPollingPaused = false;
  private isConfigUpdating = false;
  private currentBoardId: string | undefined;
  private deviceId: string;

  constructor(
    node: Node,
    nodeContext: NodeContext,
    modbusClient: ModbusClientCore,
    boardId?: string,
    deviceId?: string
  ) {
    super();
    this.node = node;
    this.nodeContext = nodeContext;
    this.modbusClient = modbusClient;
    this.errorNotificationService = new ErrorNotificationService(nodeContext);
    this.currentBoardId = boardId;
    this.deviceId = deviceId || node.id;

    this.pollingStates = {
      coils: { isPolling: false, consecutiveFailures: 0, interval: null },
      inputRegisters: { isPolling: false, consecutiveFailures: 0, interval: null },
      holdingRegisters: { isPolling: false, consecutiveFailures: 0, interval: null },
    };
  }

  /**
   * Start polling for all register types
   */
  startPolling(
    coilConfig: PollingConfig,
    inputConfig: PollingConfig,
    holdingConfig: PollingConfig,
    registerMappings: {
      coils: { [key: string]: number };
      inputRegisters: { [key: string]: number };
      holdingRegisters: { [key: string]: number };
    }
  ): void {
    this.stopPolling();

    // Start coil polling
    this.pollingStates.coils.interval = setInterval(
      () => this.pollCoils(coilConfig, registerMappings.coils),
      coilConfig.interval
    );

    // Start input register polling
    this.pollingStates.inputRegisters.interval = setInterval(
      () => this.pollInputRegisters(inputConfig, registerMappings.inputRegisters),
      inputConfig.interval
    );

    // Start holding register polling
    this.pollingStates.holdingRegisters.interval = setInterval(
      () => this.pollHoldingRegisters(holdingConfig, registerMappings.holdingRegisters),
      holdingConfig.interval
    );

    this.node.status({ fill: "green", shape: "dot", text: "Polling started" });
  }

  /**
   * Stop all polling
   */
  stopPolling(): void {
    Object.values(this.pollingStates).forEach(state => {
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      state.isPolling = false;
    });
  }

  /**
   * Pause polling
   */
  pausePolling(): void {
    this.isPollingPaused = true;
    this.stopPolling();
  }

  /**
   * Resume polling if not paused
   */
  resumePolling(): void {
    this.isPollingPaused = false;
    // Reset failure counters
    Object.values(this.pollingStates).forEach(state => {
      state.consecutiveFailures = 0;
      state.isPolling = false;
    });
  }

  /**
   * Check if polling is active
   */
  isPollingActive(): boolean {
    return !this.isPollingPaused && Object.values(this.pollingStates).some(state => state.interval !== null);
  }

  /**
   * Set config updating flag
   */
  setConfigUpdating(updating: boolean): void {
    this.isConfigUpdating = updating;
  }

  /**
   * Poll coils
   */
  private async pollCoils(config: PollingConfig, mapping: { [key: string]: number }): Promise<void> {
    const state = this.pollingStates.coils;

    if (state.isPolling || this.isPollingPaused || this.isConfigUpdating) return;

    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.handleMaxFailures('coils', state);
      return;
    }

    state.isPolling = true;

    try {
      const result = await this.retryOperation(
        () => this.modbusClient.readCoils(config.startAddress, config.quantity)
      );

      const currentState = this.processCoilData(result, mapping, config.startAddress);
      this.node.context().global.set(GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA, currentState);

      this.emitTelemetryData(currentState, REGISTER_TYPES.COILS);
      state.consecutiveFailures = 0;

    } catch (error) {
      await this.handlePollingError('coils', state, error as Error);
    } finally {
      state.isPolling = false;
      if (this.isConfigUpdating) {
        this.resetPreviousState();
      }
    }
  }

  /**
   * Poll input registers
   */
  private async pollInputRegisters(config: PollingConfig, mapping: { [key: string]: number }): Promise<void> {
    const state = this.pollingStates.inputRegisters;

    if (state.isPolling || this.isPollingPaused || this.isConfigUpdating) return;

    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.handleMaxFailures('inputRegisters', state);
      return;
    }

    state.isPolling = true;

    try {
      const result = await this.retryOperation(
        () => this.modbusClient.readInputRegisters(config.startAddress, config.quantity)
      );

      const currentState = this.processRegisterData(result, mapping, 'read', 'input');
      this.node.context().global.set(GLOBAL_CONTEXT_KEYS.INPUT_REGISTER_DATA, currentState);

      this.emitTelemetryData(currentState, REGISTER_TYPES.INPUT_REGISTERS);
      state.consecutiveFailures = 0;

    } catch (error) {
      await this.handlePollingError('inputRegisters', state, error as Error);
    } finally {
      state.isPolling = false;
      if (this.isConfigUpdating) {
        this.resetPreviousState();
      }
    }
  }

  /**
   * Poll holding registers
   */
  private async pollHoldingRegisters(config: PollingConfig, mapping: { [key: string]: number }): Promise<void> {
    const state = this.pollingStates.holdingRegisters;

    if (state.isPolling || this.isPollingPaused || this.isConfigUpdating) return;

    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.handleMaxFailures('holdingRegisters', state);
      return;
    }

    state.isPolling = true;

    try {
      const result = await this.retryOperation(
        () => this.modbusClient.readHoldingRegisters(config.startAddress, config.quantity)
      );

      const currentState = this.processRegisterData(result, mapping, 'read', 'holding');
      this.node.context().global.set(GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA, currentState);

      this.emitTelemetryData(currentState, REGISTER_TYPES.HOLDING_REGISTERS);
      state.consecutiveFailures = 0;

    } catch (error) {
      await this.handlePollingError('holdingRegisters', state, error as Error);
    } finally {
      state.isPolling = false;
      if (this.isConfigUpdating) {
        this.resetPreviousState();
      }
    }
  }

  /**
   * Process coil data
   */
  private processCoilData(
    result: ModbusData,
    mapping: { [key: string]: number },
    startAddress: number
  ): TelemetryData {
    const currentState: TelemetryData = {};
    const data = result.data as boolean[];

    data.forEach((value, index) => {
      const key = Object.keys(mapping).find(k => mapping[k] === index + startAddress);
      if (key) {
        currentState[key] = value;
        // Special handling for main pump state
        if (key === "main_pump") {
          this.nodeContext.set('mainPumpState', value);
        }
      }
    });

    return currentState;
  }

  /**
   * Process register data with scaling
   */
  private processRegisterData(
    result: ModbusData,
    mapping: { [key: string]: number },
    direction: 'read' | 'write',
    registerType: 'holding' | 'input' = 'input'
  ): TelemetryData {
    const currentState: TelemetryData = {};
    const values = result.data as number[];
    const scaleConfigs = this.node.context().global.get(GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS) as ScaleConfig[] || [];

    Object.entries(mapping).forEach(([key, index]) => {
      let value = applyScaling(key, values[index], direction, scaleConfigs);
      
      // Divide flow sensor values by 10 for holding registers
      if (registerType === 'holding' && /^fs0[1-6]$/.test(key)) {
        value = value / 10;
      }
      
      currentState[key] = value;
    });

    return currentState;
  }

  /**
   * Emit telemetry data event
   */
  private emitTelemetryData(data: TelemetryData, source: string): void {
    this.emit('telemetry-data', { data, source });
  }

  /**
   * Handle maximum failures reached
   */
  private handleMaxFailures(type: string, state: PollingState): void {
    this.node.warn(`${type} polling suspended due to ${state.consecutiveFailures} failures. Retrying in ${POLLING_BACKOFF_TIME / 1000}s`);
    setTimeout(() => {
      state.consecutiveFailures = 0;
      state.isPolling = false;
    }, POLLING_BACKOFF_TIME);
  }

  /**
   * Handle polling error
   */
  private async handlePollingError(type: string, state: PollingState, error: Error): Promise<void> {
    state.consecutiveFailures++;
    this.node.error(`${type} polling error: ${error.message}`);
    this.node.warn(`Consecutive ${type} failures: ${state.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`);
    
    // Proactively write error notification when max failures reached
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await this.writeModbusConnectionError(type, error);
    }
  }

  /**
   * Retry operation with exponential backoff
   */
  private async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (attempt < MAX_RETRY_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Reset previous state
   */
  private resetPreviousState(): void {
    this.nodeContext.set('previousState', {});
    this.isConfigUpdating = false;
  }

  /**
   * Proactively write Modbus connection error notification
   */
  private async writeModbusConnectionError(registerType: string, error: Error): Promise<void> {
    try {
      const errorData: BusinessLogicError = {
        err_code: `MODBUS_${registerType.toUpperCase()}_CONNECTION_FAILURE`,
        message: `Failed to read ${registerType} after ${MAX_RETRY_ATTEMPTS} retry attempts: ${error.message}`,
        severity: 'high',
        type: 'error',
        entity: this.deviceId,
        entity_label: `Device ${this.deviceId}`,
        metadata: {
          register_type: registerType,
          board_id: this.currentBoardId,
          error_message: error.message,
          consecutive_failures: MAX_CONSECUTIVE_FAILURES,
          max_retry_attempts: MAX_RETRY_ATTEMPTS,
          timestamp: new Date().toISOString()
        }
      };

      await this.errorNotificationService.createFromBusinessLogic(errorData);
      this.node.warn(`Error notification created for ${registerType} connection failure`);
    } catch (notificationError: any) {
      // Silently skip if database not ready
      if (notificationError?.message !== 'Database not initialized') {
        this.node.error(`Failed to create error notification: ${notificationError.message}`);
      }
    }
  }
}

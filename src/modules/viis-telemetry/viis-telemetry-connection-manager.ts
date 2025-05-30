/**
 * Connection manager for viis-telemetry node
 */

import { Node } from "node-red";
import { ModbusClientCore } from "../../core/modbus-client";
import { MqttClientCore } from "../../core/mqtt-client";
import { MySqlClientCore } from "../../core/mysql-client";

/** Connection status interface */
export interface ConnectionStatus {
  modbus: boolean;
  localMqtt: boolean;
  thingsboardMqtt: boolean;
  mysql: boolean;
}

/** Connection event types */
export type ConnectionEvent = 'connected' | 'disconnected' | 'all-connected' | 'any-disconnected';

/** Connection event handler */
export type ConnectionEventHandler = (status: ConnectionStatus) => void;

/**
 * Manages connections and their status for viis-telemetry node
 */
export class ViisTelemetryConnectionManager {
  private readonly node: Node;
  private readonly modbusClient: ModbusClientCore;
  private readonly localMqttClient: MqttClientCore;
  private readonly thingsboardMqttClient: MqttClientCore;
  private readonly mysqlClient: MySqlClientCore;
  
  private eventHandlers: Map<ConnectionEvent, ConnectionEventHandler[]> = new Map();
  private currentStatus: ConnectionStatus;

  constructor(
    node: Node,
    modbusClient: ModbusClientCore,
    localMqttClient: MqttClientCore,
    thingsboardMqttClient: MqttClientCore,
    mysqlClient: MySqlClientCore
  ) {
    this.node = node;
    this.modbusClient = modbusClient;
    this.localMqttClient = localMqttClient;
    this.thingsboardMqttClient = thingsboardMqttClient;
    this.mysqlClient = mysqlClient;

    this.currentStatus = this.getCurrentStatus();
    this.setupEventListeners();
  }

  /**
   * Get current connection status
   */
  getCurrentStatus(): ConnectionStatus {
    return {
      modbus: this.modbusClient.isConnectedCheck(),
      localMqtt: this.localMqttClient.isConnected(),
      thingsboardMqtt: this.thingsboardMqttClient.isConnected(),
      mysql: true, // MySQL uses connection pool, assume always available
    };
  }

  /**
   * Check if all clients are connected
   */
  areAllClientsConnected(): boolean {
    const status = this.getCurrentStatus();
    return status.modbus && status.localMqtt && status.thingsboardMqtt && status.mysql;
  }

  /**
   * Register event handler
   */
  on(event: ConnectionEvent, handler: ConnectionEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * Remove event handler
   */
  off(event: ConnectionEvent, handler: ConnectionEventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit connection event
   */
  private emit(event: ConnectionEvent, status: ConnectionStatus): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(status));
    }
  }

  /**
   * Setup event listeners for all clients
   */
  private setupEventListeners(): void {
    // Modbus client events
    this.modbusClient.on("modbus-status", (status: { status: string; error?: string }) => {
      this.handleConnectionChange('modbus', status.status === 'connected');
    });

    // Local MQTT client events
    this.localMqttClient.on("mqtt-status", (status: { status: string; error?: string }) => {
      this.handleConnectionChange('localMqtt', status.status === 'connected');
    });

    // ThingsBoard MQTT client events
    this.thingsboardMqttClient.on("mqtt-status", (status: { status: string; error?: string }) => {
      this.handleConnectionChange('thingsboardMqtt', status.status === 'connected');
    });

    // MySQL client events (if needed)
    this.mysqlClient.on("mysql-status", (status: { status: string; error?: string }) => {
      this.handleConnectionChange('mysql', status.status === 'connected');
    });
  }

  /**
   * Handle connection status change
   */
  private handleConnectionChange(clientType: keyof ConnectionStatus, isConnected: boolean): void {
    const previousStatus = { ...this.currentStatus };
    this.currentStatus[clientType] = isConnected;

    // Update node status
    this.updateNodeStatus();

    // Emit specific events
    if (isConnected) {
      this.emit('connected', this.currentStatus);
    } else {
      this.emit('disconnected', this.currentStatus);
    }

    // Check for all connected/any disconnected
    const wasAllConnected = this.areAllConnectedStatus(previousStatus);
    const isAllConnected = this.areAllClientsConnected();

    if (!wasAllConnected && isAllConnected) {
      this.emit('all-connected', this.currentStatus);
    } else if (wasAllConnected && !isAllConnected) {
      this.emit('any-disconnected', this.currentStatus);
    }
  }

  /**
   * Check if all clients are connected in given status
   */
  private areAllConnectedStatus(status: ConnectionStatus): boolean {
    return status.modbus && status.localMqtt && status.thingsboardMqtt && status.mysql;
  }

  /**
   * Update node visual status
   */
  private updateNodeStatus(): void {
    if (this.areAllClientsConnected()) {
      this.node.status({ fill: "green", shape: "dot", text: "All clients connected" });
    } else {
      const disconnected = Object.entries(this.currentStatus)
        .filter(([_, connected]) => !connected)
        .map(([client, _]) => client);
      
      this.node.status({ 
        fill: "red", 
        shape: "ring", 
        text: `Disconnected: ${disconnected.join(', ')}` 
      });
    }
  }

  /**
   * Get clients for external use
   */
  getClients() {
    return {
      modbus: this.modbusClient,
      localMqtt: this.localMqttClient,
      thingsboardMqtt: this.thingsboardMqttClient,
      mysql: this.mysqlClient,
    };
  }

  /**
   * Cleanup connections
   */
  cleanup(): void {
    this.eventHandlers.clear();
  }
}

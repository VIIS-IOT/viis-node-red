/**
 * TCP Gateway Client for AIS data
 * Handles connection to AIS gateway with auto-reconnect
 */

import * as net from "net";
import { EventEmitter } from "events";
import { RECONNECT_DELAY_MS } from "../constants";
import { ILogger } from "../utils/logger";

export interface TcpGatewayConfig {
  host: string;
  port: number;
  reconnectDelayMs?: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface TcpGatewayEvents {
  connect: () => void;
  data: (line: string) => void;
  error: (error: Error) => void;
  close: () => void;
  statusChange: (status: ConnectionStatus) => void;
}

export class TcpGatewayClient extends EventEmitter {
  private client: net.Socket | null = null;
  private buffer: string = "";
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isClosing: boolean = false;
  private config: Required<TcpGatewayConfig>;
  private logger: ILogger;
  private _status: ConnectionStatus = "disconnected";

  constructor(config: TcpGatewayConfig, logger: ILogger) {
    super();
    this.config = {
      host: config.host,
      port: config.port,
      reconnectDelayMs: config.reconnectDelayMs ?? RECONNECT_DELAY_MS
    };
    this.logger = logger;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get isConnected(): boolean {
    return this.client?.readable === true;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit("statusChange", status);
    }
  }

  /**
   * Connect to the AIS gateway
   */
  connect(): void {
    if (this.isClosing) return;

    this.logger.info(`[AIS] Connecting to ${this.config.host}:${this.config.port}...`);
    this.setStatus("connecting");

    this.client = new net.Socket();

    this.client.on("connect", () => {
      this.logger.info("[AIS] Connected to AIS Gateway");
      this.setStatus("connected");
      this.buffer = "";
      this.emit("connect");
    });

    this.client.on("data", (data: Buffer) => {
      this.handleData(data);
    });

    this.client.on("error", (err: Error) => {
      this.logger.error(`[AIS] Connection error: ${err.message}`);
      this.setStatus("error");
      this.emit("error", err);
    });

    this.client.on("close", () => {
      this.logger.info("[AIS] Connection closed");
      this.setStatus("disconnected");
      this.emit("close");

      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    });

    this.client.connect(this.config.port, this.config.host);
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        this.emit("data", line);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.logger.debug(`[AIS] Scheduling reconnect in ${this.config.reconnectDelayMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.config.reconnectDelayMs);
  }

  /**
   * Disconnect from the gateway
   */
  disconnect(): void {
    this.isClosing = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    this.setStatus("disconnected");
  }

  /**
   * Check if client is connected and readable
   */
  isReadable(): boolean {
    return this.client?.readable === true;
  }
}

// Type-safe event emitter interface
export interface TcpGatewayClient {
  on<K extends keyof TcpGatewayEvents>(event: K, listener: TcpGatewayEvents[K]): this;
  emit<K extends keyof TcpGatewayEvents>(event: K, ...args: Parameters<TcpGatewayEvents[K]>): boolean;
}

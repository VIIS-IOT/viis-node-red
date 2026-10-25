import type { ModbusClientCore, ModbusData, ModbusWriteOptions } from "./modbus-client";

type ModbusStatusListener = (...args: any[]) => void;

type StatusEmitter = {
  on?: (event: string, listener: ModbusStatusListener) => void;
  removeListener?: (event: string, listener: ModbusStatusListener) => void;
  off?: (event: string, listener: ModbusStatusListener) => void;
};

export type SharedModbusTransport = Pick<
  ModbusClientCore,
  | "readCoils"
  | "readInputRegisters"
  | "readHoldingRegisters"
  | "writeCoil"
  | "writeRegister"
  | "isConnectedCheck"
  | "disconnect"
> &
  Partial<Pick<ModbusClientCore, "reconnect" | "readDiscreteInputs" | "getConnectionState">>;

export class BoardScopedModbusClient {
  /** Listeners added through this wrapper, so a retarget can move them to the new transport. */
  private readonly listeners: Array<{ event: string; listener: ModbusStatusListener }> = [];

  constructor(
    private transport: SharedModbusTransport,
    private unitId: number,
  ) {}

  /**
   * Points every holder of this board client at another transport / unit id (the board's config changed
   * after the client was handed out). Status listeners move with it.
   */
  retarget(transport: SharedModbusTransport, unitId: number): void {
    if (transport !== this.transport) {
      for (const { event, listener } of this.listeners) this.detach(event, listener);
      this.transport = transport;
      for (const { event, listener } of this.listeners) this.statusEmitter.on?.(event, listener);
    }
    this.unitId = unitId;
  }

  /**
   * Multi-board clients share one transport per socket. Forward status events
   * so each viis-modbus-flex instance can subscribe without requiring the
   * wrapper itself to be an EventEmitter.
   */
  on(event: string, listener: ModbusStatusListener): this {
    this.statusEmitter.on?.(event, listener);
    this.listeners.push({ event, listener });
    return this;
  }

  removeListener(event: string, listener: ModbusStatusListener): this {
    this.detach(event, listener);
    const index = this.listeners.findIndex(l => l.event === event && l.listener === listener);
    if (index >= 0) this.listeners.splice(index, 1);
    return this;
  }

  private detach(event: string, listener: ModbusStatusListener): void {
    if (typeof this.statusEmitter.removeListener === "function") {
      this.statusEmitter.removeListener(event, listener);
    } else {
      this.statusEmitter.off?.(event, listener);
    }
  }

  off(event: string, listener: ModbusStatusListener): this {
    return this.removeListener(event, listener);
  }

  private get statusEmitter(): StatusEmitter {
    return this.transport as SharedModbusTransport & StatusEmitter;
  }

  readCoils(address: number, length: number): Promise<ModbusData> {
    return this.transport.readCoils(address, length, this.unitId);
  }

  readDiscreteInputs(address: number, length: number): Promise<ModbusData> {
    // Never fall back to readCoils: FC01 addresses a different table.
    if (!this.transport.readDiscreteInputs) {
      return Promise.reject(new Error("Modbus transport does not support FC02 (read discrete inputs)"));
    }
    return this.transport.readDiscreteInputs(address, length, this.unitId);
  }

  readInputRegisters(address: number, length: number): Promise<ModbusData> {
    return this.transport.readInputRegisters(address, length, this.unitId);
  }

  readHoldingRegisters(address: number, length: number): Promise<ModbusData> {
    return this.transport.readHoldingRegisters(address, length, this.unitId);
  }

  /** The board's own unitId is always used; the third argument only mirrors ModbusClientCore. */
  writeCoil(address: number, value: boolean, _unitId?: number, options?: ModbusWriteOptions): Promise<void> {
    return options
      ? this.transport.writeCoil(address, value, this.unitId, options)
      : this.transport.writeCoil(address, value, this.unitId);
  }

  writeRegister(address: number, value: number, _unitId?: number, options?: ModbusWriteOptions): Promise<void> {
    return options
      ? this.transport.writeRegister(address, value, this.unitId, options)
      : this.transport.writeRegister(address, value, this.unitId);
  }

  get isConnected(): boolean {
    return this.transport.isConnectedCheck();
  }

  isConnectedCheck(): boolean {
    return this.transport.isConnectedCheck();
  }

  /**
   * True while the shared transport's circuit breaker is open: it is not being reconnected for the next
   * CIRCUIT_BREAKER_RECOVERY_MS, so a read or write would only wait out its timeout.
   */
  isCircuitBreakerOpen(): boolean {
    return this.transport.getConnectionState?.() === "circuit_breaker_open";
  }

  disconnect(): void {
    this.transport.disconnect();
  }

  /**
   * Manual reconnect of the shared transport (used by viis-rpc-control's
   * checkConnection). Without this, callers got "reconnect is not a function"
   * in multi-board mode.
   */
  async reconnect(): Promise<void> {
    if (typeof this.transport.reconnect !== "function") {
      throw new Error("Shared Modbus transport does not support manual reconnect");
    }
    await this.transport.reconnect();
  }
}

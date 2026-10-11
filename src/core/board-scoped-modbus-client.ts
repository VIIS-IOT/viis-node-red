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
  Partial<Pick<ModbusClientCore, "reconnect">>;

export class BoardScopedModbusClient {
  constructor(
    private readonly transport: SharedModbusTransport,
    private readonly unitId: number,
  ) {}

  /**
   * Multi-board clients share one transport per socket. Forward status events
   * so each viis-modbus-flex instance can subscribe without requiring the
   * wrapper itself to be an EventEmitter.
   */
  on(event: string, listener: ModbusStatusListener): this {
    this.statusEmitter.on?.(event, listener);
    return this;
  }

  removeListener(event: string, listener: ModbusStatusListener): this {
    if (typeof this.statusEmitter.removeListener === "function") {
      this.statusEmitter.removeListener(event, listener);
    } else {
      this.statusEmitter.off?.(event, listener);
    }
    return this;
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

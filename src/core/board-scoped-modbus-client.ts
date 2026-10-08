import type { ModbusClientCore, ModbusData } from "./modbus-client";
import type { OperationContext } from "./observability/types";

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
> & { getDiagnosticStatus?: (unitId?: number) => Record<string, unknown> };

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

  readCoils(address: number, length: number, _unitId?: number, context?: OperationContext): Promise<ModbusData> {
    return context
      ? this.transport.readCoils(address, length, this.unitId, context)
      : this.transport.readCoils(address, length, this.unitId);
  }

  readInputRegisters(address: number, length: number, _unitId?: number, context?: OperationContext): Promise<ModbusData> {
    return context
      ? this.transport.readInputRegisters(address, length, this.unitId, context)
      : this.transport.readInputRegisters(address, length, this.unitId);
  }

  readHoldingRegisters(address: number, length: number, _unitId?: number, context?: OperationContext): Promise<ModbusData> {
    return context
      ? this.transport.readHoldingRegisters(address, length, this.unitId, context)
      : this.transport.readHoldingRegisters(address, length, this.unitId);
  }

  writeCoil(address: number, value: boolean, _unitId?: number, context?: OperationContext): Promise<void> {
    return context
      ? this.transport.writeCoil(address, value, this.unitId, context)
      : this.transport.writeCoil(address, value, this.unitId);
  }

  writeRegister(address: number, value: number, _unitId?: number, context?: OperationContext): Promise<void> {
    return context
      ? this.transport.writeRegister(address, value, this.unitId, context)
      : this.transport.writeRegister(address, value, this.unitId);
  }

  getDiagnosticStatus(): Record<string, unknown> {
    return this.transport.getDiagnosticStatus?.(this.unitId) || {
      unitId: this.unitId,
      connected: this.transport.isConnectedCheck(),
    };
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
}

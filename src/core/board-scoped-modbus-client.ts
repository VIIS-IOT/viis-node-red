import type { ModbusClientCore, ModbusData } from "./modbus-client";

export type SharedModbusTransport = Pick<
  ModbusClientCore,
  | "readCoils"
  | "readInputRegisters"
  | "readHoldingRegisters"
  | "writeCoil"
  | "writeRegister"
  | "isConnectedCheck"
  | "disconnect"
>;

export class BoardScopedModbusClient {
  constructor(
    private readonly transport: SharedModbusTransport,
    private readonly unitId: number,
  ) {}

  readCoils(address: number, length: number): Promise<ModbusData> {
    return this.transport.readCoils(address, length, this.unitId);
  }

  readInputRegisters(address: number, length: number): Promise<ModbusData> {
    return this.transport.readInputRegisters(address, length, this.unitId);
  }

  readHoldingRegisters(address: number, length: number): Promise<ModbusData> {
    return this.transport.readHoldingRegisters(address, length, this.unitId);
  }

  writeCoil(address: number, value: boolean): Promise<void> {
    return this.transport.writeCoil(address, value, this.unitId);
  }

  writeRegister(address: number, value: number): Promise<void> {
    return this.transport.writeRegister(address, value, this.unitId);
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

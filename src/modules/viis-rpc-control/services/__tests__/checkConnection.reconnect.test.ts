import { BoardScopedModbusClient } from "../../../../core/board-scoped-modbus-client";
import { ModbusService } from "../modbusService";

function createService(client: unknown) {
  const node = {
    id: "rpc-node",
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    context: () => ({ global: { get: jest.fn(), set: jest.fn() } }),
  };
  const ctx = { get: jest.fn(), set: jest.fn() };
  return new ModbusService(
    { node, flowContext: ctx, globalContext: ctx } as any,
    client,
    { scaleValue: (_k: string, v: number) => v } as any,
  );
}

function transport(connected: boolean) {
  return {
    readCoils: jest.fn(),
    readInputRegisters: jest.fn(),
    readHoldingRegisters: jest.fn(),
    writeCoil: jest.fn(),
    writeRegister: jest.fn(),
    isConnectedCheck: jest.fn().mockReturnValue(connected),
    disconnect: jest.fn(),
    reconnect: jest.fn().mockResolvedValue(undefined),
  };
}

describe("ModbusService.checkConnection", () => {
  it("reconnects a disconnected BoardScopedModbusClient through its shared transport (no 'reconnect is not a function')", async () => {
    const t = transport(false);
    const service = createService(new BoardScopedModbusClient(t, 1));

    await expect(service.checkConnection()).resolves.toBeUndefined();
    expect(t.reconnect).toHaveBeenCalledTimes(1);
  });

  it("does not reconnect when the client is connected", async () => {
    const t = transport(true);
    const service = createService(new BoardScopedModbusClient(t, 1));

    await service.checkConnection();
    expect(t.reconnect).not.toHaveBeenCalled();
  });

  it("does not throw for a client without manual reconnect (relies on auto reconnect)", async () => {
    const client = { isConnectedCheck: () => false };
    const service = createService(client);

    await expect(service.checkConnection()).resolves.toBeUndefined();
  });
});

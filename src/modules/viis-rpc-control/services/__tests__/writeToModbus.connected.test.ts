import { BoardScopedModbusClient } from "../../../../core/board-scoped-modbus-client";
import { ModbusService } from "../modbusService";

function createService(client: unknown) {
  const flow = new Map<string, unknown>();
  const global = new Map<string, unknown>();
  const node = {
    id: "rpc-node",
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    context: () => ({
      global: {
        get: (key: string) => global.get(key),
        set: (key: string, value: unknown) => global.set(key, value),
      },
    }),
  };

  return new ModbusService(
    {
      node,
      flowContext: {
        get: (key: string) => flow.get(key),
        set: (key: string, value: unknown) => flow.set(key, value),
      },
      globalContext: {
        get: (key: string) => global.get(key),
        set: (key: string, value: unknown) => global.set(key, value),
      },
    } as any,
    client,
    {
      scaleValue: (_key: string, value: number) => value,
    } as any,
  );
}

describe("ModbusService.writeToModbus", () => {
  it("writes a coil through BoardScopedModbusClient when the shared transport is connected", async () => {
    const transport = {
      readCoils: jest.fn(),
      readInputRegisters: jest.fn(),
      readHoldingRegisters: jest.fn(),
      writeCoil: jest.fn().mockResolvedValue(undefined),
      writeRegister: jest.fn(),
      isConnectedCheck: jest.fn().mockReturnValue(true),
      disconnect: jest.fn(),
    };
    const client = new BoardScopedModbusClient(transport, 3);
    const service = createService(client);

    await service.writeToModbus("main_pump", { address: 0, fc: 5, value: true }, true);

    expect(transport.writeCoil).toHaveBeenCalledWith(0, true, 3);
  });
});

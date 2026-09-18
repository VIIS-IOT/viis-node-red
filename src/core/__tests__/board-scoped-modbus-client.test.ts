import { BoardScopedModbusClient } from "../board-scoped-modbus-client";

describe("BoardScopedModbusClient", () => {
  it("forwards reads and writes with the board unit id", async () => {
    const transport = {
      readCoils: jest.fn().mockResolvedValue({ address: 0, data: [true] }),
      readInputRegisters: jest.fn().mockResolvedValue({ address: 1, data: [2] }),
      readHoldingRegisters: jest.fn().mockResolvedValue({ address: 2, data: [9] }),
      writeCoil: jest.fn().mockResolvedValue(undefined),
      writeRegister: jest.fn().mockResolvedValue(undefined),
      isConnectedCheck: jest.fn().mockReturnValue(true),
      disconnect: jest.fn(),
    };

    const client = new BoardScopedModbusClient(transport, 3);

    await client.readCoils(0, 8);
    await client.readInputRegisters(4, 1);
    await client.readHoldingRegisters(10, 2);
    await client.writeCoil(5, true);
    await client.writeRegister(6, 42);

    expect(transport.readCoils).toHaveBeenCalledWith(0, 8, 3);
    expect(transport.readInputRegisters).toHaveBeenCalledWith(4, 1, 3);
    expect(transport.readHoldingRegisters).toHaveBeenCalledWith(10, 2, 3);
    expect(transport.writeCoil).toHaveBeenCalledWith(5, true, 3);
    expect(transport.writeRegister).toHaveBeenCalledWith(6, 42, 3);
    expect(client.isConnectedCheck()).toBe(true);
  });
});

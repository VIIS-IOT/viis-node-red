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
    expect(client.isConnected).toBe(true);
  });

  it("exposes isConnected as a live property so RPC writeToModbus does not treat a connected wrapper as disconnected", () => {
    const transport = {
      readCoils: jest.fn(),
      readInputRegisters: jest.fn(),
      readHoldingRegisters: jest.fn(),
      writeCoil: jest.fn(),
      writeRegister: jest.fn(),
      isConnectedCheck: jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
      disconnect: jest.fn(),
    };

    const client = new BoardScopedModbusClient(transport, 3);

    expect(client.isConnected).toBe(true);
    expect(client.isConnected).toBe(false);
    expect(transport.isConnectedCheck).toHaveBeenCalledTimes(2);
  });

  it("forwards modbus-status to every subscriber and lets one subscriber detach", () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const transport = {
      readCoils: jest.fn(),
      readInputRegisters: jest.fn(),
      readHoldingRegisters: jest.fn(),
      writeCoil: jest.fn(),
      writeRegister: jest.fn(),
      isConnectedCheck: jest.fn().mockReturnValue(true),
      disconnect: jest.fn(),
      on: jest.fn((event: string, listener: (event: unknown) => void) => {
        const bucket = listeners.get(event) ?? new Set<(event: unknown) => void>();
        bucket.add(listener);
        listeners.set(event, bucket);
      }),
      removeListener: jest.fn((event: string, listener: (event: unknown) => void) => {
        listeners.get(event)?.delete(listener);
      }),
    };

    const client = new BoardScopedModbusClient(transport, 1);
    const first = jest.fn();
    const second = jest.fn();

    client.on("modbus-status", first);
    client.on("modbus-status", second);
    listeners.get("modbus-status")?.forEach((listener) => listener({ status: "connected" }));

    expect(first).toHaveBeenCalledWith({ status: "connected" });
    expect(second).toHaveBeenCalledWith({ status: "connected" });

    client.removeListener("modbus-status", first);
    listeners.get("modbus-status")?.forEach((listener) => listener({ status: "disconnected" }));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({ status: "disconnected" });
  });
});

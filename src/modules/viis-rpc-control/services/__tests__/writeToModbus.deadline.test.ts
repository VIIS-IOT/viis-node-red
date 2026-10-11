import { BoardScopedModbusClient } from "../../../../core/board-scoped-modbus-client";
import { ModbusService } from "../modbusService";
import { createRpcDeadline, runWithRpcDeadline } from "../../utils/rpc-deadline";

function createService(client: unknown) {
  const node = { id: "rpc-node", log: jest.fn(), warn: jest.fn(), error: jest.fn(), context: () => ({ global: { get: jest.fn(), set: jest.fn() } }) };
  const ctx = { get: jest.fn(), set: jest.fn() };
  return new ModbusService({ node, flowContext: ctx, globalContext: ctx } as any, client, { scaleValue: (_k: string, v: number) => v } as any);
}

function transport() {
  return {
    readCoils: jest.fn(), readInputRegisters: jest.fn(), readHoldingRegisters: jest.fn(),
    writeCoil: jest.fn().mockResolvedValue(undefined), writeRegister: jest.fn().mockResolvedValue(undefined),
    isConnectedCheck: jest.fn().mockReturnValue(true), disconnect: jest.fn(),
  };
}

describe("ModbusService.writeToModbus RPC deadline", () => {
  it("forwards the RPC deadline from the request context to the transport", async () => {
    const t = transport();
    const service = createService(new BoardScopedModbusClient(t, 3));
    const rpc = createRpcDeadline("id", 20000);

    await runWithRpcDeadline(rpc, () => service.writeToModbus("digital_out_2", { address: 101, fc: 6, value: 0 }, 0));

    expect(t.writeRegister).toHaveBeenCalledWith(101, 0, 3, { deadline: rpc.deadline });
  });

  it("refuses to write for an expired RPC (luoi/rpc paths alike)", async () => {
    const t = transport();
    const service = createService(new BoardScopedModbusClient(t, 3));
    const rpc = createRpcDeadline("id", 20000, Date.now() - 30000);

    await expect(runWithRpcDeadline(rpc, () => service.writeToModbus("valve_1", { address: 15, fc: 5, value: true }, true)))
      .rejects.toThrow(/RPC-EXPIRED/);
    expect(t.writeCoil).not.toHaveBeenCalled();
  });
});

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BoardScopedModbusClient } from "../../../../core/board-scoped-modbus-client";
import { ModbusService } from "../modbusService";
import { resetCoilCommandRegistersCache } from "../../../../ultils/coil-command-registers";

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

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccr-rpc-"));
  const file = path.join(dir, "device1.json");
  fs.writeFileSync(file, JSON.stringify({
    modbusMappings: {
      board1: { coils: { pump_tank_b: 1281 }, coilCommandRegisters: { pump_tank_b: 4317 } },
      board2: { coils: { valve_2: 1281 } },
    },
  }));
  process.env.ENV_LOADER_JSON_CONFIG_PATH = file;
  resetCoilCommandRegistersCache();
});
afterEach(() => {
  delete process.env.ENV_LOADER_JSON_CONFIG_PATH;
  resetCoilCommandRegistersCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("ModbusService.writeToModbus with a coil command register (Delta D220..D227)", () => {
  it("writes 1/0 to the command register instead of the coil", async () => {
    const t = transport();
    const service = createService(new BoardScopedModbusClient(t, 1));

    await service.writeToModbus("pump_tank_b", { address: 1281, fc: 5, value: true, boardId: "board1" }, true);
    await service.writeToModbus("pump_tank_b", { address: 1281, fc: 5, value: false, boardId: "board1" }, false);

    expect(t.writeCoil).not.toHaveBeenCalled();
    expect(t.writeRegister.mock.calls.map((c: any[]) => [c[0], c[1]])).toEqual([[4317, 1], [4317, 0]]);
  });

  it("keeps writing the coil for keys without a command register", async () => {
    const t = transport();
    const service = createService(new BoardScopedModbusClient(t, 2));

    await service.writeToModbus("valve_2", { address: 1281, fc: 5, value: true, boardId: "board2" }, true);

    expect(t.writeRegister).not.toHaveBeenCalled();
    expect(t.writeCoil).toHaveBeenCalledWith(1281, true, 2);
  });
});

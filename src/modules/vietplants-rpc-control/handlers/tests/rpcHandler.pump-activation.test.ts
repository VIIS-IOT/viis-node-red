import { RpcHandler, resetVietplantsRpcQueueForTests } from "../rpcHandler";

function createHandler(modbus: Record<string, unknown>, mqtt: Record<string, unknown>) {
  const node = { status: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn(), context: () => ({}) };
  const loggerMethods = ["log", "warn", "error", "debug"];
  const handler = new RpcHandler(
    { node, flowContext: {}, globalContext: {} } as any,
    {} as any,
    { validateAndConvertValue: (_key: string, value: unknown) => value } as any,
    modbus as any,
    mqtt as any,
    { processRpcBody: async () => false, luoiMapping: {} } as any,
  );
  loggerMethods.forEach((name) => jest.spyOn((handler as any).logger, name).mockImplementation(() => undefined));
  return handler;
}

beforeEach(() => {
  resetVietplantsRpcQueueForTests();
});

test("pump ON publishes the board1 coil when board2 reset times out", async () => {
  const writes: string[] = [];
  const published: string[] = [];
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16 }),
    findModbusMapping: () => ({ address: 16, fc: 5, value: false, boardId: "board1" }),
    findModbusMappingForBoard: (key: string) => ({ address: key.startsWith("RESET") ? 200 : 160, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: async (key: string) => { writes.push(key); },
    readFromModbus: async () => true,
    writeToModbusBoard: async (key: string) => {
      writes.push(key);
      if (key.startsWith("RESET")) throw new Error("Timed out");
    },
    readFromModbusBoard: async () => 1,
    checkConnection: async () => undefined,
  };
  const mqtt = {
    publishResult: jest.fn(async (key: string) => { published.push(key); }),
    publishConfigUpdate: jest.fn(async (key: string) => { published.push(key); }),
    publishError: jest.fn(),
    isConnected: () => true,
  };
  const handler = createHandler(modbus, mqtt);

  await expect(handler.handleRpcRequest({
    method: "set_state",
    params: { COIL_BOM_1: true },
  })).resolves.toBeUndefined();

  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(writes[0]).toBe("COIL_BOM_1");
  expect(published).toContain("COIL_BOM_1");
  expect(mqtt.publishError).not.toHaveBeenCalled();
  expect(published).toContain("RESET_TOTAL_VOLUME_BOM_1_error");
});

test("OFF during bookkeeping skips the board2 status write", async () => {
  const writes: string[] = [];
  let releaseReset: () => void = () => undefined;
  const resetGate = new Promise<void>((resolve) => { releaseReset = resolve; });
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16 }),
    findModbusMapping: () => ({ address: 16, fc: 5, value: false, boardId: "board1" }),
    findModbusMappingForBoard: () => ({ address: 200, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: async (key: string) => { writes.push(`board1:${key}`); },
    readFromModbus: async () => true,
    writeToModbusBoard: async (key: string) => {
      if (key.startsWith("RESET")) await resetGate;
      writes.push(`board2:${key}`);
    },
    readFromModbusBoard: async () => 1,
    checkConnection: async () => undefined,
  };
  const mqtt = {
    publishResult: jest.fn().mockResolvedValue(undefined),
    publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
    publishError: jest.fn(),
    isConnected: () => true,
  };
  const handler = createHandler(modbus, mqtt);
  const on = handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: false } });
  releaseReset();
  await on;
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(writes).toContain("board1:COIL_BOM_1");
  expect(writes).not.toContain("board2:PUMP_STATUS_BOM_1");
});

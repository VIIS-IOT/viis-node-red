import { RpcHandler, resetVietplantsRpcQueueForTests } from "../rpcHandler";

function createHandler(
  modbus: Record<string, unknown>,
  mqtt: Record<string, unknown>,
  validation: Record<string, unknown> = {
    validateAndConvertValue: (_key: string, value: unknown) => value,
  },
) {
  const node = { status: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn(), context: () => ({}) };
  const loggerMethods = ["log", "warn", "error", "debug"];
  const handler = new RpcHandler(
    { node, flowContext: {}, globalContext: {} } as any,
    {} as any,
    validation as any,
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
    writeToModbus: async (key: string, _mapping: unknown, value: unknown) => {
      writes.push(`board1:${key}:${value}`);
    },
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
  await new Promise((resolve) => setTimeout(resolve, 250));

  expect(writes).toContain("board1:COIL_BOM_1:true");
  expect(writes).not.toContain("board2:PUMP_STATUS_BOM_1");
});

test("ON after OFF writes board1 while stale bookkeeping remains in flight", async () => {
  const writes: string[] = [];
  let releaseFirstReset: () => void = () => undefined;
  let releaseSecondReset: () => void = () => undefined;
  const firstResetGate = new Promise<void>((resolve) => { releaseFirstReset = resolve; });
  const secondResetGate = new Promise<void>((resolve) => { releaseSecondReset = resolve; });
  let resetCount = 0;
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16 }),
    findModbusMapping: () => ({ address: 16, fc: 5, value: false, boardId: "board1" }),
    findModbusMappingForBoard: () => ({ address: 200, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: async (key: string, _mapping: unknown, value: unknown) => {
      writes.push(`board1:${key}:${value}`);
    },
    readFromModbus: async () => true,
    writeToModbusBoard: async (key: string) => {
      if (key.startsWith("RESET")) {
        resetCount += 1;
        await (resetCount === 1 ? firstResetGate : secondResetGate);
      }
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

  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: false } });
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });

  expect(writes).toEqual([
    "board1:COIL_BOM_1:true",
    "board1:COIL_BOM_1:false",
    "board1:COIL_BOM_1:true",
  ]);

  releaseFirstReset();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });

  expect(writes.filter((write) => write === "board1:COIL_BOM_1:true")).toHaveLength(2);
  expect(writes).not.toContain("board2:PUMP_STATUS_BOM_1");

  releaseSecondReset();
  await new Promise((resolve) => setTimeout(resolve, 250));
});

test("stale bookkeeping does not release a newer ON pending during its board1 write", async () => {
  const writes: string[] = [];
  let releaseFirstReset: () => void = () => undefined;
  let releaseSecondOnWrite: () => void = () => undefined;
  let markSecondOnWriteStarted: () => void = () => undefined;
  const firstResetGate = new Promise<void>((resolve) => { releaseFirstReset = resolve; });
  const secondOnWriteGate = new Promise<void>((resolve) => { releaseSecondOnWrite = resolve; });
  const secondOnWriteStarted = new Promise<void>((resolve) => { markSecondOnWriteStarted = resolve; });
  let onWriteCount = 0;
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16 }),
    findModbusMapping: () => ({ address: 16, fc: 5, value: false, boardId: "board1" }),
    findModbusMappingForBoard: () => ({ address: 200, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: async (key: string, _mapping: unknown, value: unknown) => {
      if (value === true) {
        onWriteCount += 1;
        if (onWriteCount === 2) {
          markSecondOnWriteStarted();
          await secondOnWriteGate;
        }
      }
      writes.push(`board1:${key}:${value}`);
    },
    readFromModbus: async () => true,
    writeToModbusBoard: async (key: string) => {
      if (key.startsWith("RESET") && onWriteCount === 1) await firstResetGate;
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

  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: false } });
  const secondOn = handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });
  await secondOnWriteStarted;

  releaseFirstReset();
  await new Promise((resolve) => setTimeout(resolve, 20));

  let thirdOnSettled = false;
  const thirdOn = handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } })
    .then(() => { thirdOnSettled = true; });
  await Promise.resolve();

  expect(thirdOnSettled).toBe(true);

  releaseSecondOnWrite();
  await Promise.all([secondOn, thirdOn]);

  expect(writes.filter((write) => write === "board1:COIL_BOM_1:true")).toHaveLength(2);
  await new Promise((resolve) => setTimeout(resolve, 250));
});

test("duplicate ON is dropped during bookkeeping and accepted after it finishes", async () => {
  const board1Writes: unknown[] = [];
  let releaseReset: () => void = () => undefined;
  const resetGate = new Promise<void>((resolve) => { releaseReset = resolve; });
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16 }),
    findModbusMapping: () => ({ address: 16, fc: 5, value: false, boardId: "board1" }),
    findModbusMappingForBoard: () => ({ address: 200, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: async (_key: string, _mapping: unknown, value: unknown) => {
      board1Writes.push(value);
    },
    readFromModbus: async () => true,
    writeToModbusBoard: async (key: string) => {
      if (key.startsWith("RESET") && board1Writes.length === 1) await resetGate;
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

  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });
  expect(board1Writes).toEqual([true]);

  releaseReset();
  await new Promise((resolve) => setTimeout(resolve, 250));
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });

  expect(board1Writes).toEqual([true, true]);
  await new Promise((resolve) => setTimeout(resolve, 250));
});

test("a mixed pump request does not release a duplicate pump pending slot", async () => {
  const board1Writes: string[] = [];
  let releaseResets: () => void = () => undefined;
  const resetGate = new Promise<void>((resolve) => { releaseResets = resolve; });
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16, COIL_BOM_2: 17 }),
    findModbusMapping: (key: string) => ({
      address: key === "COIL_BOM_1" ? 16 : 17,
      fc: 5,
      value: false,
      boardId: "board1",
    }),
    findModbusMappingForBoard: () => ({ address: 200, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: async (key: string) => { board1Writes.push(key); },
    readFromModbus: async () => true,
    writeToModbusBoard: async (key: string) => {
      if (key.startsWith("RESET")) await resetGate;
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

  await handler.handleRpcRequest({
    method: "set_state",
    params: { COIL_BOM_1: true },
  });
  await handler.handleRpcRequest({
    method: "set_state",
    params: { COIL_BOM_1: true, COIL_BOM_2: true },
  });
  await handler.handleRpcRequest({
    method: "set_state",
    params: { COIL_BOM_1: true },
  });

  expect(board1Writes).toEqual(["COIL_BOM_1", "COIL_BOM_2"]);

  releaseResets();
  await new Promise((resolve) => setTimeout(resolve, 250));
});

test("board1 failure releases pending so the next ON runs", async () => {
  const board1Write = jest.fn()
    .mockRejectedValueOnce(new Error("board1 write failed"))
    .mockResolvedValue(undefined);
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16 }),
    findModbusMapping: () => ({ address: 16, fc: 5, value: false, boardId: "board1" }),
    findModbusMappingForBoard: () => ({ address: 200, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: board1Write,
    readFromModbus: async () => true,
    writeToModbusBoard: async () => undefined,
    readFromModbusBoard: async () => 1,
    checkConnection: async () => undefined,
  };
  const mqtt = {
    publishResult: jest.fn().mockResolvedValue(undefined),
    publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
    publishError: jest.fn().mockResolvedValue(undefined),
    isConnected: () => true,
  };
  const handler = createHandler(modbus, mqtt);

  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } }, 1);
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } }, 1);

  expect(board1Write).toHaveBeenCalledTimes(2);
  await new Promise((resolve) => setTimeout(resolve, 250));
});

test("second pump failure in a multi-pump request releases it for a later ON", async () => {
  const board1Write = jest.fn()
    .mockImplementationOnce(async () => undefined)
    .mockRejectedValueOnce(new Error("second pump board1 write failed"))
    .mockResolvedValue(undefined);
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16, COIL_BOM_2: 17 }),
    findModbusMapping: (key: string) => ({
      address: key === "COIL_BOM_1" ? 16 : 17,
      fc: 5,
      value: false,
      boardId: "board1",
    }),
    findModbusMappingForBoard: () => ({ address: 200, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: board1Write,
    readFromModbus: async () => true,
    writeToModbusBoard: async () => undefined,
    readFromModbusBoard: async () => 1,
    checkConnection: async () => undefined,
  };
  const mqtt = {
    publishResult: jest.fn().mockResolvedValue(undefined),
    publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
    publishError: jest.fn().mockResolvedValue(undefined),
    isConnected: () => true,
  };
  const handler = createHandler(modbus, mqtt);

  await handler.handleRpcRequest({
    method: "set_state",
    params: { COIL_BOM_1: true, COIL_BOM_2: true },
  }, 1);
  await handler.handleRpcRequest({
    method: "set_state",
    params: { COIL_BOM_2: true },
  }, 1);

  expect(board1Write.mock.calls.map(([key]) => key)).toEqual([
    "COIL_BOM_1",
    "COIL_BOM_2",
    "COIL_BOM_2",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 250));
});

test("retry does not reactivate pump after bookkeeping finishes", async () => {
  const board1Write = jest.fn().mockResolvedValue(undefined);
  const board2Write = jest.fn().mockResolvedValue(undefined);
  let configAttempts = 0;
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16 }),
    findModbusMapping: (key: string) => key === "COIL_BOM_1"
      ? { address: 16, fc: 5, value: false, boardId: "board1" }
      : null,
    findModbusMappingForBoard: () => ({ address: 200, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: board1Write,
    readFromModbus: async () => true,
    writeToModbusBoard: board2Write,
    readFromModbusBoard: async () => 1,
    checkConnection: async () => undefined,
  };
  const mqtt = {
    publishResult: jest.fn().mockResolvedValue(undefined),
    publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
    publishError: jest.fn().mockResolvedValue(undefined),
    isConnected: () => true,
  };
  const handler = createHandler(modbus, mqtt, {
    validateAndConvertValue: (key: string, value: unknown) => {
      if (key === "CONFIG_THAT_TIMES_OUT" && configAttempts++ === 0) {
        throw new Error("timeout");
      }
      return value;
    },
  });

  await handler.handleRpcRequest({
    method: "set_state",
    params: { COIL_BOM_1: true, CONFIG_THAT_TIMES_OUT: 1 },
  }, 2);

  expect(board1Write).toHaveBeenCalledTimes(1);
  expect(board1Write).toHaveBeenCalledWith(
    "COIL_BOM_1",
    expect.anything(),
    true,
  );
  expect(board2Write.mock.calls.filter(([key]) => key === "RESET_TOTAL_VOLUME_BOM_1")).toHaveLength(1);
});

test("validation failure before bookkeeping releases pending for a later ON", async () => {
  const board1Write = jest.fn().mockResolvedValue(undefined);
  const validate = jest.fn()
    .mockImplementationOnce(() => { throw new Error("invalid pump value"); })
    .mockImplementation((_key: string, value: unknown) => value);
  const modbus = {
    getModbusHoldingRegisters: () => ({}),
    getModbusCoils: () => ({ COIL_BOM_1: 16 }),
    findModbusMapping: () => ({ address: 16, fc: 5, value: false, boardId: "board1" }),
    findModbusMappingForBoard: () => ({ address: 200, fc: 5 }),
    getBoard2Client: async () => ({}),
    writeToModbus: board1Write,
    readFromModbus: async () => true,
    writeToModbusBoard: async () => undefined,
    readFromModbusBoard: async () => 1,
    checkConnection: async () => undefined,
  };
  const mqtt = {
    publishResult: jest.fn().mockResolvedValue(undefined),
    publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
    publishError: jest.fn().mockResolvedValue(undefined),
    isConnected: () => true,
  };
  const handler = createHandler(modbus, mqtt, { validateAndConvertValue: validate });

  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } }, 1);
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } }, 1);

  expect(board1Write).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => setTimeout(resolve, 250));
});

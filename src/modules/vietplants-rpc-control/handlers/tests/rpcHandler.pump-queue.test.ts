import { RpcHandler, notePumpCoilCommand, resetVietplantsRpcQueueForTests } from "../rpcHandler";

function createHandler() {
  const node = { status: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn(), context: () => ({}) };
  return new RpcHandler(
    { node, flowContext: {}, globalContext: {} } as any,
    {} as any,
    {} as any,
    {} as any,
    { publishError: jest.fn() } as any,
    {} as any,
  );
}

beforeEach(() => {
  resetVietplantsRpcQueueForTests();
});

test("two handler instances run set_state one at a time", async () => {
  const order: string[] = [];
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = createHandler();
  const second = createHandler();
  jest.spyOn(first as any, "handleSetStateRequest").mockImplementation(async () => {
    order.push("first-start");
    await firstGate;
    order.push("first-end");
  });
  jest.spyOn(second as any, "handleSetStateRequest").mockImplementation(async () => {
    order.push("second");
  });

  const firstRun = first.handleRpcRequest({ method: "set_state", params: { HOLDING_X: 1 } });
  const secondRun = second.handleRpcRequest({ method: "set_state", params: { HOLDING_Y: 2 } });
  await Promise.resolve();
  expect(order).toEqual(["first-start"]);
  releaseFirst();
  await Promise.all([firstRun, secondRun]);
  expect(order).toEqual(["first-start", "first-end", "second"]);
});

test("duplicate pump ON is dropped until the first command finishes", async () => {
  expect(notePumpCoilCommand("COIL_BOM_1", true)).toBe("run");
  expect(notePumpCoilCommand("COIL_BOM_1", true)).toBe("drop");
  expect(notePumpCoilCommand("COIL_BOM_1", false)).toBe("run");
  expect(notePumpCoilCommand("COIL_BOM_2", true)).toBe("run");
});

test("a second ON is dropped while the first is still running", async () => {
  const handler = createHandler();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const run = jest.spyOn(handler as any, "handleSetStateRequest").mockImplementation(() => gate);
  const first = handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });
  await Promise.resolve();
  await handler.handleRpcRequest({ method: "set_state", params: { COIL_BOM_1: true } });
  expect(run).toHaveBeenCalledTimes(1);
  release();
  await first;
});

test("a duplicate pump ON still applies the other request params", async () => {
  const handler = createHandler();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const run = jest.spyOn(handler as any, "handleSetStateRequest")
    .mockImplementationOnce(() => gate)
    .mockResolvedValue(undefined);

  const first = handler.handleRpcRequest({
    method: "set_state",
    params: { COIL_BOM_1: true },
  });
  await Promise.resolve();
  const second = handler.handleRpcRequest({
    method: "set_state",
    params: { COIL_BOM_1: true, HOLDING_X: 42, schedule_id: "schedule-1" },
  });

  release();
  await Promise.all([first, second]);

  expect(run).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenNthCalledWith(2, {
    HOLDING_X: 42,
    schedule_id: "schedule-1",
  });
});

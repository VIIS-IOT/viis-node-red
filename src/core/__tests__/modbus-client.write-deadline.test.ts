import { ConnectionState, ModbusClientCore } from "../modbus-client";
import type { OperationContext } from "../observability/types";

function makeClient(writeCoil: jest.Mock) {
  const c: any = Object.create(ModbusClientCore.prototype);
  Object.assign(c, {
    node: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), status: jest.fn() },
    diagnostic: { emit: jest.fn() },
    config: { type: "TCP", host: "127.0.0.1", tcpPort: 502, boardType: "STM32", writeTimeout: 5000, maxRetries: 3, unitId: 1 },
    client: { isOpen: true, writeCoil, setID: jest.fn() },
    isConnected: true,
    isShuttingDown: false,
    connectionState: ConnectionState.CONNECTED,
    requestQueue: Promise.resolve(),
    queueLength: 0,
    lastSuccessfulIoByUnit: new Map(),
    emit: jest.fn(),
    ensureConnected: jest.fn().mockResolvedValue(undefined),
    handleError: jest.fn(),
  });
  return c;
}

const ctx = (deadline: number) => ({ traceId: "t", operationId: "op", deadline } as unknown as OperationContext);

describe("ModbusClientCore write deadline (port from demeter-nodered 676605f)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("drops a write whose deadline passed while it waited in the queue (never sent)", async () => {
    const writeCoil = jest.fn().mockResolvedValue({});
    const c = makeClient(writeCoil);
    // A slow request (e.g. a poll read on a frozen device) holds the queue
    c.enqueueRequest(() => new Promise((r) => setTimeout(r, 10000)));

    const p = c.writeCoil(15, true, undefined, ctx(Date.now() + 3000));
    const assertion = expect(p).rejects.toThrow(/QUEUE-EXPIRED/);
    await jest.advanceTimersByTimeAsync(11000);
    await assertion;
    expect(writeCoil).not.toHaveBeenCalled();
    expect(c.handleError).not.toHaveBeenCalled();
    expect(c.diagnostic.emit).toHaveBeenCalledWith("warn", "modbus.write_expired", expect.objectContaining({ phase: "queued", sent: false }));
  });

  it("stops retrying once the deadline passed", async () => {
    const writeCoil = jest.fn().mockRejectedValue(new Error("Timed out"));
    const c = makeClient(writeCoil);

    const p = c.writeCoil(15, true, undefined, ctx(Date.now() + 1500));
    const assertion = expect(p).rejects.toThrow(/WRITE-EXPIRED/);
    await jest.advanceTimersByTimeAsync(20000);
    await assertion;
    // attempt at t=0 and t=1000; the retry at t=3000 is past the deadline
    expect(writeCoil).toHaveBeenCalledTimes(2);
    expect(c.handleError).not.toHaveBeenCalled();
    expect(c.diagnostic.emit).toHaveBeenCalledWith("warn", "modbus.write_expired", expect.objectContaining({ phase: "retry", attempt: 3 }));
  });

  it("without a deadline keeps the previous retry behaviour (pollers / other nodes unaffected)", async () => {
    const writeCoil = jest.fn().mockRejectedValue(new Error("Timed out"));
    const c = makeClient(writeCoil);

    const p = c.writeCoil(15, true, undefined, { traceId: "t", operationId: "op" } as unknown as OperationContext);
    const assertion = expect(p).rejects.toThrow(/WRITE-FAILED/);
    await jest.advanceTimersByTimeAsync(20000);
    await assertion;
    expect(writeCoil).toHaveBeenCalledTimes(4);
  });
});

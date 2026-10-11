import { DiagnosticLogger } from '../../../../core/observability/diagnostic-logger';
import { RpcHandler } from '../rpcHandler';
import { RPC_DEADLINE_CONFIG } from '../../constants';

const TTL = RPC_DEADLINE_CONFIG.SET_STATE_TTL_MS;

function createHandler(modbus: Record<string, unknown> = {}) {
  const publishError = jest.fn().mockResolvedValue(undefined);
  const publishErrorTracked = jest.fn().mockResolvedValue({ operationId: 'err', status: 'acknowledged', acknowledgement: 'mqtt_puback' });
  const node = {
    id: 'n', status: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn(),
    context: () => ({ get: jest.fn(), set: jest.fn() }),
  };
  const handler = new RpcHandler(
    { node, flowContext: {}, globalContext: {} } as any,
    {} as any,
    { validateAndConvertValue: (_k: string, v: unknown) => v } as any,
    {
      getModbusHoldingRegisters: () => ({}),
      getModbusCoils: () => ({}),
      checkConnection: jest.fn().mockResolvedValue(undefined),
      ...modbus,
    } as any,
    {
      publishConfigUpdate: jest.fn(),
      publishConfigUpdateTracked: jest.fn().mockResolvedValue({ operationId: 'cfg', status: 'acknowledged', acknowledgement: 'mqtt_puback' }),
      publishError,
      publishErrorTracked,
      scheduleResultTracked: jest.fn().mockReturnValue({ operationId: 'p', completion: Promise.resolve({ operationId: 'p', status: 'acknowledged', acknowledgement: 'mqtt_puback' }) }),
      isConnected: () => true,
    } as any,
    { processRpcBody: jest.fn().mockResolvedValue(false) } as any,
  );
  return { handler, publishErrorTracked, node };
}

const never = () => new Promise<string>(() => undefined);

describe('RPC deadline on a frozen device (port from demeter-nodered 676605f)', () => {
  let events: Array<{ event: string; fields: any }>;
  let spy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    events = [];
    spy = jest.spyOn(DiagnosticLogger.prototype, 'emit').mockImplementation(function (_level: any, event: string, fields: any = {}) {
      events.push({ event, fields });
    });
  });
  afterEach(() => {
    spy.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('reports an expiry error by the deadline when the device never responds, and resolves', async () => {
    const { handler, publishErrorTracked, node } = createHandler();
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(never);

    let settled: 'resolved' | 'rejected' | null = null;
    handler.handleRpcRequest({ method: 'set_state', params: { digital_out_2: false } })
      .then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });

    await jest.advanceTimersByTimeAsync(TTL - 1);
    expect(publishErrorTracked).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(settled).toBe('resolved');
    expect(publishErrorTracked).toHaveBeenCalledTimes(1);
    expect(publishErrorTracked.mock.calls[0][0]).toContain('RPC-EXPIRED');
    expect(node.status).toHaveBeenCalledWith(expect.objectContaining({ text: 'RPC expired' }));
    const expired = events.find(e => e.event === 'rpc.expired');
    expect(expired?.fields).toEqual(expect.objectContaining({ phase: 'executing', ttlMs: TTL }));
    const finished = events.filter(e => e.event === 'rpc.execution_finished');
    expect(finished).toHaveLength(1);
    expect(finished[0].fields.controlOutcome).toBe('expired');
  });

  it('never retries a Modbus write after the deadline and reports the expiry once', async () => {
    // First write attempt hangs until the device "unfreezes" well after the deadline
    const writeToModbus = jest.fn(() => new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out')), TTL + 5000)));
    const { handler, publishErrorTracked } = createHandler({ writeToModbus });
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(async () => {
      await (handler as any).handleModbusMappedParameter('digital_out_2', 0, { fc: 6, address: 101 });
      return 'success';
    });

    const done = handler.handleRpcRequest({ method: 'set_state', params: { digital_out_2: 0 } });
    await jest.advanceTimersByTimeAsync(120000);
    await done;

    expect(writeToModbus).toHaveBeenCalledTimes(1);
    expect(publishErrorTracked).toHaveBeenCalledTimes(1);
    expect(publishErrorTracked.mock.calls[0][0]).toContain('RPC-EXPIRED');
  });

  it('passes the deadline to ModbusService so queued/retried writes can be dropped at the Modbus layer', async () => {
    let seenDeadline: number | undefined;
    const writeToModbus = jest.fn(async () => {
      seenDeadline = require('../../utils/rpc-deadline').currentRpcDeadline()?.deadline;
    });
    const { handler } = createHandler({
      writeToModbus,
      readFromModbus: jest.fn().mockResolvedValue(0),
      updateGlobalContextCacheAfterVerification: jest.fn(),
    });
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(async () => {
      await (handler as any).handleModbusMappedParameter('digital_out_2', 0, { fc: 6, address: 101 });
      return 'success';
    });

    const t0 = Date.now();
    await handler.handleRpcRequest({ method: 'set_state', params: { digital_out_2: 0 } });

    expect(seenDeadline).toBe(t0 + TTL);
  });

  it('a request that waited past its deadline behind a stuck one is never executed but still reported', async () => {
    const { handler, publishErrorTracked } = createHandler();
    const exec = jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(never);

    handler.handleRpcRequest({ method: 'set_state', params: { a: 1 } });
    await jest.advanceTimersByTimeAsync(1000);
    handler.handleRpcRequest({ method: 'set_state', params: { a: 0 } });

    await jest.advanceTimersByTimeAsync(TTL + RPC_DEADLINE_CONFIG.QUEUE_RELEASE_GRACE_MS + 5000);

    expect(exec).toHaveBeenCalledTimes(1); // only the first one ever started
    expect(publishErrorTracked).toHaveBeenCalledTimes(2);
    expect(events.filter(e => e.event === 'rpc.expired').map(e => e.fields.phase)).toEqual(['executing', 'queued']);
    expect(events.some(e => e.event === 'rpc.queue_released')).toBe(true);
  });

  it('honours rpcBody.timeout (minus margin) as TTL', async () => {
    const { handler, publishErrorTracked } = createHandler();
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(never);

    handler.handleRpcRequest({ method: 'set_state', params: { a: 1 }, timeout: 10000 });
    await jest.advanceTimersByTimeAsync(10000 - RPC_DEADLINE_CONFIG.CLIENT_TIMEOUT_MARGIN_MS);

    expect(publishErrorTracked).toHaveBeenCalledTimes(1);
  });

  it('a fast successful request is not reported expired later', async () => {
    const { handler, publishErrorTracked } = createHandler();
    jest.spyOn(handler as any, 'handleSetStateRequest').mockResolvedValue('success');

    await handler.handleRpcRequest({ method: 'set_state', params: { a: 1 } });
    await jest.advanceTimersByTimeAsync(TTL * 3);

    expect(publishErrorTracked).not.toHaveBeenCalled();
    expect(events.some(e => e.event === 'rpc.expired')).toBe(false);
  });
});

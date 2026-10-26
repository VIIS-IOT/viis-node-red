import { RpcHandler } from '../rpcHandler';
import { RPC_DEADLINE_CONFIG } from '../../constants';

const ID_A = '11111111-2222-4333-8444-555555555555';
const ID_B = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const TTL = RPC_DEADLINE_CONFIG.SET_STATE_TTL_MS;

function createHandler(modbus: Record<string, unknown> = {}) {
  const publishRpcResponse = jest.fn().mockResolvedValue(undefined);
  const node = {
    id: 'n', status: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn(),
    context: () => ({ get: jest.fn(), set: jest.fn() }),
  };
  const handler = new RpcHandler(
    { node, flowContext: {}, globalContext: {} } as any,
    {} as any,
    {} as any,
    {
      getModbusHoldingRegisters: () => ({}),
      getModbusCoils: () => ({}),
      checkConnection: jest.fn().mockResolvedValue(undefined),
      ...modbus,
    } as any,
    { publishConfigUpdate: jest.fn(), publishError: jest.fn().mockResolvedValue(undefined), publishRpcResponse, isConnected: () => true } as any,
    {} as any,
  );
  return { handler, publishRpcResponse };
}

const never = () => new Promise<void>(() => undefined);

describe('RPC deadline (frozen device)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('answers FAILED by the deadline when the device never responds, and resolves (no unhandled rejection)', async () => {
    const { handler, publishRpcResponse } = createHandler();
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(never);

    let settled: 'resolved' | 'rejected' | null = null;
    handler.handleRpcRequest({ method: 'set_state', command_id: ID_A, params: { digital_out_2: false } })
      .then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });

    await jest.advanceTimersByTimeAsync(TTL - 1);
    expect(publishRpcResponse).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(settled).toBe('resolved');
    expect(publishRpcResponse).toHaveBeenCalledTimes(1);
    expect(publishRpcResponse).toHaveBeenCalledWith(ID_A, expect.objectContaining({
      success: false, status: 'FAILED', error: expect.stringContaining('expired'),
    }));
  });

  it('answers FAILED by the deadline for a mobile `set` write too (the watchdog must not see the raw method)', async () => {
    const { handler, publishRpcResponse } = createHandler();
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(never);

    handler.handleRpcRequest({ method: 'set', command_id: ID_A, params: { key: 'valve_2', value: true }, timeout: 5000 });
    await jest.advanceTimersByTimeAsync(5000);

    expect(publishRpcResponse).toHaveBeenCalledTimes(1);
    expect(publishRpcResponse).toHaveBeenCalledWith(ID_A, expect.objectContaining({
      success: false, status: 'FAILED', method: 'set_state', error: expect.stringContaining('expired'),
    }));
  });

  it('never retries a Modbus write after the deadline (stale command is not applied late)', async () => {
    // First write attempt hangs until the device "unfreezes" well after the deadline
    const writeToModbus = jest.fn(() => new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out')), TTL + 5000)));
    const { handler, publishRpcResponse } = createHandler({ writeToModbus });
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(async () => {
      await (handler as any).handleModbusMappedParameter('digital_out_2', 0, { fc: 6, address: 101 });
    });
    (handler as any).validationService = { validateAndConvertValue: (_k: string, v: unknown) => v };

    const done = handler.handleRpcRequest({ method: 'set_state', command_id: ID_A, params: { digital_out_2: 0 } });
    await jest.advanceTimersByTimeAsync(120000);
    await done;

    expect(writeToModbus).toHaveBeenCalledTimes(1);
    expect(publishRpcResponse).toHaveBeenCalledTimes(1);
    expect(publishRpcResponse.mock.calls[0][1]).toMatchObject({ success: false, status: 'FAILED' });
  });

  it('passes the deadline to ModbusService so queued/retried writes can be dropped at the Modbus layer', async () => {
    const writeToModbus = jest.fn().mockResolvedValue(undefined);
    const readFromModbus = jest.fn().mockResolvedValue(0);
    const { handler } = createHandler({
      writeToModbus, readFromModbus,
      updateGlobalContextCacheAfterVerification: jest.fn(),
    });
    (handler as any).validationService = { validateAndConvertValue: (_k: string, v: unknown) => v };
    (handler as any).mqttService.publishResult = jest.fn().mockResolvedValue(undefined);
    let seenDeadline: number | undefined;
    writeToModbus.mockImplementation(async () => {
      seenDeadline = require('../../utils/rpc-deadline').currentRpcDeadline()?.deadline;
    });
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(async () => {
      await (handler as any).handleModbusMappedParameter('digital_out_2', 0, { fc: 6, address: 101 });
    });

    const t0 = Date.now();
    await handler.handleRpcRequest({ method: 'set_state', command_id: ID_A, params: { digital_out_2: 0 } });

    expect(seenDeadline).toBe(t0 + TTL);
  });

  it('a request that waited past its deadline behind a stuck one is never executed but still answered', async () => {
    const { handler, publishRpcResponse } = createHandler();
    const exec = jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(never);

    handler.handleRpcRequest({ method: 'set_state', command_id: ID_A, params: { a: 1 } });
    await jest.advanceTimersByTimeAsync(1000);
    handler.handleRpcRequest({ method: 'set_state', command_id: ID_B, params: { a: 0 } });

    await jest.advanceTimersByTimeAsync(TTL + RPC_DEADLINE_CONFIG.QUEUE_RELEASE_GRACE_MS + 5000);

    expect(exec).toHaveBeenCalledTimes(1); // only the first one ever started
    const ids = publishRpcResponse.mock.calls.map((c) => c[0]);
    expect(ids).toEqual([ID_A, ID_B]);
    publishRpcResponse.mock.calls.forEach((c) => expect(c[1]).toMatchObject({ status: 'FAILED' }));
  });

  it('honours rpcBody.timeout (minus margin) as TTL', async () => {
    const { handler, publishRpcResponse } = createHandler();
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(never);

    handler.handleRpcRequest({ method: 'set_state', command_id: ID_A, params: { a: 1 }, timeout: 10000 });
    await jest.advanceTimersByTimeAsync(10000 - RPC_DEADLINE_CONFIG.CLIENT_TIMEOUT_MARGIN_MS);

    expect(publishRpcResponse).toHaveBeenCalledTimes(1);
  });

  it('a fast successful request is ACKED once and not reported expired later', async () => {
    const { handler, publishRpcResponse } = createHandler();
    jest.spyOn(handler as any, 'handleSetStateRequest').mockResolvedValue(undefined);

    await handler.handleRpcRequest({ method: 'set_state', command_id: ID_A, params: { a: 1 } });
    await jest.advanceTimersByTimeAsync(TTL * 3);

    expect(publishRpcResponse).toHaveBeenCalledTimes(1);
    expect(publishRpcResponse.mock.calls[0][1]).toMatchObject({ status: 'ACKED' });
  });
});

import { MessageHandler } from '../messageHandler';
import { RpcHandler } from '../rpcHandler';

const ID_A = '11111111-2222-4333-8444-555555555555';
const ID_B = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const DEV = 'cbd07e26-7831-4dad-a556-d98da9143522';
const PREFIX = `v1/device/${DEV}/rpc/+`;

function node() {
  return { id: 'rpc-node', log: jest.fn(), warn: jest.fn(), error: jest.fn(), status: jest.fn() };
}

function mqttMsg(commandId: string | null, params: Record<string, unknown>) {
  const payload: Record<string, unknown> = { method: 'set_state', params };
  if (commandId) payload.command_id = commandId;
  return { topic: `v1/device/${DEV}/rpc/${commandId || 'x'}`, payload };
}

describe('MessageHandler dedupe', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('processes the same params again when the command_id is new (legit re-send within 10s)', () => {
    const mh = new MessageHandler({ node: node() } as any);
    const processor = jest.fn();

    mh.processMqttMessage(mqttMsg(ID_A, { digital_out_2: false }), PREFIX, processor);
    jest.advanceTimersByTime(2000);
    mh.processMqttMessage(mqttMsg(ID_B, { digital_out_2: false }), PREFIX, processor);

    expect(processor).toHaveBeenCalledTimes(2);
  });

  it('drops an exact redelivery of the same command_id and reports it as duplicate', () => {
    const mh = new MessageHandler({ node: node() } as any);
    const processor = jest.fn();
    const onDuplicate = jest.fn();

    mh.processMqttMessage(mqttMsg(ID_A, { digital_out_2: true }), PREFIX, processor, onDuplicate);
    jest.advanceTimersByTime(30000);
    mh.processMqttMessage(mqttMsg(ID_A, { digital_out_2: true }), PREFIX, processor, onDuplicate);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledWith(ID_A, expect.anything());
  });

  it('dedupes by command_id taken from the topic when the payload has none', () => {
    const mh = new MessageHandler({ node: node() } as any);
    const processor = jest.fn();
    const msg = { topic: `v1/device/${DEV}/rpc/${ID_A}`, payload: { method: 'set_state', params: { a: 1 } } };

    mh.processMqttMessage(msg, PREFIX, processor);
    mh.processMqttMessage({ ...msg, payload: { method: 'set_state', params: { a: 2 } } }, PREFIX, processor);

    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy params-hash dedupe for messages without any id', () => {
    const mh = new MessageHandler({ node: node() } as any);
    const processor = jest.fn();
    const msg = { topic: `v1/device/${DEV}/rpc/req`, payload: { method: 'set_state', params: { a: 1 } } };

    mh.processMqttMessage(msg, PREFIX, processor);
    mh.processMqttMessage(msg, PREFIX, processor);
    jest.advanceTimersByTime(10001);
    mh.processMqttMessage(msg, PREFIX, processor);

    expect(processor).toHaveBeenCalledTimes(2);
  });
});

describe('RpcHandler.resendRpcAck', () => {
  function handler(publishRpcResponse: jest.Mock) {
    const n = { ...node(), context: () => ({ get: jest.fn(), set: jest.fn() }) };
    return new RpcHandler(
      { node: n, flowContext: {}, globalContext: {} } as any,
      {} as any,
      {} as any,
      { getModbusHoldingRegisters: () => ({}), getModbusCoils: () => ({}) } as any,
      { publishConfigUpdate: jest.fn(), publishError: jest.fn(), publishRpcResponse, isConnected: () => true } as any,
      {} as any,
    );
  }

  it('re-publishes the cached terminal response for a duplicate command_id', async () => {
    const publishRpcResponse = jest.fn().mockResolvedValue(undefined);
    const h = handler(publishRpcResponse);
    jest.spyOn(h as any, 'handleSetStateRequest').mockResolvedValue(undefined);

    await h.handleRpcRequest({ method: 'set_state', command_id: ID_A, params: { power: true } });
    await expect(h.resendRpcAck(ID_A)).resolves.toBe(true);

    expect(publishRpcResponse).toHaveBeenCalledTimes(2);
    expect(publishRpcResponse.mock.calls[1]).toEqual([ID_A, expect.objectContaining({ status: 'ACKED', success: true })]);
  });

  it('does nothing for an unknown / still running command_id', async () => {
    const publishRpcResponse = jest.fn().mockResolvedValue(undefined);
    const h = handler(publishRpcResponse);

    await expect(h.resendRpcAck(ID_B)).resolves.toBe(false);
    expect(publishRpcResponse).not.toHaveBeenCalled();
  });
});

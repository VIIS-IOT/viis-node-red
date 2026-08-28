import { RpcHandler } from '../rpcHandler';

const COMMAND_ID = '11111111-2222-4333-8444-555555555555';

function createHandler(mqtt: {
  publishRpcResponse: jest.Mock;
  publishError?: jest.Mock;
}) {
  const node = {
    status: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    context: () => ({ get: jest.fn(), set: jest.fn() }),
  };
  const handler = new RpcHandler(
    { node, flowContext: {}, globalContext: {} },
    {} as any,
    {} as any,
    {
      getModbusHoldingRegisters: () => ({}),
      getModbusCoils: () => ({ power: 30 }),
    } as any,
    {
      publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
      publishError: mqtt.publishError || jest.fn().mockResolvedValue(undefined),
      publishRpcResponse: mqtt.publishRpcResponse,
      isConnected: () => true,
    } as any,
    {} as any,
  );
  return handler;
}

test('two-way set_state publishes ACKED after a successful write', async () => {
  const publishRpcResponse = jest.fn().mockResolvedValue(undefined);
  const handler = createHandler({ publishRpcResponse });
  jest.spyOn(handler as any, 'handleSetStateRequest').mockResolvedValue(undefined);

  await handler.handleRpcRequest({
    method: 'set_state',
    command_id: COMMAND_ID,
    params: { power: true },
  });

  expect(publishRpcResponse).toHaveBeenCalledTimes(1);
  expect(publishRpcResponse).toHaveBeenCalledWith(COMMAND_ID, expect.objectContaining({
    success: true,
    status: 'ACKED',
    method: 'set_state',
  }));
});

test('failed set_state publishes FAILED so two-way does not sit in TIMEOUT', async () => {
  const publishRpcResponse = jest.fn().mockResolvedValue(undefined);
  const handler = createHandler({ publishRpcResponse });
  jest.spyOn(handler as any, 'handleSetStateRequest').mockRejectedValue(new Error('Modbus write failed'));
  jest.spyOn(handler as any, 'isRetryableError').mockReturnValue(false);

  await handler.handleRpcRequest({
    method: 'set_state',
    command_id: COMMAND_ID,
    params: { power: true },
  });

  expect(publishRpcResponse).toHaveBeenCalledWith(COMMAND_ID, expect.objectContaining({
    success: false,
    status: 'FAILED',
    error: 'Modbus write failed',
  }));
});

test('schedule oneway methods are ignored — no ACK that would steal the command from the schedule node', async () => {
  const publishRpcResponse = jest.fn().mockResolvedValue(undefined);
  const handler = createHandler({ publishRpcResponse });

  await handler.handleRpcRequest({
    method: 'create-schedule-by-backend',
    command_id: COMMAND_ID,
    params: { id: 'sched-1' },
  });

  expect(publishRpcResponse).not.toHaveBeenCalled();
});

test('local wire input without command_id still writes and does not publish an ACK', async () => {
  const publishRpcResponse = jest.fn().mockResolvedValue(undefined);
  const handler = createHandler({ publishRpcResponse });
  const write = jest.spyOn(handler as any, 'handleSetStateRequest').mockResolvedValue(undefined);

  await handler.handleRpcRequest({
    method: 'set_state',
    params: { power: true },
  });

  expect(write).toHaveBeenCalledWith({ power: true });
  expect(publishRpcResponse).not.toHaveBeenCalled();
});

test('ACK MQTT failure does not throw after a successful Modbus write', async () => {
  const publishRpcResponse = jest.fn().mockRejectedValue(new Error('broker down'));
  const handler = createHandler({ publishRpcResponse });
  jest.spyOn(handler as any, 'handleSetStateRequest').mockResolvedValue(undefined);

  await expect(handler.handleRpcRequest({
    method: 'set_state',
    command_id: COMMAND_ID,
    params: { power: true },
  })).resolves.toBeUndefined();
});

test('mobile method control {key,value} is executed as set_state and ACKED', async () => {
  const publishRpcResponse = jest.fn().mockResolvedValue(undefined);
  const handler = createHandler({ publishRpcResponse });
  const write = jest.spyOn(handler as any, 'handleSetStateRequest').mockResolvedValue(undefined);

  await handler.handleRpcRequest({
    method: 'control',
    command_id: COMMAND_ID,
    params: { key: 'power', value: true },
  });

  expect(write).toHaveBeenCalledWith({ power: true });
  expect(publishRpcResponse).toHaveBeenCalledWith(COMMAND_ID, expect.objectContaining({
    success: true,
    status: 'ACKED',
  }));
});

test('mobile method set {key,value} is executed as set_state and ACKED', async () => {
  const publishRpcResponse = jest.fn().mockResolvedValue(undefined);
  const handler = createHandler({ publishRpcResponse });
  const write = jest.spyOn(handler as any, 'handleSetStateRequest').mockResolvedValue(undefined);

  await handler.handleRpcRequest({
    method: 'set',
    command_id: COMMAND_ID,
    params: { key: 'digital_out_2', value: 1 },
  });

  expect(write).toHaveBeenCalledWith({ digital_out_2: 1 });
  expect(publishRpcResponse).toHaveBeenCalledWith(COMMAND_ID, expect.objectContaining({
    success: true,
    status: 'ACKED',
  }));
});

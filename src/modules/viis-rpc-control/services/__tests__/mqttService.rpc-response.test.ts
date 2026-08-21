import { MqttService } from '../mqttService';

const DEVICE_ID = 'b4daa293-9086-47ee-8b62-cdc64a61d4ee';
const COMMAND_ID = '11111111-2222-4333-8444-555555555555';

test('publishRpcResponse uses Demeter rpc/response topic, not telemetry', async () => {
  const mqttClient = { publish: jest.fn().mockResolvedValue(undefined) };
  const node = {
    status: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    send: jest.fn(),
  };
  const service = new MqttService(
    { node, flowContext: {}, globalContext: {} },
    mqttClient,
    `v1/device/${DEVICE_ID}/telemetry`,
    DEVICE_ID,
  );

  await service.publishRpcResponse(COMMAND_ID, {
    success: true,
    status: 'ACKED',
    method: 'set_state',
  });

  expect(mqttClient.publish).toHaveBeenCalledTimes(1);
  const [topic, payload] = mqttClient.publish.mock.calls[0];
  expect(topic).toBe(`v1/device/${DEVICE_ID}/rpc/response/${COMMAND_ID}`);
  expect(topic).not.toContain('/telemetry');
  const body = JSON.parse(payload);
  expect(body).toEqual(expect.objectContaining({
    success: true,
    status: 'ACKED',
    method: 'set_state',
  }));
});

test('publishRpcResponse no-ops without deviceId so oneway local clients stay quiet', async () => {
  const mqttClient = { publish: jest.fn().mockResolvedValue(undefined) };
  const node = {
    status: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    send: jest.fn(),
  };
  const service = new MqttService(
    { node, flowContext: {}, globalContext: {} },
    mqttClient,
    `v1/device/${DEVICE_ID}/telemetry`,
  );

  await service.publishRpcResponse(COMMAND_ID, { success: true, status: 'ACKED' });
  expect(mqttClient.publish).not.toHaveBeenCalled();
});

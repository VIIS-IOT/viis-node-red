import { publishTelemetry, TelemetryData } from '../viis-telemetry-utils';

describe('publishTelemetry', (): void => {
  it('should publish to both EMQX and Thingsboard with correct topic and payload', async (): Promise<void> => {
    const emqxClient = { publish: jest.fn().mockResolvedValue(undefined) };
    const tbClient = { publish: jest.fn().mockResolvedValue(undefined) };
    const data: TelemetryData = { temp: 25, status: 'ok' };

    await publishTelemetry({
      data,
      emqxClient,
      thingsboardClient: tbClient,
      emqxTopic: 'emqx/topic',
      thingsboardTopic: 'tb/topic'
    });

    const payload = JSON.stringify(data);
    expect(emqxClient.publish).toHaveBeenCalledWith('emqx/topic', payload);
    expect(tbClient.publish).toHaveBeenCalledWith('tb/topic', payload);
  });
});

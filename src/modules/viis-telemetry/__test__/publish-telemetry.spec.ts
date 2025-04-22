import { publishTelemetry, TelemetryData } from '../viis-telemetry-utils';

describe('publishTelemetry', (): void => {
  it('should publish to both EMQX and Thingsboard with correct topic and payload', (): void => {
    const emqxClient = { publish: jest.fn() };
    const tbClient = { publish: jest.fn() };
    const data: TelemetryData = { temp: 25, status: 'ok' };

    publishTelemetry({
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

/**
 * MQTT start-up of `viis-automation-node`. A gateway that boots while DNS or the uplink is down used to fail the
 * subscription once and give up until the next deploy (status "MQTT subscription failed"). The retry keeps trying
 * with a capped backoff and stops for good when the node closes.
 */
import { MqttInitRetry } from "../services/mqttInitRetry";

describe("MqttInitRetry", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("retries with a capped, doubling backoff until an attempt succeeds", async () => {
    const attempt = jest.fn()
      .mockRejectedValueOnce(new Error("getaddrinfo EAI_AGAIN device.demeter.vn"))
      .mockRejectedValueOnce(new Error("getaddrinfo EAI_AGAIN device.demeter.vn"))
      .mockRejectedValueOnce(new Error("getaddrinfo EAI_AGAIN device.demeter.vn"))
      .mockResolvedValueOnce(undefined);
    const onFailure = jest.fn();
    const onSuccess = jest.fn();
    const retry = new MqttInitRetry({ attempt, onFailure, onSuccess, initialDelayMs: 5000, maxDelayMs: 15000 });

    retry.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(onFailure).toHaveBeenLastCalledWith(expect.any(Error), 5000, 1);

    await jest.advanceTimersByTimeAsync(5000);
    expect(onFailure).toHaveBeenLastCalledWith(expect.any(Error), 10000, 2);

    await jest.advanceTimersByTimeAsync(10000);
    expect(onFailure).toHaveBeenLastCalledWith(expect.any(Error), 15000, 3);
    expect(onSuccess).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(15000);
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60000);
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it("stops retrying once stopped", async () => {
    const attempt = jest.fn().mockRejectedValue(new Error("down"));
    const onSuccess = jest.fn();
    const retry = new MqttInitRetry({ attempt, onFailure: jest.fn(), onSuccess, initialDelayMs: 1000, maxDelayMs: 1000 });

    retry.start();
    await jest.advanceTimersByTimeAsync(0);
    retry.stop();
    await jest.advanceTimersByTimeAsync(10000);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does not report success for an attempt that finishes after stop", async () => {
    let finish: () => void = () => undefined;
    const attempt = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onSuccess = jest.fn();
    const retry = new MqttInitRetry({ attempt, onFailure: jest.fn(), onSuccess });

    retry.start();
    retry.stop();
    finish();
    await jest.advanceTimersByTimeAsync(0);

    expect(onSuccess).not.toHaveBeenCalled();
  });
});

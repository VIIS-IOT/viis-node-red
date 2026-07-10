import {
  processRegisterThreshold,
  ThresholdProcessorInput,
} from '../register-threshold-processor';

describe('processRegisterThreshold', (): void => {
  it('first-publish-all-keys', (): void => {
    const input: ThresholdProcessorInput = {
      payload: [101, 202, 303],
      startAddr: 100,
      addrToKey: { 100: 'temp', 101: 'humidity', 102: 'pressure' },
      ranges: [{ start: 100, count: 3 }],
      rangeIndex: 0,
      previousState: {},
      currentState: {},
      thresholds: { temp: 0.5, humidity: 1, pressure: 0.1 },
    };

    const result = processRegisterThreshold(input);

    expect(result.kind).toBe('publish');
    if (result.kind !== 'publish') return;
    expect(Object.keys(result.changedKeys)).toHaveLength(3);
    expect(result.changedKeys).toEqual({
      temp: 101,
      humidity: 202,
      pressure: 303,
    });
    expect(result.finalState).toEqual({
      temp: 101,
      humidity: 202,
      pressure: 303,
    });
    expect(result.updatedAccumulator).toEqual({});
    expect(input.currentState).toEqual({});
  });

  it('threshold-zero-rejects-equal-delta', (): void => {
    const input: ThresholdProcessorInput = {
      payload: [42],
      startAddr: 50,
      addrToKey: { 50: 'temperature' },
      ranges: [{ start: 50, count: 1 }],
      rangeIndex: 0,
      previousState: { temperature: 42 },
      currentState: {},
      thresholds: { temperature: 0 },
    };

    const result = processRegisterThreshold(input);
    expect(result.kind).toBe('publish');
    if (result.kind !== 'publish') return;
    expect(Object.keys(result.changedKeys)).toHaveLength(0);
    expect(result.changedKeys).toEqual({});

    const subEpsilon = processRegisterThreshold({
      ...input,
      payload: [42 + 1e-10],
    });
    expect(subEpsilon.kind).toBe('publish');
    if (subEpsilon.kind !== 'publish') return;
    expect(Object.keys(subEpsilon.changedKeys)).toHaveLength(0);
  });

  it('multi-range-accumulate-then-detect', (): void => {
    const ranges = [
      { start: 0, count: 1 },
      { start: 10, count: 1 },
      { start: 20, count: 1 },
    ];
    const addrToKey: Record<number, string> = {
      0: 'sensorA',
      10: 'sensorB',
      20: 'sensorC',
    };

    const call1 = processRegisterThreshold({
      payload: [11],
      startAddr: ranges[0].start,
      addrToKey,
      ranges,
      rangeIndex: 0,
      previousState: {},
      currentState: {},
      thresholds: { sensorA: 0, sensorB: 0, sensorC: 0 },
    });
    expect(call1.kind).toBe('continue');
    if (call1.kind !== 'continue') return;
    expect(call1.next.rangeIndex).toBe(1);
    expect(call1.next.startAddr).toBe(10);
    expect(call1.next.payload).toBeNull();
    expect(call1.updatedAccumulator).toEqual({ sensorA: 11 });

    const call2 = processRegisterThreshold({
      payload: [22],
      startAddr: ranges[1].start,
      addrToKey,
      ranges,
      rangeIndex: 1,
      previousState: {},
      currentState: call1.updatedAccumulator,
      thresholds: { sensorA: 0, sensorB: 0, sensorC: 0 },
    });
    expect(call2.kind).toBe('continue');
    if (call2.kind !== 'continue') return;
    expect(call2.next.rangeIndex).toBe(2);
    expect(call2.next.startAddr).toBe(20);
    expect(call2.updatedAccumulator).toEqual({ sensorA: 11, sensorB: 22 });

    const call3 = processRegisterThreshold({
      payload: [33],
      startAddr: ranges[2].start,
      addrToKey,
      ranges,
      rangeIndex: 2,
      previousState: {},
      currentState: call2.updatedAccumulator,
      thresholds: { sensorA: 0, sensorB: 0, sensorC: 0 },
    });
    expect(call3.kind).toBe('publish');
    if (call3.kind !== 'publish') return;
    expect(Object.keys(call3.changedKeys).sort()).toEqual([
      'sensorA',
      'sensorB',
      'sensorC',
    ]);
    expect(call3.changedKeys).toEqual({
      sensorA: 11,
      sensorB: 22,
      sensorC: 33,
    });
    expect(call3.finalState).toEqual({
      sensorA: 11,
      sensorB: 22,
      sensorC: 33,
    });
    expect(call3.updatedAccumulator).toEqual({});
  });

  it('invalid-payload-preserves-previous', (): void => {
    const previousState = { temperature: 25, humidity: 60 };
    const currentState = { temperature: 26 };
    const previousSnapshot = { ...previousState };
    const currentSnapshot = { ...currentState };

    const result = processRegisterThreshold({
      payload: null,
      startAddr: 0,
      addrToKey: { 0: 'temperature', 1: 'humidity' },
      ranges: [{ start: 0, count: 2 }],
      rangeIndex: 0,
      previousState,
      currentState,
      thresholds: { temperature: 0.5, humidity: 1 },
    });

    expect(result.kind).toBe('invalid_payload');
    if (result.kind !== 'invalid_payload') return;
    expect(result.changedKeys).toEqual({});
    expect(previousState).toEqual(previousSnapshot);
    expect(currentState).toEqual(currentSnapshot);
  });

  it('first-publish-with-binary-keys', (): void => {
    const input: ThresholdProcessorInput = {
      payload: [1, 0],
      startAddr: 200,
      addrToKey: { 200: 'isOpen', 201: 'isRunning' },
      ranges: [{ start: 200, count: 2 }],
      rangeIndex: 0,
      previousState: {},
      currentState: {},
      thresholds: {},
      binaryKeys: ['isOpen', 'isRunning'],
    };

    const result = processRegisterThreshold(input);

    expect(result.kind).toBe('publish');
    if (result.kind !== 'publish') return;
    expect(result.changedKeys).toEqual({
      isOpen: true,
      isRunning: false,
    });
    expect(result.finalState).toEqual({
      isOpen: true,
      isRunning: false,
    });
    expect(result.updatedAccumulator).toEqual({});

    const sameState = processRegisterThreshold({
      ...input,
      previousState: { isOpen: true, isRunning: false },
      currentState: {},
    });
    expect(sameState.kind).toBe('publish');
    if (sameState.kind !== 'publish') return;
    expect(sameState.changedKeys).toEqual({});
  });
});
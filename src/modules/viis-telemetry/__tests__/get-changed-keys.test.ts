import { getChangedKeys, TelemetryData } from '../viis-telemetry-utils';

/**
 * Unit test for getChangedKeys function.
 */
describe('getChangedKeys', (): void => {
  it('should detect numeric change above threshold', (): void => {
    const prev: TelemetryData = { temp: 10 };
    const curr: TelemetryData = { temp: 12 };
    const threshold = { temp: 1 };
    expect(getChangedKeys(curr, prev, threshold)).toEqual({ temp: 12 });
  });

  it('should ignore numeric change below threshold', (): void => {
    const prev: TelemetryData = { temp: 10 };
    const curr: TelemetryData = { temp: 10.5 };
    const threshold = { temp: 1 };
    expect(getChangedKeys(curr, prev, threshold)).toEqual({});
  });

  it('should detect non-numeric change', (): void => {
    const prev: TelemetryData = { status: 'ok' };
    const curr: TelemetryData = { status: 'fail' };
    const threshold = {};
    expect(getChangedKeys(curr, prev, threshold)).toEqual({ status: 'fail' });
  });
});
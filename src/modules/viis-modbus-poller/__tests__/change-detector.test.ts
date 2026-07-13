import { detectChangedData } from "../services/change-detector";

describe("detectChangedData", () => {
  it("publishes full snapshot on first successful read", () => {
    const changed = detectChangedData({
      current: { current_ec: 1.2, valve_1: true },
      previous: {},
      thresholds: { current_ec: 0.1, valve_1: 0 },
      publishFullSnapshot: true,
    });

    expect(changed).toEqual({ current_ec: 1.2, valve_1: true });
  });

  it("publishes numeric values only when scaled delta meets threshold", () => {
    const changed = detectChangedData({
      current: { current_ec: 1.25, current_ph: 6.51, pump_pressure: 2.5 },
      previous: { current_ec: 1.2, current_ph: 6.5, pump_pressure: 2.0 },
      thresholds: { current_ec: 0.1, current_ph: 0.1, pump_pressure: 0.5 },
      publishFullSnapshot: false,
    });

    expect(changed).toEqual({ pump_pressure: 2.5 });
  });

  it("publishes boolean values when state changes", () => {
    const changed = detectChangedData({
      current: { valve_1: false },
      previous: { valve_1: true },
      thresholds: { valve_1: 0 },
      publishFullSnapshot: false,
    });

    expect(changed).toEqual({ valve_1: false });
  });

  it("publishes current value when previous value is undefined", () => {
    const changed = detectChangedData({
      current: { current_ph: 6.5, valve_2: true },
      previous: { current_ec: 1.2 },
      thresholds: { current_ph: 0.1, valve_2: 0 },
      publishFullSnapshot: false,
    });

    expect(changed).toEqual({ current_ph: 6.5, valve_2: true });
  });

  it("does not publish unchanged boolean values", () => {
    const changed = detectChangedData({
      current: { valve_1: true },
      previous: { valve_1: true },
      thresholds: { valve_1: 0 },
      publishFullSnapshot: false,
    });

    expect(changed).toEqual({});
  });
});

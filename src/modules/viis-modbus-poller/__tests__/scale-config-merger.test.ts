import { mergeScaleConfigs } from "../services/scale-config-merger";

describe("mergeScaleConfigs", () => {
  it("lets UI overrides replace global configs by key and direction", () => {
    const merged = mergeScaleConfigs(
      [{ key: "current_ec", operation: "divide", factor: 1000, direction: "read" }],
      [{ key: "current_ec", operation: "divide", factor: 100, direction: "read" }],
    );

    expect(merged).toEqual([
      { key: "current_ec", operation: "divide", factor: 100, direction: "read" },
    ]);
  });

  it("preserves non-overridden global configs", () => {
    const merged = mergeScaleConfigs(
      [
        { key: "current_ec", operation: "divide", factor: 1000, direction: "read" },
        { key: "current_ph", operation: "divide", factor: 100, direction: "read" },
      ],
      [{ key: "current_ec", operation: "divide", factor: 100, direction: "read" }],
    );

    expect(merged).toEqual([
      { key: "current_ec", operation: "divide", factor: 100, direction: "read" },
      { key: "current_ph", operation: "divide", factor: 100, direction: "read" },
    ]);
  });

  it("keeps read and write configs separate for the same key", () => {
    const merged = mergeScaleConfigs(
      [
        { key: "set_ec", operation: "divide", factor: 1000, direction: "read" },
        { key: "set_ec", operation: "multiply", factor: 1000, direction: "write" },
      ],
      [{ key: "set_ec", operation: "divide", factor: 100, direction: "read" }],
    );

    expect(merged).toEqual([
      { key: "set_ec", operation: "divide", factor: 100, direction: "read" },
      { key: "set_ec", operation: "multiply", factor: 1000, direction: "write" },
    ]);
  });

  it("tolerates missing config arrays", () => {
    expect(mergeScaleConfigs(undefined, undefined)).toEqual([]);
    expect(
      mergeScaleConfigs(undefined, [
        { key: "pump_pressure", operation: "divide", factor: 10, direction: "read" },
      ]),
    ).toEqual([
      { key: "pump_pressure", operation: "divide", factor: 10, direction: "read" },
    ]);
  });
});

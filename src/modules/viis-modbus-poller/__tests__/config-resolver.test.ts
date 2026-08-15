import { resolvePollerConfig } from "../services/config-resolver";

function makeGlobal(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

describe("resolvePollerConfig", () => {
  it("resolves JSON-string global config using the required priority order", () => {
    const global = makeGlobal({
      modbusPollGroups: JSON.stringify({
        realtime: { interval: 2000, coils: ["pump_1"], input: ["current_ec"] },
      }),
      modbusPublishThresholds: JSON.stringify({ pump_1: 0, current_ec: 0.1 }),
      modbusMappings: JSON.stringify({
        board2: {
          coils: { pump_1: 1 },
          inputRegisters: { current_ec: 20 },
          holdingRegisters: {},
        },
      }),
      device_id: "device-from-lowercase",
      modbusDefaultBoard: "board2",
      scaleConfigs: JSON.stringify([
        { key: "current_ec", operation: "divide", factor: 1000, direction: "read" },
      ]),
    });

    const resolved = resolvePollerConfig(
      {
        boardId: "",
        scaleConfigOverrides: JSON.stringify([
          { key: "current_ec", operation: "divide", factor: 100, direction: "read" },
        ]),
      },
      global,
    );

    expect(resolved).toEqual({
      deviceId: "device-from-lowercase",
      boardId: "board2",
      pollingConfig: {
        realtime: { interval: 2000, coils: ["pump_1"], input: ["current_ec"] },
      },
      mappings: {
        coils: { pump_1: 1 },
        input: { current_ec: 20 },
        holding: {},
      },
      thresholds: { pump_1: 0, current_ec: 0.1 },
      scaleConfigs: [
        { key: "current_ec", operation: "divide", factor: 100, direction: "read" },
      ],
    });
  });

  it("falls back to legacy global keys, board-specific mappings, uppercase device id, and board1", () => {
    const global = makeGlobal({
      pollingConfig: { realtime: { interval: 2000, coils: ["pump_1"] } },
      modbusThresholds: { pump_1: 0 },
      modbus_board1_coils: { pump_1: 5 },
      modbus_board1_input_registers: { current_ec: 20 },
      modbus_board1_holding_registers: { set_ec: 11 },
      DEVICE_ID: "device-from-uppercase",
    });

    const resolved = resolvePollerConfig({ scaleConfigOverrides: "" }, global);

    expect(resolved.deviceId).toBe("device-from-uppercase");
    expect(resolved.boardId).toBe("board1");
    expect(resolved.mappings).toEqual({
      coils: { pump_1: 5 },
      input: { current_ec: 20 },
      holding: { set_ec: 11 },
    });
  });

  it("uses env-loader scale configs when telemetry namespace configs are stale", () => {
    const global = makeGlobal({
      modbusPollGroups: { sensors: { interval: 5000, input: ["current_ec"] } },
      modbusPublishThresholds: { current_ec: 0.1 },
      modbusMappings: {
        board1: {
          coils: {},
          inputRegisters: { current_ec: 14 },
          holdingRegisters: {},
        },
      },
      scaleConfigs: [
        {
          key: "fertigation_monitor_current_ec",
          operation: "divide",
          factor: 1000,
          direction: "read",
        },
        { key: "current_ec", operation: "divide", factor: 10, direction: "read" },
      ],
      scale_configs: JSON.stringify([
        { key: "current_ec", operation: "divide", factor: 1000, direction: "read" },
      ]),
    });

    const resolved = resolvePollerConfig({ scaleConfigOverrides: "" }, global);

    expect(resolved.scaleConfigs).toEqual([
      {
        key: "fertigation_monitor_current_ec",
        operation: "divide",
        factor: 1000,
        direction: "read",
      },
      { key: "current_ec", operation: "divide", factor: 1000, direction: "read" },
    ]);
  });

  it("uses unknown_device when no device id is present", () => {
    const global = makeGlobal({
      modbus_poll_groups: { realtime: { interval: 2000, coils: ["pump_1"] } },
      modbus_publish_thresholds: { pump_1: 0 },
      modbusMappings: {
        board1: {
          coils: { pump_1: 1 },
          inputRegisters: {},
          holdingRegisters: {},
        },
      },
    });

    expect(resolvePollerConfig({}, global).deviceId).toBe("unknown_device");
  });

  it("throws a clear error for invalid JSON config strings", () => {
    const global = makeGlobal({
      modbusPollGroups: "{broken",
    });

    expect(() => resolvePollerConfig({}, global)).toThrow(
      "Invalid JSON in global context key modbusPollGroups",
    );
  });

  it("throws a clear error when scale config overrides are not an array", () => {
    const global = makeGlobal({
      modbusPollGroups: { realtime: { interval: 2000, coils: ["pump_1"] } },
      modbusPublishThresholds: { pump_1: 0 },
      modbusMappings: {
        board1: {
          coils: { pump_1: 1 },
          inputRegisters: {},
          holdingRegisters: {},
        },
      },
    });

    expect(() =>
      resolvePollerConfig({ scaleConfigOverrides: '{"key":"current_ec"}' }, global),
    ).toThrow("node config scaleConfigOverrides must be an array");
  });
});

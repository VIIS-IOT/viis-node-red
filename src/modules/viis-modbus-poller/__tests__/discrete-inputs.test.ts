import { BoardScopedModbusClient } from "../../../core/board-scoped-modbus-client";
import { resolvePollerConfig } from "../services/config-resolver";
import { validateResolvedConfig } from "../services/config-validator";
import { mergeBoardMappings } from "../services/multi-board-poll";
import { runPollTick } from "../services/poll-runner";
import type { ResolvedPollerConfig } from "../types";

/**
 * device1.json declares read-only status bits (level sensors, pump faults, alarms) under
 * modbusMappings.<board>.discreteInputs and modbusPollGroups.<group>.discreteInputs.
 * They must be read with FC02 (Read Discrete Inputs), never FC01, which addresses coils.
 */

function makeGlobal(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] };
}

const defaultOptions = {
  maxGap: 5,
  maxCoilsPerRead: 64,
  maxRegistersPerRead: 32,
  publishFullSnapshot: true,
};

describe("discrete inputs (FC02)", () => {
  it("resolves discrete inputs from the env-loader per-board global key", () => {
    const resolved = resolvePollerConfig(
      {},
      makeGlobal({
        modbus_boards: JSON.stringify([{ id: "board1", unitId: 1 }]),
        modbus_board1_coils: JSON.stringify({ pump: 0 }),
        modbus_board1_discrete_inputs: JSON.stringify({ level_high: 0, level_low: 1 }),
        modbus_poll_groups: JSON.stringify({
          realtime: { interval: 2000, coils: ["pump"], discreteInputs: ["level_high", "level_low", "unknown"] },
        }),
        modbus_publish_thresholds: JSON.stringify({ pump: 0, level_high: 0, level_low: 0 }),
      }),
    );

    expect(resolved.boards?.[0].mappings.discreteInputs).toEqual({ level_high: 0, level_low: 1 });
    expect(resolved.boards?.[0].pollingConfig.realtime.discreteInputs).toEqual(["level_high", "level_low"]);
  });

  it("resolves discrete inputs from modbusMappings", () => {
    const resolved = resolvePollerConfig(
      {},
      makeGlobal({
        modbusMappings: JSON.stringify({ board1: { coils: {}, discreteInputs: { alarm: 5 } } }),
        modbusPollGroups: JSON.stringify({ realtime: { interval: 2000, discreteInputs: ["alarm"] } }),
      }),
    );

    expect(resolved.mappings.discreteInputs).toEqual({ alarm: 5 });
  });

  it("reads discrete inputs with FC02 after coils and before registers", async () => {
    const calls: string[] = [];
    const modbusClient = {
      readCoils: async () => {
        calls.push("coils");
        return { address: 0, data: [true] };
      },
      readDiscreteInputs: async (address: number, length: number) => {
        calls.push(`discreteInputs:${address}:${length}`);
        return { address, data: [false, true, true] };
      },
      readInputRegisters: async () => {
        calls.push("input");
        return { address: 0, data: [7] };
      },
      readHoldingRegisters: async () => {
        calls.push("holding");
        return { address: 0, data: [1] };
      },
    };
    const config: ResolvedPollerConfig = {
      deviceId: "device-1",
      boardId: "board1",
      pollingConfig: {
        realtime: {
          interval: 2000,
          coils: ["pump"],
          discreteInputs: ["level_high", "level_low", "alarm"],
          input: ["ec"],
          holding: ["set_ec"],
        },
      },
      mappings: {
        coils: { pump: 0 },
        discreteInputs: { level_high: 0, level_low: 1, alarm: 2 },
        input: { ec: 0 },
        holding: { set_ec: 0 },
      },
      thresholds: { pump: 0, level_high: 0, level_low: 0, alarm: 0, ec: 0, set_ec: 0 },
      scaleConfigs: [],
    };

    const result = await runPollTick({
      modbusClient,
      dueGroups: ["realtime"],
      config,
      previousState: {},
      options: defaultOptions,
    });

    expect(calls).toEqual(["coils", "discreteInputs:0:3", "input", "holding"]);
    expect(result.latestData).toEqual({
      pump: true,
      level_high: false,
      level_low: true,
      alarm: true,
      ec: 7,
      set_ec: 1,
    });
    expect(result.diagnostics.requests.map((request) => request.registerType)).toContain("discreteInputs");
  });

  it("a coil and a discrete input may share an address (separate Modbus tables)", async () => {
    const modbusClient = {
      readCoils: async () => ({ address: 0, data: [true] }),
      readDiscreteInputs: async () => ({ address: 0, data: [false] }),
      readInputRegisters: jest.fn(),
      readHoldingRegisters: jest.fn(),
    };

    const result = await runPollTick({
      modbusClient,
      dueGroups: ["realtime"],
      config: {
        deviceId: "device-1",
        boardId: "board1",
        pollingConfig: { realtime: { interval: 2000, coils: ["pump"], discreteInputs: ["level_high"] } },
        mappings: { coils: { pump: 0 }, discreteInputs: { level_high: 0 }, input: {}, holding: {} },
        thresholds: { pump: 0, level_high: 0 },
        scaleConfigs: [],
      },
      previousState: {},
      options: defaultOptions,
    });

    expect(result.latestData).toEqual({ pump: true, level_high: false });
  });

  it("validates discrete input keys like the other areas", () => {
    const config: ResolvedPollerConfig = {
      deviceId: "device-1",
      boardId: "board1",
      pollingConfig: { realtime: { interval: 2000, discreteInputs: ["level_high", "ghost"] } },
      mappings: { coils: {}, discreteInputs: { level_high: 0 }, input: {}, holding: {} },
      thresholds: {},
      scaleConfigs: [],
    };

    const { errors } = validateResolvedConfig(config);

    expect(errors).toEqual(
      expect.arrayContaining([
        'realtime.discreteInputs references missing key "ghost"',
        'realtime.discreteInputs missing threshold for key "level_high"',
      ]),
    );
  });

  it("merges discrete inputs across boards", () => {
    expect(
      mergeBoardMappings([
        { coils: {}, discreteInputs: { a: 0 }, input: {}, holding: {} },
        { coils: {}, discreteInputs: { b: 1 }, input: {}, holding: {} },
      ]).discreteInputs,
    ).toEqual({ a: 0, b: 1 });
  });

  it("board-scoped client reads discrete inputs with its own unit id", async () => {
    const transport = {
      readDiscreteInputs: jest.fn(async () => ({ address: 4, data: [true] })),
    };
    const client = new BoardScopedModbusClient(transport as any, 3);

    await client.readDiscreteInputs(4, 1);

    expect(transport.readDiscreteInputs).toHaveBeenCalledWith(4, 1, 3);
  });
});

describe("discrete inputs without FC02 support", () => {
  it("reports an error instead of reading coils", async () => {
    const readCoils = jest.fn(async () => ({ address: 0, data: [true] }));
    const result = await runPollTick({
      modbusClient: { readCoils, readInputRegisters: jest.fn(), readHoldingRegisters: jest.fn() },
      dueGroups: ["realtime"],
      config: {
        deviceId: "device-1",
        boardId: "board1",
        pollingConfig: { realtime: { interval: 2000, discreteInputs: ["level_high"] } },
        mappings: { coils: {}, discreteInputs: { level_high: 0 }, input: {}, holding: {} },
        thresholds: { level_high: 0 },
        scaleConfigs: [],
      },
      previousState: {},
      options: defaultOptions,
    });

    expect(readCoils).not.toHaveBeenCalled();
    expect(result.latestData).toEqual({});
    expect(result.diagnostics.errors.join(" ")).toContain("FC02");
  });
});

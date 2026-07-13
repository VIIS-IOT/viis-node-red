"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const poll_runner_1 = require("../services/poll-runner");
function makeConfig(overrides = {}) {
    return Object.assign({ deviceId: "device-1", boardId: "board1", pollingConfig: {}, mappings: {
            coils: {},
            input: {},
            holding: {},
        }, thresholds: {}, scaleConfigs: [] }, overrides);
}
const defaultOptions = {
    maxGap: 5,
    maxCoilsPerRead: 64,
    maxRegistersPerRead: 32,
    publishFullSnapshot: true,
};
describe("runPollTick", () => {
    it("reads coils, input, then holding sequentially and preserves duplicate aliases", async () => {
        const calls = [];
        const modbusClient = {
            readCoils: async () => {
                calls.push("coils");
                return { address: 0, data: [true] };
            },
            readInputRegisters: async () => {
                calls.push("input");
                return { address: 20, data: [7] };
            },
            readHoldingRegisters: async () => {
                calls.push("holding");
                return { address: 37, data: [123] };
            },
        };
        const result = await (0, poll_runner_1.runPollTick)({
            modbusClient,
            dueGroups: ["realtime", "config"],
            config: makeConfig({
                pollingConfig: {
                    realtime: { interval: 2000, coils: ["main_pump"], input: ["stateMachine"] },
                    config: { interval: 300000, holding: ["flow_2_params", "flow_4_params"] },
                },
                mappings: {
                    coils: { main_pump: 0 },
                    input: { stateMachine: 20 },
                    holding: { flow_2_params: 37, flow_4_params: 37 },
                },
                thresholds: { main_pump: 0, stateMachine: 1, flow_2_params: 0, flow_4_params: 0 },
            }),
            previousState: {},
            options: defaultOptions,
        });
        expect(calls).toEqual(["coils", "input", "holding"]);
        expect(result.latestData).toEqual({
            main_pump: true,
            stateMachine: 7,
            flow_2_params: 123,
            flow_4_params: 123,
        });
        expect(result.changedData).toEqual(result.latestData);
        expect(result.diagnostics.readCount).toBe(3);
    });
    it("does not update failed range keys and keeps reading remaining ranges", async () => {
        const modbusClient = {
            readCoils: async () => ({ address: 0, data: [true] }),
            readInputRegisters: async () => {
                throw new Error("timeout");
            },
            readHoldingRegisters: async () => ({ address: 11, data: [10] }),
        };
        const result = await (0, poll_runner_1.runPollTick)({
            modbusClient,
            dueGroups: ["realtime", "config"],
            config: makeConfig({
                pollingConfig: {
                    realtime: { interval: 2000, coils: ["main_pump"], input: ["stateMachine"] },
                    config: { interval: 300000, holding: ["set_ec"] },
                },
                mappings: {
                    coils: { main_pump: 0 },
                    input: { stateMachine: 20 },
                    holding: { set_ec: 11 },
                },
                thresholds: { main_pump: 0, stateMachine: 1, set_ec: 0 },
            }),
            previousState: { stateMachine: 4 },
            options: Object.assign(Object.assign({}, defaultOptions), { publishFullSnapshot: false }),
        });
        expect(result.latestData).toEqual({ main_pump: true, set_ec: 10 });
        expect(result.changedData).toEqual({ main_pump: true, set_ec: 10 });
        expect(result.diagnostics.errors).toEqual(["input read failed at 20 qty 1: timeout"]);
        expect(result.diagnostics.errorCount).toBe(1);
    });
    it("applies scaling before change detection", async () => {
        const modbusClient = {
            readCoils: jest.fn(),
            readInputRegisters: jest.fn(),
            readHoldingRegisters: async () => ({ address: 3, data: [125] }),
        };
        const result = await (0, poll_runner_1.runPollTick)({
            modbusClient,
            dueGroups: ["sensors"],
            config: makeConfig({
                pollingConfig: {
                    sensors: { interval: 5000, holding: ["current_ec"] },
                },
                mappings: {
                    coils: {},
                    input: {},
                    holding: { current_ec: 3 },
                },
                thresholds: { current_ec: 0.1 },
                scaleConfigs: [{ key: "current_ec", operation: "divide", factor: 100, direction: "read" }],
            }),
            previousState: { current_ec: 1.2 },
            options: Object.assign(Object.assign({}, defaultOptions), { publishFullSnapshot: false }),
        });
        expect(result.latestData).toEqual({ current_ec: 1.25 });
        expect(result.changedData).toEqual({});
    });
    it("records an error and skips keys when a Modbus response is shorter than the planned range", async () => {
        const modbusClient = {
            readCoils: jest.fn(),
            readInputRegisters: jest.fn(),
            readHoldingRegisters: async () => ({ address: 0, data: [10, 11] }),
        };
        const result = await (0, poll_runner_1.runPollTick)({
            modbusClient,
            dueGroups: ["config"],
            config: makeConfig({
                pollingConfig: {
                    config: { interval: 300000, holding: ["set_ec", "set_ph"] },
                },
                mappings: {
                    coils: {},
                    input: {},
                    holding: { set_ec: 0, set_ph: 2 },
                },
                thresholds: { set_ec: 0, set_ph: 0 },
            }),
            previousState: {},
            options: defaultOptions,
        });
        expect(result.latestData).toEqual({ set_ec: 10 });
        expect(result.changedData).toEqual({ set_ec: 10 });
        expect(result.diagnostics.errors).toEqual(["holding missing data at 2 from read 0 qty 3"]);
    });
    it("falls back to the planned range start when a test mock omits result address", async () => {
        const modbusClient = {
            readCoils: jest.fn(),
            readInputRegisters: jest.fn(),
            readHoldingRegisters: async () => ({ data: [77] }),
        };
        const result = await (0, poll_runner_1.runPollTick)({
            modbusClient: modbusClient,
            dueGroups: ["config"],
            config: makeConfig({
                pollingConfig: {
                    config: { interval: 300000, holding: ["set_ec"] },
                },
                mappings: {
                    coils: {},
                    input: {},
                    holding: { set_ec: 5 },
                },
                thresholds: { set_ec: 0 },
            }),
            previousState: {},
            options: defaultOptions,
        });
        expect(result.latestData).toEqual({ set_ec: 77 });
    });
});

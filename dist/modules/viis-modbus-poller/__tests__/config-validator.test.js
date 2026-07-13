"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_validator_1 = require("../services/config-validator");
describe("validateResolvedConfig", () => {
    it("accepts duplicate addresses as warnings", () => {
        const result = (0, config_validator_1.validateResolvedConfig)({
            deviceId: "device-1",
            boardId: "board1",
            pollingConfig: {
                config: { interval: 300000, holding: ["flow_2_params", "flow_4_params"] },
            },
            mappings: {
                coils: {},
                input: {},
                holding: { flow_2_params: 37, flow_4_params: 37 },
            },
            thresholds: { flow_2_params: 0, flow_4_params: 0 },
            scaleConfigs: [],
        });
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([
            "holding address 37 is used by keys: flow_2_params, flow_4_params",
        ]);
    });
    it("fails when a group references a missing mapping key", () => {
        const result = (0, config_validator_1.validateResolvedConfig)({
            deviceId: "device-1",
            boardId: "board1",
            pollingConfig: {
                realtime: { interval: 2000, coils: ["missing_coil"] },
            },
            mappings: { coils: {}, input: {}, holding: {} },
            thresholds: { missing_coil: 0 },
            scaleConfigs: [],
        });
        expect(result.errors).toContain('realtime.coils references missing key "missing_coil"');
    });
    it("validates input register groups and threshold coverage", () => {
        const result = (0, config_validator_1.validateResolvedConfig)({
            deviceId: "device-1",
            boardId: "board1",
            pollingConfig: {
                sensors: { interval: 5000, input: ["current_ec", "current_ph"] },
            },
            mappings: {
                coils: {},
                input: { current_ec: 20, current_ph: 21 },
                holding: {},
            },
            thresholds: { current_ec: 0.1 },
            scaleConfigs: [],
        });
        expect(result.errors).toContain('sensors.input missing threshold for key "current_ph"');
    });
    it("fails on missing polling config and non-positive intervals", () => {
        expect((0, config_validator_1.validateResolvedConfig)({
            deviceId: "device-1",
            boardId: "board1",
            pollingConfig: {},
            mappings: { coils: {}, input: {}, holding: {} },
            thresholds: {},
            scaleConfigs: [],
        }).errors).toContain("pollingConfig must define at least one poll group");
        expect((0, config_validator_1.validateResolvedConfig)({
            deviceId: "device-1",
            boardId: "board1",
            pollingConfig: { realtime: { interval: 0, coils: ["pump_1"] } },
            mappings: { coils: { pump_1: 1 }, input: {}, holding: {} },
            thresholds: { pump_1: 0 },
            scaleConfigs: [],
        }).errors).toContain("realtime.interval must be a positive number");
    });
    it("ignores placeholder duplicate warnings but errors when a polled key maps to placeholder 999", () => {
        const result = (0, config_validator_1.validateResolvedConfig)({
            deviceId: "device-1",
            boardId: "board1",
            pollingConfig: {
                realtime: { interval: 2000, coils: ["unused_1", "unused_2"] },
            },
            mappings: {
                coils: { unused_1: 999, unused_2: 999 },
                input: {},
                holding: {},
            },
            thresholds: { unused_1: 0, unused_2: 0 },
            scaleConfigs: [],
        });
        expect(result.warnings).toEqual([]);
        expect(result.errors).toEqual([
            'realtime.coils key "unused_1" maps to unreadable placeholder address 999',
            'realtime.coils key "unused_2" maps to unreadable placeholder address 999',
        ]);
    });
    it("fails on invalid scale config objects", () => {
        const result = (0, config_validator_1.validateResolvedConfig)({
            deviceId: "device-1",
            boardId: "board1",
            pollingConfig: {
                sensors: { interval: 5000, holding: ["current_ec"] },
            },
            mappings: {
                coils: {},
                input: {},
                holding: { current_ec: 11 },
            },
            thresholds: { current_ec: 0.1 },
            scaleConfigs: [
                { key: "current_ec", operation: "divide", factor: 1000, direction: "read" },
                { key: "", operation: "multiply", factor: 0, direction: "sideways" },
            ],
        });
        expect(result.errors).toEqual([
            "scaleConfigs[1].key must be a non-empty string",
            'scaleConfigs[1].factor must be a positive number',
            'scaleConfigs[1].direction must be "read" or "write"',
        ]);
    });
});

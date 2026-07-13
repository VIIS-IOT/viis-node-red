"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const scale_config_merger_1 = require("../services/scale-config-merger");
describe("mergeScaleConfigs", () => {
    it("lets UI overrides replace global configs by key and direction", () => {
        const merged = (0, scale_config_merger_1.mergeScaleConfigs)([{ key: "current_ec", operation: "divide", factor: 1000, direction: "read" }], [{ key: "current_ec", operation: "divide", factor: 100, direction: "read" }]);
        expect(merged).toEqual([
            { key: "current_ec", operation: "divide", factor: 100, direction: "read" },
        ]);
    });
    it("preserves non-overridden global configs", () => {
        const merged = (0, scale_config_merger_1.mergeScaleConfigs)([
            { key: "current_ec", operation: "divide", factor: 1000, direction: "read" },
            { key: "current_ph", operation: "divide", factor: 100, direction: "read" },
        ], [{ key: "current_ec", operation: "divide", factor: 100, direction: "read" }]);
        expect(merged).toEqual([
            { key: "current_ec", operation: "divide", factor: 100, direction: "read" },
            { key: "current_ph", operation: "divide", factor: 100, direction: "read" },
        ]);
    });
    it("keeps read and write configs separate for the same key", () => {
        const merged = (0, scale_config_merger_1.mergeScaleConfigs)([
            { key: "set_ec", operation: "divide", factor: 1000, direction: "read" },
            { key: "set_ec", operation: "multiply", factor: 1000, direction: "write" },
        ], [{ key: "set_ec", operation: "divide", factor: 100, direction: "read" }]);
        expect(merged).toEqual([
            { key: "set_ec", operation: "divide", factor: 100, direction: "read" },
            { key: "set_ec", operation: "multiply", factor: 1000, direction: "write" },
        ]);
    });
    it("tolerates missing config arrays", () => {
        expect((0, scale_config_merger_1.mergeScaleConfigs)(undefined, undefined)).toEqual([]);
        expect((0, scale_config_merger_1.mergeScaleConfigs)(undefined, [
            { key: "pump_pressure", operation: "divide", factor: 10, direction: "read" },
        ])).toEqual([
            { key: "pump_pressure", operation: "divide", factor: 10, direction: "read" },
        ]);
    });
});

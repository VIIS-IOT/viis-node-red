"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const range_planner_1 = require("../services/range-planner");
describe("planAddressRanges", () => {
    it("splits non-contiguous addresses without reading a huge gap", () => {
        const ranges = (0, range_planner_1.planAddressRanges)({
            registerType: "coils",
            functionCode: 1,
            requestedKeys: ["valve_1", "valve_2"],
            mapping: { valve_1: 10, valve_2: 200 },
            maxGap: 5,
            maxQuantity: 64,
        });
        expect(ranges).toEqual([
            {
                registerType: "coils",
                functionCode: 1,
                start: 10,
                quantity: 1,
                addresses: [10],
                keysByAddress: { 10: ["valve_1"] },
            },
            {
                registerType: "coils",
                functionCode: 1,
                start: 200,
                quantity: 1,
                addresses: [200],
                keysByAddress: { 200: ["valve_2"] },
            },
        ]);
    });
    it("keeps duplicate address aliases in one Modbus read", () => {
        const ranges = (0, range_planner_1.planAddressRanges)({
            registerType: "holding",
            functionCode: 3,
            requestedKeys: ["flow_2_params", "flow_4_params"],
            mapping: { flow_2_params: 37, flow_4_params: 37 },
            maxGap: 5,
            maxQuantity: 32,
        });
        expect(ranges).toHaveLength(1);
        expect(ranges[0].start).toBe(37);
        expect(ranges[0].quantity).toBe(1);
        expect(ranges[0].keysByAddress[37]).toEqual([
            "flow_2_params",
            "flow_4_params",
        ]);
    });
    it("splits a range before exceeding maxQuantity", () => {
        const mapping = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`k${index}`, index]));
        const ranges = (0, range_planner_1.planAddressRanges)({
            registerType: "input",
            functionCode: 4,
            requestedKeys: Object.keys(mapping),
            mapping,
            maxGap: 5,
            maxQuantity: 32,
        });
        expect(ranges.map((range) => [range.start, range.quantity])).toEqual([
            [0, 32],
            [32, 8],
        ]);
    });
});

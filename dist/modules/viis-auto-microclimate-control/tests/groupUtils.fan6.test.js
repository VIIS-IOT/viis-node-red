"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const groupUtils_1 = require("../utils/groupUtils");
(0, globals_1.describe)("groupUtils - fan6 support", () => {
    (0, globals_1.it)("returns quat_6 in default fan key set", () => {
        (0, globals_1.expect)((0, groupUtils_1.getAllFanKeys)()).toEqual([
            "quat_1",
            "quat_2",
            "quat_3",
            "quat_4",
            "quat_5",
            "quat_6"
        ]);
    });
    (0, globals_1.it)("generates actions for quat_6 in target group", () => {
        const actions = (0, groupUtils_1.createFanGroupActions)(["quat_6"], true, "test fan6", {
            quat_1: 0,
            quat_2: 1,
            quat_3: 2,
            quat_4: 3,
            quat_5: 4,
            quat_6: 5
        });
        const fan6Action = actions.find(a => a.deviceKey === "quat_6");
        (0, globals_1.expect)(fan6Action).toBeDefined();
        (0, globals_1.expect)(fan6Action === null || fan6Action === void 0 ? void 0 : fan6Action.value).toBe(true);
        (0, globals_1.expect)(fan6Action === null || fan6Action === void 0 ? void 0 : fan6Action.address).toBe(5);
    });
    (0, globals_1.it)("recommends 6 fans for K3 and K4 temperature ranges", () => {
        const thresholds = {
            k1: 21,
            k2: 26,
            k3: 27,
            k4: 29
        };
        (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(27, 70, thresholds)).toBe(6);
        (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(30, 70, thresholds)).toBe(6);
    });
    (0, globals_1.it)("recommends correct fan counts for K1-K4 thresholds", () => {
        const thresholds = {
            k1: 25,
            k2: 30,
            k3: 35,
            k4: 40
        };
        (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(24, 70, thresholds)).toBe(0);
        (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(26, 70, thresholds)).toBe(2); // K1
        (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(31, 70, thresholds)).toBe(4); // K2
        (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(36, 70, thresholds)).toBe(6); // K3
        (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(41, 70, thresholds)).toBe(6); // K4
    });
});

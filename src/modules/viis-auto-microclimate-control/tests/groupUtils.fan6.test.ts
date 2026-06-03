import { describe, it, expect } from "@jest/globals";
import {
    createFanGroupActions,
    getAllFanKeys,
    getRecommendedGroupSize
} from "../utils/groupUtils";

describe("groupUtils - fan6 support", () => {
    it("returns quat_6 in default fan key set", () => {
        expect(getAllFanKeys()).toEqual([
            "quat_1",
            "quat_2",
            "quat_3",
            "quat_4",
            "quat_5",
            "quat_6"
        ]);
    });

    it("generates actions for quat_6 in target group", () => {
        const actions = createFanGroupActions(
            ["quat_6"],
            true,
            "test fan6",
            {
                quat_1: 0,
                quat_2: 1,
                quat_3: 2,
                quat_4: 3,
                quat_5: 4,
                quat_6: 5
            }
        );

        const fan6Action = actions.find(a => a.deviceKey === "quat_6");
        expect(fan6Action).toBeDefined();
        expect(fan6Action?.value).toBe(true);
        expect(fan6Action?.address).toBe(5);
    });

    it("recommends 4 fans for K3 and 6 fans for K4 temperature ranges", () => {
        const thresholds = {
            k1: 21,
            k2: 26,
            k3: 27,
            k4: 29
        };

        expect(getRecommendedGroupSize(27, 70, thresholds)).toBe(4); // K3 → 4 fans
        expect(getRecommendedGroupSize(30, 70, thresholds)).toBe(6); // K4 → 6 fans
    });

    it("recommends correct fan counts for K1-K4 thresholds", () => {
        const thresholds = {
            k1: 25,
            k2: 30,
            k3: 35,
            k4: 40
        };

        expect(getRecommendedGroupSize(24, 70, thresholds)).toBe(0);
        expect(getRecommendedGroupSize(26, 70, thresholds)).toBe(2); // K1
        expect(getRecommendedGroupSize(31, 70, thresholds)).toBe(3); // K2
        expect(getRecommendedGroupSize(36, 70, thresholds)).toBe(4); // K3
        expect(getRecommendedGroupSize(41, 70, thresholds)).toBe(6); // K4
    });
});

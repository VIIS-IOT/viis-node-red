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

    it("recommends 6 fans for K3 and K4 temperature ranges", () => {
        const thresholds = {
            k1: 21,
            k2: 26,
            k3: 27,
            k4: 29
        };

        expect(getRecommendedGroupSize(27, 70, thresholds)).toBe(6);
        expect(getRecommendedGroupSize(30, 70, thresholds)).toBe(6);
    });
});

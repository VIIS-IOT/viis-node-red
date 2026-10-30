import { describe, it, expect } from "@jest/globals";
import { CURTAIN_CONFIG, FAN_CONFIG, FAN_DAO_CONFIG } from "../constants";
import { resolveCoilMapping } from "../utils/coilMapping";

function globalContextWith(values: Record<string, unknown>) {
    return { get: (key: string) => values[key] };
}

const BOARD1_COILS = {
    quat_1: 0, quat_2: 1, quat_3: 2, quat_4: 3, quat_5: 4, quat_6: 5,
    quat_dao_1: 6, quat_dao_2: 7, quat_dao_3: 8,
    quat_7: 20, quat_tren_1: 26,
    luoi_3_thu: 14, luoi_3_dai: 15,
};

describe("resolveCoilMapping", () => {
    it("falls back to the VIIS defaults when the board has no mapping", () => {
        const mapping = resolveCoilMapping(globalContextWith({}), CURTAIN_CONFIG.COIL_MAPPING);
        expect(mapping).toEqual(CURTAIN_CONFIG.COIL_MAPPING);
    });

    it("takes managed keys from modbusMappings of the default board", () => {
        const ctx = globalContextWith({ modbusMappings: { board1: { coils: BOARD1_COILS } } });
        const mapping = resolveCoilMapping(ctx, CURTAIN_CONFIG.COIL_MAPPING);
        expect(mapping).toEqual({ luoi_3_thu: 14, luoi_3_dai: 15 });
    });

    it("never picks up unmanaged coils such as quat_7 or quat_tren_1", () => {
        const ctx = globalContextWith({ modbusMappings: JSON.stringify({ board1: { coils: BOARD1_COILS } }) });
        const mapping = resolveCoilMapping(ctx, { ...FAN_CONFIG.COIL_MAPPING, ...FAN_DAO_CONFIG.COIL_MAPPING });
        expect(mapping.quat_7).toBeUndefined();
        expect(mapping.quat_tren_1).toBeUndefined();
        expect(mapping.quat_dao_3).toBe(8);
    });

    it("uses the requested board, then the legacy modbusCoils override", () => {
        const ctx = globalContextWith({
            modbusMappings: { board1: { coils: BOARD1_COILS }, board2: { coils: { luoi_1_thu: 40, luoi_1_dai: 41 } } },
            modbusCoils: { luoi_1_dai: 42 },
        });
        const mapping = resolveCoilMapping(ctx, CURTAIN_CONFIG.COIL_MAPPING, "board2");
        expect(mapping).toEqual({ luoi_1_thu: 40, luoi_1_dai: 42 });
    });
});

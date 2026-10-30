import { describe, it, expect, jest } from "@jest/globals";
import { CURTAIN_CONFIG, FAN_CONFIG, FAN_DAO_CONFIG } from "../constants";
import { resolveCoilMapping } from "../utils/coilMapping";
import { FanControlService } from "../services/fanControlService";

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

describe("fan dao runs while the main fans are manual", () => {
    it("toggles fan dao with set_mode_fan = 0, using board addresses", async () => {
        const store: Record<string, any> = {
            fanRotationState_dao_sync: { isOn: false, lastToggleTime: Date.now() - 31 * 60 * 1000 },
        };
        const flowContext = { get: (k: string) => store[k], set: (k: string, v: any) => { store[k] = v; } };
        const globalContext = globalContextWith({
            modbusMappings: { board1: { coils: { ...BOARD1_COILS, quat_dao_1: 30, quat_dao_2: 31, quat_dao_3: 32 } } },
        });
        const service = new FanControlService({
            node: { status: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            nodeId: "test",
            flowContext,
            globalContext,
            environmentConfig: {} as any,
        });

        const actions = await service.processFanControl(
            { set_mode_fan: 0, set_mode_fan_dao: 1, set_auto_mode_fan_dao: 1, set_time_fan_dao_on: 5, set_time_fan_dao_off: 30 } as any,
            {} as any,
            {} as any
        );

        expect(actions.map(a => [a.deviceKey, a.address, a.value])).toEqual([
            ["quat_dao_1", 30, true],
            ["quat_dao_2", 31, true],
            ["quat_dao_3", 32, true],
        ]);
    });
});

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CurtainControlService } from "../services/curtainControlService";
import { CURTAIN_CONFIG, MODBUS_FUNCTION_CODES } from "../constants";

function createMockFlowContext() {
    const store: Record<string, any> = {};
    return {
        get: (key: string) => store[key],
        set: (key: string, value: any) => { store[key] = value; },
        _store: store,
    };
}

function createMockGlobalContext() {
    return {
        get: (_key: string) => ({}),
    };
}

function createMockLogger() {
    return {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
}

function createService() {
    const flowContext = createMockFlowContext();
    const globalContext = createMockGlobalContext();
    const node = { status: jest.fn() };

    const service = new CurtainControlService({
        node,
        nodeId: "test-node",
        flowContext,
        globalContext,
        environmentConfig: {} as any,
    });

    return { service, flowContext };
}

describe("Curtain Control - Luoi_4 Support", () => {
    describe("constants", () => {
        it("LUOI_MAPPING includes luoi_4", () => {
            expect(CURTAIN_CONFIG.LUOI_MAPPING["luoi_4"]).toBeDefined();
            expect(CURTAIN_CONFIG.LUOI_MAPPING["luoi_4"].thu).toBe("luoi_4_thu");
            expect(CURTAIN_CONFIG.LUOI_MAPPING["luoi_4"].dai).toBe("luoi_4_dai");
        });

        it("COIL_MAPPING includes luoi_4 coils", () => {
            expect(CURTAIN_CONFIG.COIL_MAPPING["luoi_4_thu"]).toBeDefined();
            expect(CURTAIN_CONFIG.COIL_MAPPING["luoi_4_dai"]).toBeDefined();
        });

        it("COIL_PAIRS includes luoi_4", () => {
            const luoi4Pair = CURTAIN_CONFIG.COIL_PAIRS.find(
                p => p.key1 === "luoi_4_thu" && p.key2 === "luoi_4_dai"
            );
            expect(luoi4Pair).toBeDefined();
        });

        it("COIL_PAIRS has 4 entries (luoi_1 through luoi_4)", () => {
            expect(CURTAIN_CONFIG.COIL_PAIRS).toHaveLength(4);
        });
    });

    describe("processCurtainControl", () => {
        it("returns empty when curtain control is disabled", async () => {
            const { service } = createService();
            const actions = await service.processCurtainControl(
                { set_mode_luoi: 0 } as any,
                { light_outdoor: 50000, light_indoor: 20000 } as any,
                {} as any
            );
            expect(actions).toEqual([]);
        });

        it("returns empty when outdoor light data is missing", async () => {
            const { service } = createService();
            const actions = await service.processCurtainControl(
                { set_mode_luoi: 1 } as any,
                { light_outdoor: undefined, light_indoor: 20000 } as any,
                {} as any
            );
            expect(actions).toEqual([]);
        });

        it("processes all 4 curtains when enabled", async () => {
            const { service, flowContext } = createService();

            // Set tolerance timer to already elapsed (to trigger immediate action)
            const now = Date.now();
            flowContext.set("curtainToleranceTimers", [
                { luoiId: "luoi_1", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_2", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_3", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_4", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
            ]);

            const actions = await service.processCurtainControl(
                {
                    set_mode_luoi: 1,
                    set_light_dai_luoi_1: 50000,
                    set_light_thu_luoi_1: 30000,
                    set_light_indoor_thu_luoi_1: 15000,
                    set_tolerance_light_luoi_1: 5,
                    set_light_dai_luoi_2: 50000,
                    set_light_thu_luoi_2: 30000,
                    set_light_indoor_thu_luoi_2: 15000,
                    set_tolerance_light_luoi_2: 5,
                    set_light_dai_luoi_3: 50000,
                    set_light_thu_luoi_3: 30000,
                    set_light_indoor_thu_luoi_3: 15000,
                    set_tolerance_light_luoi_3: 5,
                    set_light_dai_luoi_4: 50000,
                    set_light_thu_luoi_4: 30000,
                    set_light_indoor_thu_luoi_4: 15000,
                    set_tolerance_light_luoi_4: 5,
                } as any,
                {
                    light_outdoor: 60000, // Above dai threshold
                    light_indoor: 20000,
                } as any,
                {
                    luoi_1_thu: false,
                    luoi_1_dai: false,
                    luoi_2_thu: false,
                    luoi_2_dai: false,
                    luoi_3_thu: false,
                    luoi_3_dai: false,
                    luoi_4_thu: false,
                    luoi_4_dai: false,
                } as any
            );

            // Should have actions for all 4 curtains (each has thu OFF + dai ON = 2 actions)
            const luoi4Actions = actions.filter(
                a => a.deviceKey === "luoi_4_thu" || a.deviceKey === "luoi_4_dai"
            );
            expect(luoi4Actions.length).toBeGreaterThan(0);
        });

        it("starts tolerance timer for luoi_4 when light exceeds threshold", async () => {
            const { service, flowContext } = createService();

            await service.processCurtainControl(
                {
                    set_mode_luoi: 1,
                    set_light_dai_luoi_4: 50000,
                    set_light_thu_luoi_4: 30000,
                    set_light_indoor_thu_luoi_4: 15000,
                    set_tolerance_light_luoi_4: 5,
                } as any,
                {
                    light_outdoor: 60000, // Above dai threshold
                    light_indoor: 20000,
                } as any,
                {
                    luoi_4_thu: false,
                    luoi_4_dai: false,
                } as any
            );

            const timers = flowContext.get("curtainToleranceTimers");
            expect(Array.isArray(timers)).toBe(true);
            const luoi4Timer = timers.find((t: any) => t.luoiId === "luoi_4");
            expect(luoi4Timer).toBeDefined();
            expect(luoi4Timer.targetAction).toBe("dai");
        });

        it("retracts luoi_4 when light is low", async () => {
            const { service, flowContext } = createService();

            // Pre-set an elapsed tolerance timer for thu action
            const now = Date.now();
            flowContext.set("curtainToleranceTimers", [
                { luoiId: "luoi_4", startTime: now - 10 * 60 * 1000, targetAction: "thu", lightValue: 20000 },
            ]);

            const actions = await service.processCurtainControl(
                {
                    set_mode_luoi: 1,
                    set_light_dai_luoi_4: 50000,
                    set_light_thu_luoi_4: 30000,
                    set_light_indoor_thu_luoi_4: 15000,
                    set_tolerance_light_luoi_4: 5,
                } as any,
                {
                    light_outdoor: 20000, // Below thu threshold
                    light_indoor: 10000,
                } as any,
                {
                    luoi_4_thu: false,
                    luoi_4_dai: true, // Currently extended
                } as any
            );

            // Should have thu actions for luoi_4
            const luoi4ThuAction = actions.find(
                a => a.deviceKey === "luoi_4_thu" && a.value === true
            );
            expect(luoi4ThuAction).toBeDefined();
        });
    });

    describe("handleLuoiCommand", () => {
        it("creates correct 2-coil actions for dai (extend)", async () => {
            const { service } = createService();
            const actions = await service.handleLuoiCommand("luoi_4", "dai");

            expect(actions).toHaveLength(2);
            // Should turn OFF thu, turn ON dai
            const thuAction = actions.find(a => a.deviceKey === "luoi_4_thu");
            const daiAction = actions.find(a => a.deviceKey === "luoi_4_dai");
            expect(thuAction?.value).toBe(false);
            expect(daiAction?.value).toBe(true);
        });

        it("creates correct 2-coil actions for thu (retract)", async () => {
            const { service } = createService();
            const actions = await service.handleLuoiCommand("luoi_4", "thu");

            expect(actions).toHaveLength(2);
            // Should turn OFF dai, turn ON thu
            const daiAction = actions.find(a => a.deviceKey === "luoi_4_dai");
            const thuAction = actions.find(a => a.deviceKey === "luoi_4_thu");
            expect(daiAction?.value).toBe(false);
            expect(thuAction?.value).toBe(true);
        });

        it("works for all 4 luoi types", async () => {
            const { service } = createService();

            for (const luoiKey of ["luoi_1", "luoi_2", "luoi_3", "luoi_4"]) {
                const actions = await service.handleLuoiCommand(luoiKey, "dai");
                expect(actions).toHaveLength(2);
                expect(actions.some(a => a.deviceKey === `${luoiKey}_thu` && a.value === false)).toBe(true);
                expect(actions.some(a => a.deviceKey === `${luoiKey}_dai` && a.value === true)).toBe(true);
            }
        });
    });
});

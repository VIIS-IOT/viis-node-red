"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const curtainControlService_1 = require("../services/curtainControlService");
const constants_1 = require("../constants");
function createMockFlowContext() {
    const store = {};
    return {
        get: (key) => store[key],
        set: (key, value) => { store[key] = value; },
        _store: store,
    };
}
function createMockGlobalContext() {
    return {
        get: (_key) => ({}),
    };
}
function createMockLogger() {
    return {
        log: globals_1.jest.fn(),
        warn: globals_1.jest.fn(),
        error: globals_1.jest.fn(),
        debug: globals_1.jest.fn(),
    };
}
function createService() {
    const flowContext = createMockFlowContext();
    const globalContext = createMockGlobalContext();
    const node = { status: globals_1.jest.fn() };
    const service = new curtainControlService_1.CurtainControlService({
        node,
        nodeId: "test-node",
        flowContext,
        globalContext,
        environmentConfig: {},
    });
    return { service, flowContext };
}
(0, globals_1.describe)("Curtain Control - Luoi_4 Support", () => {
    (0, globals_1.describe)("constants", () => {
        (0, globals_1.it)("LUOI_MAPPING includes luoi_4", () => {
            (0, globals_1.expect)(constants_1.CURTAIN_CONFIG.LUOI_MAPPING["luoi_4"]).toBeDefined();
            (0, globals_1.expect)(constants_1.CURTAIN_CONFIG.LUOI_MAPPING["luoi_4"].thu).toBe("luoi_4_thu");
            (0, globals_1.expect)(constants_1.CURTAIN_CONFIG.LUOI_MAPPING["luoi_4"].dai).toBe("luoi_4_dai");
        });
        (0, globals_1.it)("COIL_MAPPING includes luoi_4 coils", () => {
            (0, globals_1.expect)(constants_1.CURTAIN_CONFIG.COIL_MAPPING["luoi_4_thu"]).toBeDefined();
            (0, globals_1.expect)(constants_1.CURTAIN_CONFIG.COIL_MAPPING["luoi_4_dai"]).toBeDefined();
        });
        (0, globals_1.it)("COIL_PAIRS includes luoi_4", () => {
            const luoi4Pair = constants_1.CURTAIN_CONFIG.COIL_PAIRS.find(p => p.key1 === "luoi_4_thu" && p.key2 === "luoi_4_dai");
            (0, globals_1.expect)(luoi4Pair).toBeDefined();
        });
        (0, globals_1.it)("COIL_PAIRS has 4 entries (luoi_1 through luoi_4)", () => {
            (0, globals_1.expect)(constants_1.CURTAIN_CONFIG.COIL_PAIRS).toHaveLength(4);
        });
    });
    (0, globals_1.describe)("processCurtainControl", () => {
        (0, globals_1.it)("returns empty when curtain control is disabled", async () => {
            const { service } = createService();
            const actions = await service.processCurtainControl({ set_mode_luoi: 0 }, { light_outdoor: 50000, light_indoor: 20000 }, {});
            (0, globals_1.expect)(actions).toEqual([]);
        });
        (0, globals_1.it)("returns empty when outdoor light data is missing", async () => {
            const { service } = createService();
            const actions = await service.processCurtainControl({ set_mode_luoi: 1 }, { light_outdoor: undefined, light_indoor: 20000 }, {});
            (0, globals_1.expect)(actions).toEqual([]);
        });
        (0, globals_1.it)("processes all 4 curtains when enabled", async () => {
            const { service, flowContext } = createService();
            // Set tolerance timer to already elapsed (to trigger immediate action)
            const now = Date.now();
            flowContext.set("curtainToleranceTimers", [
                { luoiId: "luoi_1", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_2", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_3", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_4", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
            ]);
            const actions = await service.processCurtainControl({
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
            }, {
                light_outdoor: 60000, // Above dai threshold
                light_indoor: 20000,
            }, {
                luoi_1_thu: false,
                luoi_1_dai: false,
                luoi_2_thu: false,
                luoi_2_dai: false,
                luoi_3_thu: false,
                luoi_3_dai: false,
                luoi_4_thu: false,
                luoi_4_dai: false,
            });
            // Should have actions for all 4 curtains (each has thu OFF + dai ON = 2 actions)
            const luoi4Actions = actions.filter(a => a.deviceKey === "luoi_4_thu" || a.deviceKey === "luoi_4_dai");
            (0, globals_1.expect)(luoi4Actions.length).toBeGreaterThan(0);
        });
        (0, globals_1.it)("starts tolerance timer for luoi_4 when light exceeds threshold", async () => {
            const { service, flowContext } = createService();
            await service.processCurtainControl({
                set_mode_luoi: 1,
                set_light_dai_luoi_4: 50000,
                set_light_thu_luoi_4: 30000,
                set_light_indoor_thu_luoi_4: 15000,
                set_tolerance_light_luoi_4: 5,
            }, {
                light_outdoor: 60000, // Above dai threshold
                light_indoor: 20000,
            }, {
                luoi_4_thu: false,
                luoi_4_dai: false,
            });
            const timers = flowContext.get("curtainToleranceTimers");
            (0, globals_1.expect)(Array.isArray(timers)).toBe(true);
            const luoi4Timer = timers.find((t) => t.luoiId === "luoi_4");
            (0, globals_1.expect)(luoi4Timer).toBeDefined();
            (0, globals_1.expect)(luoi4Timer.targetAction).toBe("dai");
        });
        (0, globals_1.it)("retracts luoi_4 when light is low", async () => {
            const { service, flowContext } = createService();
            // Pre-set an elapsed tolerance timer for thu action
            const now = Date.now();
            flowContext.set("curtainToleranceTimers", [
                { luoiId: "luoi_4", startTime: now - 10 * 60 * 1000, targetAction: "thu", lightValue: 20000 },
            ]);
            const actions = await service.processCurtainControl({
                set_mode_luoi: 1,
                set_light_dai_luoi_4: 50000,
                set_light_thu_luoi_4: 30000,
                set_light_indoor_thu_luoi_4: 15000,
                set_tolerance_light_luoi_4: 5,
            }, {
                light_outdoor: 20000, // Below thu threshold
                light_indoor: 10000,
            }, {
                luoi_4_thu: false,
                luoi_4_dai: true, // Currently extended
            });
            // Should have thu actions for luoi_4
            const luoi4ThuAction = actions.find(a => a.deviceKey === "luoi_4_thu" && a.value === true);
            (0, globals_1.expect)(luoi4ThuAction).toBeDefined();
        });
    });
    (0, globals_1.describe)("handleLuoiCommand", () => {
        (0, globals_1.it)("creates correct 2-coil actions for dai (extend)", async () => {
            const { service } = createService();
            const actions = await service.handleLuoiCommand("luoi_4", "dai");
            (0, globals_1.expect)(actions).toHaveLength(2);
            // Should turn OFF thu, turn ON dai
            const thuAction = actions.find(a => a.deviceKey === "luoi_4_thu");
            const daiAction = actions.find(a => a.deviceKey === "luoi_4_dai");
            (0, globals_1.expect)(thuAction === null || thuAction === void 0 ? void 0 : thuAction.value).toBe(false);
            (0, globals_1.expect)(daiAction === null || daiAction === void 0 ? void 0 : daiAction.value).toBe(true);
        });
        (0, globals_1.it)("creates correct 2-coil actions for thu (retract)", async () => {
            const { service } = createService();
            const actions = await service.handleLuoiCommand("luoi_4", "thu");
            (0, globals_1.expect)(actions).toHaveLength(2);
            // Should turn OFF dai, turn ON thu
            const daiAction = actions.find(a => a.deviceKey === "luoi_4_dai");
            const thuAction = actions.find(a => a.deviceKey === "luoi_4_thu");
            (0, globals_1.expect)(daiAction === null || daiAction === void 0 ? void 0 : daiAction.value).toBe(false);
            (0, globals_1.expect)(thuAction === null || thuAction === void 0 ? void 0 : thuAction.value).toBe(true);
        });
        (0, globals_1.it)("works for all 4 luoi types", async () => {
            const { service } = createService();
            for (const luoiKey of ["luoi_1", "luoi_2", "luoi_3", "luoi_4"]) {
                const actions = await service.handleLuoiCommand(luoiKey, "dai");
                (0, globals_1.expect)(actions).toHaveLength(2);
                (0, globals_1.expect)(actions.some(a => a.deviceKey === `${luoiKey}_thu` && a.value === false)).toBe(true);
                (0, globals_1.expect)(actions.some(a => a.deviceKey === `${luoiKey}_dai` && a.value === true)).toBe(true);
            }
        });
    });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const waterPumpControlService_1 = require("../services/waterPumpControlService");
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
    const service = new waterPumpControlService_1.WaterPumpControlService({
        node,
        nodeId: "test-node",
        flowContext,
        globalContext,
        environmentConfig: {},
    });
    return { service, flowContext };
}
(0, globals_1.describe)("Water Pump K4 Override", () => {
    (0, globals_1.describe)("checkK4PriorityOverride", () => {
        (0, globals_1.it)("activates when temp >= K4 and fan in threshold mode", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride({
                set_k4_fan: 40,
                set_mode_fan: 1,
                set_auto_mode_fan: 0, // threshold mode (0=theo nhiệt độ)
            }, {
                temp_indoor: 42,
                humi_indoor: 50,
            });
            (0, globals_1.expect)(actions).toHaveLength(1);
            (0, globals_1.expect)(actions[0].deviceKey).toBe("bom_nuoc_1");
            (0, globals_1.expect)(actions[0].value).toBe(true);
            (0, globals_1.expect)(actions[0].fc).toBe(constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL);
        });
        (0, globals_1.it)("does NOT check humidity — activates regardless of humidity level", () => {
            const { service } = createService();
            // High humidity (90%) — old code would NOT activate, new code SHOULD activate
            const actions = service.checkK4PriorityOverride({
                set_k4_fan: 40,
                set_mode_fan: 1,
                set_auto_mode_fan: 0, // threshold mode
            }, {
                temp_indoor: 42,
                humi_indoor: 90, // Very high humidity
            });
            (0, globals_1.expect)(actions).toHaveLength(1);
            (0, globals_1.expect)(actions[0].value).toBe(true);
        });
        (0, globals_1.it)("does NOT activate when temp < K4", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride({
                set_k4_fan: 40,
                set_mode_fan: 1,
                set_auto_mode_fan: 1,
            }, {
                temp_indoor: 38,
                humi_indoor: 50,
            });
            (0, globals_1.expect)(actions).toEqual([]);
        });
        (0, globals_1.it)("does NOT activate when fan is in rotation mode (autoMode=1)", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride({
                set_k4_fan: 40,
                set_mode_fan: 1,
                set_auto_mode_fan: 1, // rotation mode (1=luân phiên)
            }, {
                temp_indoor: 42,
                humi_indoor: 50,
            });
            (0, globals_1.expect)(actions).toEqual([]);
        });
        (0, globals_1.it)("does NOT activate when fan control is disabled (mode=0)", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride({
                set_k4_fan: 40,
                set_mode_fan: 0, // disabled
                set_auto_mode_fan: 1,
            }, {
                temp_indoor: 42,
                humi_indoor: 50,
            });
            (0, globals_1.expect)(actions).toEqual([]);
        });
        (0, globals_1.it)("activates at exact K4 threshold (boundary)", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride({
                set_k4_fan: 40,
                set_mode_fan: 1,
                set_auto_mode_fan: 0, // threshold mode
            }, {
                temp_indoor: 40, // Exactly at K4
                humi_indoor: 50,
            });
            (0, globals_1.expect)(actions).toHaveLength(1);
            (0, globals_1.expect)(actions[0].value).toBe(true);
        });
        (0, globals_1.it)("returns empty when sensor data is missing", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride({
                set_k4_fan: 40,
                set_mode_fan: 1,
                set_auto_mode_fan: 0, // threshold mode
            }, {
                temp_indoor: undefined,
                humi_indoor: undefined,
            });
            (0, globals_1.expect)(actions).toEqual([]);
        });
    });
});

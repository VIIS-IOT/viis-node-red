import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { WaterPumpControlService } from "../services/waterPumpControlService";
import { MODBUS_FUNCTION_CODES } from "../constants";

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

    const service = new WaterPumpControlService({
        node,
        nodeId: "test-node",
        flowContext,
        globalContext,
        environmentConfig: {} as any,
    });

    return { service, flowContext };
}

describe("Water Pump K4 Override", () => {
    describe("checkK4PriorityOverride", () => {
        it("activates when temp >= K4 and fan in threshold mode", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride(
                {
                    set_k4_fan: 40,
                    set_mode_fan: 1,
                    set_auto_mode_fan: 0, // threshold mode (0=theo nhiệt độ)
                } as any,
                {
                    temp_indoor: 42,
                    humi_indoor: 50,
                } as any
            );

            expect(actions).toHaveLength(1);
            expect(actions[0].deviceKey).toBe("bom_nuoc_1");
            expect(actions[0].value).toBe(true);
            expect(actions[0].fc).toBe(MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL);
        });

        it("does NOT check humidity — activates regardless of humidity level", () => {
            const { service } = createService();
            // High humidity (90%) — old code would NOT activate, new code SHOULD activate
            const actions = service.checkK4PriorityOverride(
                {
                    set_k4_fan: 40,
                    set_mode_fan: 1,
                    set_auto_mode_fan: 0, // threshold mode
                } as any,
                {
                    temp_indoor: 42,
                    humi_indoor: 90, // Very high humidity
                } as any
            );

            expect(actions).toHaveLength(1);
            expect(actions[0].value).toBe(true);
        });

        it("does NOT activate when temp < K4", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride(
                {
                    set_k4_fan: 40,
                    set_mode_fan: 1,
                    set_auto_mode_fan: 1,
                } as any,
                {
                    temp_indoor: 38,
                    humi_indoor: 50,
                } as any
            );

            expect(actions).toEqual([]);
        });

        it("does NOT activate when fan is in rotation mode (autoMode=1)", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride(
                {
                    set_k4_fan: 40,
                    set_mode_fan: 1,
                    set_auto_mode_fan: 1, // rotation mode (1=luân phiên)
                } as any,
                {
                    temp_indoor: 42,
                    humi_indoor: 50,
                } as any
            );

            expect(actions).toEqual([]);
        });

        it("does NOT activate when fan control is disabled (mode=0)", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride(
                {
                    set_k4_fan: 40,
                    set_mode_fan: 0, // disabled
                    set_auto_mode_fan: 1,
                } as any,
                {
                    temp_indoor: 42,
                    humi_indoor: 50,
                } as any
            );

            expect(actions).toEqual([]);
        });

        it("activates at exact K4 threshold (boundary)", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride(
                {
                    set_k4_fan: 40,
                    set_mode_fan: 1,
                    set_auto_mode_fan: 0, // threshold mode
                } as any,
                {
                    temp_indoor: 40, // Exactly at K4
                    humi_indoor: 50,
                } as any
            );

            expect(actions).toHaveLength(1);
            expect(actions[0].value).toBe(true);
        });

        it("returns empty when sensor data is missing", () => {
            const { service } = createService();
            const actions = service.checkK4PriorityOverride(
                {
                    set_k4_fan: 40,
                    set_mode_fan: 1,
                    set_auto_mode_fan: 0, // threshold mode
                } as any,
                {
                    temp_indoor: undefined,
                    humi_indoor: undefined,
                } as any
            );

            expect(actions).toEqual([]);
        });
    });
});

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { ConfigService } from "../services/configService";

function createMockGlobalContext(initialConfig: Record<string, any> = {}) {
    const store: Record<string, any> = {
        configKeyValues: initialConfig,
    };
    return {
        get: (key: string) => store[key],
        set: (key: string, value: any) => { store[key] = value; },
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

function createConfigService(config: Record<string, any> = {}) {
    const globalContext = createMockGlobalContext(config);
    const node = { warn: jest.fn() };
    const service = new ConfigService({
        node,
        nodeId: "test-node",
        flowContext: {} as any,
        globalContext,
        environmentConfig: {} as any,
    });
    return { service, globalContext };
}

describe("ConfigService — Per-Section Validation", () => {
    describe("isFanConfigValid", () => {
        it("returns true when fan config is valid", () => {
            const { service } = createConfigService({
                set_mode_fan: 1,
                set_auto_mode_fan: 0,
                set_k1_fan: 21,
                set_k2_fan: 25,
                set_k3_fan: 27,
                set_k4_fan: 29,
                set_gr_alternate_fan: 2,
                set_time_alternate_fan: 15,
            });
            expect(service.isFanConfigValid()).toBe(true);
        });

        it("returns true when fan config is empty (uses defaults)", () => {
            const { service } = createConfigService({});
            expect(service.isFanConfigValid()).toBe(true);
        });

        it("returns false when set_mode_fan is invalid", () => {
            const { service } = createConfigService({ set_mode_fan: 5 });
            expect(service.isFanConfigValid()).toBe(false);
        });

        it("returns false when set_k1_fan is out of range", () => {
            const { service } = createConfigService({ set_k1_fan: 150 });
            expect(service.isFanConfigValid()).toBe(false);
        });

        it("returns false when set_gr_alternate_fan is invalid", () => {
            const { service } = createConfigService({ set_gr_alternate_fan: 5 });
            expect(service.isFanConfigValid()).toBe(false);
        });
    });

    describe("isWaterPumpConfigValid", () => {
        it("returns true when water pump config is valid", () => {
            const { service } = createConfigService({
                set_mode_tuong_nuoc: 1,
                set_threshold_low_water_bump: 60,
                set_threshold_high_water_bump: 80,
            });
            expect(service.isWaterPumpConfigValid()).toBe(true);
        });

        it("returns true when water pump config is empty (uses defaults)", () => {
            const { service } = createConfigService({});
            expect(service.isWaterPumpConfigValid()).toBe(true);
        });

        it("returns false when set_mode_tuong_nuoc is invalid", () => {
            const { service } = createConfigService({ set_mode_tuong_nuoc: 3 });
            expect(service.isWaterPumpConfigValid()).toBe(false);
        });

        it("returns false when threshold > 100", () => {
            const { service } = createConfigService({ set_threshold_high_water_bump: 110 });
            expect(service.isWaterPumpConfigValid()).toBe(false);
        });
    });

    describe("isCurtainConfigValid", () => {
        it("returns true when curtain config is valid", () => {
            const { service } = createConfigService({
                set_mode_luoi: 1,
                set_light_dai_luoi_1: 50000,
                set_light_thu_luoi_1: 30000,
                set_tolerance_light_luoi_1: 5,
                set_light_dai_luoi_2: 50000,
                set_light_thu_luoi_2: 30000,
                set_tolerance_light_luoi_2: 5,
            });
            expect(service.isCurtainConfigValid()).toBe(true);
        });

        it("returns true when curtain config is empty (uses defaults)", () => {
            const { service } = createConfigService({});
            expect(service.isCurtainConfigValid()).toBe(true);
        });

        it("returns true when tolerance is 0 (immediate execution)", () => {
            const { service } = createConfigService({
                set_tolerance_light_luoi_1: 0,
                set_tolerance_light_luoi_2: 0,
            });
            expect(service.isCurtainConfigValid()).toBe(true);
        });

        it("returns true when light thresholds are 0", () => {
            const { service } = createConfigService({
                set_light_dai_luoi_1: 0,
                set_light_thu_luoi_1: 0,
                set_light_dai_luoi_2: 0,
                set_light_thu_luoi_2: 0,
            });
            expect(service.isCurtainConfigValid()).toBe(true);
        });

        it("returns false when set_mode_luoi is invalid", () => {
            const { service } = createConfigService({ set_mode_luoi: 5 });
            expect(service.isCurtainConfigValid()).toBe(false);
        });

        it("returns false when light threshold is negative", () => {
            const { service } = createConfigService({ set_light_dai_luoi_1: -100 });
            expect(service.isCurtainConfigValid()).toBe(false);
        });
    });

    describe("isConfigValid (backward compat)", () => {
        it("returns true when all sections are valid", () => {
            const { service } = createConfigService({
                set_mode_fan: 1,
                set_mode_tuong_nuoc: 1,
                set_mode_luoi: 1,
                set_tolerance_light_luoi_1: 5,
            });
            expect(service.isConfigValid()).toBe(true);
        });

        it("returns false when any section is invalid", () => {
            const { service } = createConfigService({
                set_mode_fan: 99,
                set_mode_tuong_nuoc: 1,
                set_mode_luoi: 1,
            });
            expect(service.isConfigValid()).toBe(false);
        });
    });

    describe("cross-section isolation", () => {
        it("invalid curtain config does not affect fan validation", () => {
            const { service } = createConfigService({
                set_mode_fan: 1,
                set_k1_fan: 25,
                set_mode_luoi: 99, // invalid
            });
            expect(service.isFanConfigValid()).toBe(true);
            expect(service.isCurtainConfigValid()).toBe(false);
        });

        it("invalid fan config does not affect water pump validation", () => {
            const { service } = createConfigService({
                set_mode_fan: 99, // invalid
                set_mode_tuong_nuoc: 1,
                set_threshold_low_water_bump: 60,
                set_threshold_high_water_bump: 80,
            });
            expect(service.isFanConfigValid()).toBe(false);
            expect(service.isWaterPumpConfigValid()).toBe(true);
        });

        it("the original tolerance=0 config passes curtain validation", () => {
            const { service } = createConfigService({
                set_mode_fan: 1,
                set_auto_mode_fan: 0,
                set_k1_fan: 21,
                set_k2_fan: 25,
                set_k3_fan: 27,
                set_k4_fan: 29,
                set_gr_alternate_fan: 1,
                set_time_alternate_fan: 5,
                set_mode_tuong_nuoc: 1,
                set_threshold_low_water_bump: 77,
                set_threshold_high_water_bump: 85,
                set_light_dai_luoi_1: 0,
                set_light_thu_luoi_1: 0,
                set_tolerance_light_luoi_1: 0,
                set_light_dai_luoi_2: 0,
                set_light_thu_luoi_2: 0,
                set_tolerance_light_luoi_2: 0,
                set_mode_luoi: 0,
            });
            expect(service.isFanConfigValid()).toBe(true);
            expect(service.isWaterPumpConfigValid()).toBe(true);
            expect(service.isCurtainConfigValid()).toBe(true);
            expect(service.isConfigValid()).toBe(true);
        });
    });
});

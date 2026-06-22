"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const configService_1 = require("../services/configService");
function createMockGlobalContext(initialConfig = {}) {
    const store = {
        configKeyValues: initialConfig,
    };
    return {
        get: (key) => store[key],
        set: (key, value) => { store[key] = value; },
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
function createConfigService(config = {}) {
    const globalContext = createMockGlobalContext(config);
    const node = { warn: globals_1.jest.fn() };
    const service = new configService_1.ConfigService({
        node,
        nodeId: "test-node",
        flowContext: {},
        globalContext,
        environmentConfig: {},
    });
    return { service, globalContext };
}
(0, globals_1.describe)("ConfigService — Per-Section Validation", () => {
    (0, globals_1.describe)("isFanConfigValid", () => {
        (0, globals_1.it)("returns true when fan config is valid", () => {
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
            (0, globals_1.expect)(service.isFanConfigValid()).toBe(true);
        });
        (0, globals_1.it)("returns true when fan config is empty (uses defaults)", () => {
            const { service } = createConfigService({});
            (0, globals_1.expect)(service.isFanConfigValid()).toBe(true);
        });
        (0, globals_1.it)("returns false when set_mode_fan is invalid", () => {
            const { service } = createConfigService({ set_mode_fan: 5 });
            (0, globals_1.expect)(service.isFanConfigValid()).toBe(false);
        });
        (0, globals_1.it)("returns false when set_k1_fan is out of range", () => {
            const { service } = createConfigService({ set_k1_fan: 150 });
            (0, globals_1.expect)(service.isFanConfigValid()).toBe(false);
        });
        (0, globals_1.it)("returns false when set_gr_alternate_fan is invalid", () => {
            const { service } = createConfigService({ set_gr_alternate_fan: 5 });
            (0, globals_1.expect)(service.isFanConfigValid()).toBe(false);
        });
    });
    (0, globals_1.describe)("isWaterPumpConfigValid", () => {
        (0, globals_1.it)("returns true when water pump config is valid", () => {
            const { service } = createConfigService({
                set_mode_tuong_nuoc: 1,
                set_threshold_low_water_bump: 60,
                set_threshold_high_water_bump: 80,
            });
            (0, globals_1.expect)(service.isWaterPumpConfigValid()).toBe(true);
        });
        (0, globals_1.it)("returns true when water pump config is empty (uses defaults)", () => {
            const { service } = createConfigService({});
            (0, globals_1.expect)(service.isWaterPumpConfigValid()).toBe(true);
        });
        (0, globals_1.it)("returns false when set_mode_tuong_nuoc is invalid", () => {
            const { service } = createConfigService({ set_mode_tuong_nuoc: 3 });
            (0, globals_1.expect)(service.isWaterPumpConfigValid()).toBe(false);
        });
        (0, globals_1.it)("returns false when threshold > 100", () => {
            const { service } = createConfigService({ set_threshold_high_water_bump: 110 });
            (0, globals_1.expect)(service.isWaterPumpConfigValid()).toBe(false);
        });
    });
    (0, globals_1.describe)("isCurtainConfigValid", () => {
        (0, globals_1.it)("returns true when curtain config is valid", () => {
            const { service } = createConfigService({
                set_mode_luoi: 1,
                set_light_dai_luoi_1: 50000,
                set_light_thu_luoi_1: 30000,
                set_tolerance_light_luoi_1: 5,
                set_light_dai_luoi_2: 50000,
                set_light_thu_luoi_2: 30000,
                set_tolerance_light_luoi_2: 5,
            });
            (0, globals_1.expect)(service.isCurtainConfigValid()).toBe(true);
        });
        (0, globals_1.it)("returns true when curtain config is empty (uses defaults)", () => {
            const { service } = createConfigService({});
            (0, globals_1.expect)(service.isCurtainConfigValid()).toBe(true);
        });
        (0, globals_1.it)("returns true when tolerance is 0 (immediate execution)", () => {
            const { service } = createConfigService({
                set_tolerance_light_luoi_1: 0,
                set_tolerance_light_luoi_2: 0,
            });
            (0, globals_1.expect)(service.isCurtainConfigValid()).toBe(true);
        });
        (0, globals_1.it)("returns true when light thresholds are 0", () => {
            const { service } = createConfigService({
                set_light_dai_luoi_1: 0,
                set_light_thu_luoi_1: 0,
                set_light_dai_luoi_2: 0,
                set_light_thu_luoi_2: 0,
            });
            (0, globals_1.expect)(service.isCurtainConfigValid()).toBe(true);
        });
        (0, globals_1.it)("returns false when set_mode_luoi is invalid", () => {
            const { service } = createConfigService({ set_mode_luoi: 5 });
            (0, globals_1.expect)(service.isCurtainConfigValid()).toBe(false);
        });
        (0, globals_1.it)("returns false when light threshold is negative", () => {
            const { service } = createConfigService({ set_light_dai_luoi_1: -100 });
            (0, globals_1.expect)(service.isCurtainConfigValid()).toBe(false);
        });
    });
    (0, globals_1.describe)("isConfigValid (backward compat)", () => {
        (0, globals_1.it)("returns true when all sections are valid", () => {
            const { service } = createConfigService({
                set_mode_fan: 1,
                set_mode_tuong_nuoc: 1,
                set_mode_luoi: 1,
                set_tolerance_light_luoi_1: 5,
            });
            (0, globals_1.expect)(service.isConfigValid()).toBe(true);
        });
        (0, globals_1.it)("returns false when any section is invalid", () => {
            const { service } = createConfigService({
                set_mode_fan: 99,
                set_mode_tuong_nuoc: 1,
                set_mode_luoi: 1,
            });
            (0, globals_1.expect)(service.isConfigValid()).toBe(false);
        });
    });
    (0, globals_1.describe)("cross-section isolation", () => {
        (0, globals_1.it)("invalid curtain config does not affect fan validation", () => {
            const { service } = createConfigService({
                set_mode_fan: 1,
                set_k1_fan: 25,
                set_mode_luoi: 99, // invalid
            });
            (0, globals_1.expect)(service.isFanConfigValid()).toBe(true);
            (0, globals_1.expect)(service.isCurtainConfigValid()).toBe(false);
        });
        (0, globals_1.it)("invalid fan config does not affect water pump validation", () => {
            const { service } = createConfigService({
                set_mode_fan: 99, // invalid
                set_mode_tuong_nuoc: 1,
                set_threshold_low_water_bump: 60,
                set_threshold_high_water_bump: 80,
            });
            (0, globals_1.expect)(service.isFanConfigValid()).toBe(false);
            (0, globals_1.expect)(service.isWaterPumpConfigValid()).toBe(true);
        });
        (0, globals_1.it)("the original tolerance=0 config passes curtain validation", () => {
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
            (0, globals_1.expect)(service.isFanConfigValid()).toBe(true);
            (0, globals_1.expect)(service.isWaterPumpConfigValid()).toBe(true);
            (0, globals_1.expect)(service.isCurtainConfigValid()).toBe(true);
            (0, globals_1.expect)(service.isConfigValid()).toBe(true);
        });
    });
});

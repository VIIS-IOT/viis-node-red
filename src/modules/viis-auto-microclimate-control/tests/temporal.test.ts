import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { FanControlService } from "../services/fanControlService";
import { WaterPumpControlService } from "../services/waterPumpControlService";
import { ConfigService } from "../services/configService";
import { SensorService } from "../services/sensorService";
import { CONTEXT_KEYS, CONTROL_CONFIG } from "../constants";
import { getRecommendedGroupSize } from "../utils/groupUtils";

// ─── Helpers ───────────────────────────────────────────────────────────────

function createMockGlobalContext(data: Record<string, any> = {}) {
    const store: Record<string, any> = { ...data };
    return {
        get: (key: string) => store[key],
        set: (key: string, value: any) => { store[key] = value; },
        _store: store,
    };
}

function createMockFlowContext() {
    const store: Record<string, any> = {};
    return {
        get: (key: string) => store[key],
        set: (key: string, value: any) => { store[key] = value; },
        _store: store,
    };
}

function createMockNode() {
    return { status: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() };
}

const DEFAULT_CONFIG: Record<string, any> = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0,
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_gr_alternate_fan: 2,
    set_time_alternate_fan: 15,
    set_mode_fan_dao: 1,
    set_auto_mode_fan_dao: 1,
    set_time_fan_dao_on: 5,
    set_time_fan_dao_off: 5,
    set_mode_tuong_nuoc: 1,
    set_threshold_low_water_bump: 60,
    set_threshold_high_water_bump: 85,
    set_mode_luoi: 1,
    set_light_dai_luoi_1: 50000,
    set_light_thu_luoi_1: 30000,
    set_tolerance_light_luoi_1: 5,
    set_light_dai_luoi_2: 50000,
    set_light_thu_luoi_2: 30000,
    set_tolerance_light_luoi_2: 5,
    set_fan_group_transition_delay: 0, // Disable transitions for testing
    set_fan_group_off_delay: 0,
};

function makeHolding(temp: number, humi: number, lightOut: number = 0): Record<string, any> {
    return {
        ts: Date.now(),
        temp_indoor: temp,
        humi_indoor: humi,
        temp_outdoor: 0,
        humi_outdoor: 0,
        light_indoor: 20000,
        light_outdoor: lightOut,
    };
}

function makeCoil(overrides: Record<string, boolean> = {}): Record<string, any> {
    return {
        ts: Date.now(),
        quat_1: false, quat_2: false, quat_3: false,
        quat_4: false, quat_5: false, quat_6: false,
        quat_dao_1: false, quat_dao_2: false, quat_dao_3: false,
        bom_nuoc_1: false,
        luoi_1_thu: false, luoi_1_dai: false,
        luoi_2_thu: false, luoi_2_dai: false,
        ...overrides,
    };
}

// ─── Temporal Tests ────────────────────────────────────────────────────────

describe("Temporal Transition Tests — Temperature Changes Over Time", () => {
    let flowContext: ReturnType<typeof createMockFlowContext>;
    let globalContext: ReturnType<typeof createMockGlobalContext>;

    beforeEach(() => {
        flowContext = createMockFlowContext();
        globalContext = createMockGlobalContext({
            configKeyValues: DEFAULT_CONFIG,
            holdingRegisterData: makeHolding(25, 70),
            coilRegisterData: makeCoil(),
        });
    });

    describe("Scenario: Temperature rises from cool to hot (K1=25, K2=30, K3=35, K4=40)", () => {
        it("22°C → 27°C → 32°C → 37°C → 42°C", async () => {
            let coils: Record<string, boolean> = {};
            const steps = [
                { temp: 22, humi: 70, expectedFans: 0, label: "Below K1" },
                { temp: 27, humi: 70, expectedFans: 2, label: "K1 (25-30)" },
                { temp: 32, humi: 70, expectedFans: 3, label: "K2 (30-35)" },
                { temp: 37, humi: 70, expectedFans: 4, label: "K3 (35-40)" },
                { temp: 42, humi: 70, expectedFans: 6, label: "K4 (≥40)" },
            ];

            for (const step of steps) {
                // Clear flow context to prevent transition state from persisting
                const freshFlow = createMockFlowContext();
                globalContext.set("holdingRegisterData", makeHolding(step.temp, step.humi, 0));
                globalContext.set("coilRegisterData", makeCoil(coils));

                const node = createMockNode();
                const options = { node, nodeId: "temporal-test", flowContext: freshFlow, globalContext, environmentConfig: {} as any };
                const fanService = new FanControlService(options);
                const configService = new ConfigService(options);
                const sensorService = new SensorService(options);

                const config = configService.getConfig();
                const sensorData = sensorService.getSensorData()!;
                const deviceStatus = sensorService.getDeviceStatus()!;

                const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);

                // Apply actions to coils to get final state
                for (const action of fanActions) {
                    if (action.value !== undefined) coils[action.deviceKey] = !!action.value;
                }

                // Count total fans ON after applying actions
                const fansOnCount = ["quat_1", "quat_2", "quat_3", "quat_4", "quat_5", "quat_6"]
                    .filter(k => coils[k] === true).length;

                expect(fansOnCount).toBe(step.expectedFans);
            }
        });
    });

    describe("Scenario: Temperature drops from hot to cool", () => {
        it("42°C → 37°C → 32°C → 27°C → 22°C", async () => {
            let coils: Record<string, boolean> = {};
            const steps = [
                { temp: 42, humi: 70, expectedFans: 6, label: "K4" },
                { temp: 37, humi: 70, expectedFans: 4, label: "K3" },
                { temp: 32, humi: 70, expectedFans: 3, label: "K2" },
                { temp: 27, humi: 70, expectedFans: 2, label: "K1" },
                { temp: 22, humi: 70, expectedFans: 0, label: "Below K1" },
            ];

            for (const step of steps) {
                const freshFlow = createMockFlowContext();
                globalContext.set("holdingRegisterData", makeHolding(step.temp, step.humi, 0));
                globalContext.set("coilRegisterData", makeCoil(coils));

                const node = createMockNode();
                const options = { node, nodeId: "temporal-test", flowContext: freshFlow, globalContext, environmentConfig: {} as any };
                const fanService = new FanControlService(options);
                const configService = new ConfigService(options);
                const sensorService = new SensorService(options);

                const config = configService.getConfig();
                const sensorData = sensorService.getSensorData()!;
                const deviceStatus = sensorService.getDeviceStatus()!;

                const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);

                // Apply actions to coils
                for (const action of fanActions) {
                    if (action.value !== undefined) coils[action.deviceKey] = !!action.value;
                }

                // Count total fans ON
                const fansOnCount = ["quat_1", "quat_2", "quat_3", "quat_4", "quat_5", "quat_6"]
                    .filter(k => coils[k] === true).length;

                expect(fansOnCount).toBe(step.expectedFans);
            }
        });
    });

    describe("Scenario: User's config (K1=18, K2=20, K3=25, K4=30)", () => {
        it("26°C(K3) → 23°C(K2) → 17°C(below K1)", async () => {
            // Set user's config
            globalContext.set("configKeyValues", {
                ...DEFAULT_CONFIG,
                set_k1_fan: 18, set_k2_fan: 20, set_k3_fan: 25, set_k4_fan: 30,
                set_gr_alternate_fan: 3,
            });

            let coils: Record<string, boolean> = {};
            const steps = [
                { temp: 26, expected: 4, label: "K3 (25-30)" },   // 26 >= K3=25 → 4 fans
                { temp: 23, expected: 3, label: "K2 (20-25)" },   // 23 >= K2=20 → 3 fans
                { temp: 17, expected: 0, label: "Below K1 (18)" }, // 17 < K1=18 → 0 fans
            ];

            for (const step of steps) {
                const freshFlow = createMockFlowContext();
                globalContext.set("holdingRegisterData", makeHolding(step.temp, 70, 0));
                globalContext.set("coilRegisterData", makeCoil(coils));

                const node = createMockNode();
                const options = { node, nodeId: "temporal-test", flowContext: freshFlow, globalContext, environmentConfig: {} as any };
                const fanService = new FanControlService(options);
                const configService = new ConfigService(options);
                const sensorService = new SensorService(options);

                const config = configService.getConfig();
                const sensorData = sensorService.getSensorData()!;
                const deviceStatus = sensorService.getDeviceStatus()!;

                const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);

                for (const action of fanActions) {
                    if (action.value !== undefined) coils[action.deviceKey] = !!action.value;
                }

                const fansOnCount = ["quat_1", "quat_2", "quat_3", "quat_4", "quat_5", "quat_6"]
                    .filter(k => coils[k] === true).length;

                expect(fansOnCount).toBe(step.expected);
            }
        });
    });

    describe("Hysteresis — Oscillation Prevention (getRecommendedGroupSize)", () => {
        const thresholds = { k1: 25, k2: 30, k3: 35, k4: 40 };
        const hysteresis = CONTROL_CONFIG.THRESHOLD_HYSTERESIS_CELSIUS;

        it("temp oscillates at K2 boundary: hysteresis prevents flip-flop at 29.5-30.0", () => {
            let currentSize = 0;
            const results: number[] = [];

            const temps = [30.1, 29.9, 30.2, 29.8, 30.0, 29.7, 30.3, 29.6];

            for (const temp of temps) {
                const size = getRecommendedGroupSize(temp, 70, thresholds, { currentGroupSize: currentSize, hysteresis });
                results.push(size);
                currentSize = size;
            }

            let transitions = 0;
            for (let i = 1; i < results.length; i++) {
                if (results[i] !== results[i - 1]) transitions++;
            }

            // Hysteresis creates 3 transitions (vs 7 without hysteresis):
            // - 30.1→3 fans, 29.9→3 (same level threshold=29.75), 30.2→3, 29.8→3, 30.0→3
            // - 29.7 < 29.75 → 2 fans (transition 1)
            // - 30.3 >= 30 → 3 fans (transition 2)
            // - 29.6 < 29.75 → 2 fans (transition 3)
            expect(transitions).toBe(3);
            expect(transitions).toBeLessThan(5); // Much less than without hysteresis
        });

        it("temp oscillates at K1 boundary: hysteresis band 24.5-25.0", () => {
            let currentSize = 0;
            const results: number[] = [];

            const temps = [25.1, 24.9, 25.2, 24.8, 25.0, 24.6, 25.3, 24.4];

            for (const temp of temps) {
                const size = getRecommendedGroupSize(temp, 70, thresholds, { currentGroupSize: currentSize, hysteresis });
                results.push(size);
                currentSize = size;
            }

            let transitions = 0;
            for (let i = 1; i < results.length; i++) {
                if (results[i] !== results[i - 1]) transitions++;
            }

            // Hysteresis reduces transitions:
            // - 25.1→2, 24.9→2 (same level=24.75), 25.2→2, 24.8→2, 25.0→2
            // - 24.6 < 24.75 → 0 (transition 1)
            // - 25.3 >= 25 → 2 (transition 2)
            // - 24.4 < 24.5 (moving down) → 0 (transition 3)
            expect(transitions).toBeLessThanOrEqual(3);
        });

        it("WITHOUT hysteresis: many transitions at boundary", () => {
            let currentSize = 0;
            const results: number[] = [];

            const temps = [30.1, 29.9, 30.2, 29.8, 30.0, 29.7, 30.3, 29.6];

            for (const temp of temps) {
                // hysteresis = 0.001 (minimal) — note: 0 is falsy, falls back to 1.0
                const size = getRecommendedGroupSize(temp, 70, thresholds, { currentGroupSize: currentSize, hysteresis: 0.001 });
                results.push(size);
                currentSize = size;
            }

            let transitions = 0;
            for (let i = 1; i < results.length; i++) {
                if (results[i] !== results[i - 1]) transitions++;
            }

            // Without meaningful hysteresis: every crossing of 30°C causes a transition
            expect(transitions).toBeGreaterThanOrEqual(4);
        });
    });

    describe("Water Pump — Temporal Behavior", () => {
        it("humidity drops below 60% → pump ON", async () => {
            const freshFlow = createMockFlowContext();
            globalContext.set("holdingRegisterData", makeHolding(28, 45, 0));
            globalContext.set("coilRegisterData", makeCoil({}));

            const node = createMockNode();
            const options = { node, nodeId: "test", flowContext: freshFlow, globalContext, environmentConfig: {} as any };
            const configService = new ConfigService(options);
            const sensorService = new SensorService(options);
            const waterPumpService = new WaterPumpControlService(options);

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const pumpActions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
            expect(pumpActions.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true)).toBe(true);
        });

        it("K4 override forces pump ON even at 95% humidity", async () => {
            const freshFlow = createMockFlowContext();
            globalContext.set("holdingRegisterData", makeHolding(42, 95, 0));
            globalContext.set("coilRegisterData", makeCoil({}));

            const node = createMockNode();
            const options = { node, nodeId: "test", flowContext: freshFlow, globalContext, environmentConfig: {} as any };
            const configService = new ConfigService(options);
            const sensorService = new SensorService(options);
            const waterPumpService = new WaterPumpControlService(options);

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;

            const k4Pump = waterPumpService.checkK4PriorityOverride(config, sensorData);
            expect(k4Pump.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true)).toBe(true);
        });
    });

    describe("Fan Dao — Temporal Sync Mode", () => {
        it("fan dao initializes and toggles ON on first cycle", async () => {
            const freshFlow = createMockFlowContext();
            globalContext.set("holdingRegisterData", makeHolding(28, 70, 0));
            globalContext.set("coilRegisterData", makeCoil({}));

            const node = createMockNode();
            const options = { node, nodeId: "test", flowContext: freshFlow, globalContext, environmentConfig: {} as any };
            const configService = new ConfigService(options);
            const sensorService = new SensorService(options);
            const fanService = new FanControlService(options);

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanDaoOn = fanActions.filter(a => a.deviceKey.startsWith("quat_dao_") && a.value === true).length;
            expect(fanDaoOn).toBe(3); // All 3 fan dao ON
        });
    });

    describe("getRecommendedGroupSize — Hysteresis Unit Tests", () => {
        const thresholds = { k1: 25, k2: 30, k3: 35, k4: 40 };
        const hysteresis = CONTROL_CONFIG.THRESHOLD_HYSTERESIS_CELSIUS;

        it("moving UP: normal thresholds (no hysteresis applied)", () => {
            // Currently 0 fans, going up
            expect(getRecommendedGroupSize(25, 70, thresholds, { currentGroupSize: 0, hysteresis })).toBe(2);
            expect(getRecommendedGroupSize(30, 70, thresholds, { currentGroupSize: 0, hysteresis })).toBe(3);
            expect(getRecommendedGroupSize(35, 70, thresholds, { currentGroupSize: 0, hysteresis })).toBe(4);
            expect(getRecommendedGroupSize(40, 70, thresholds, { currentGroupSize: 0, hysteresis })).toBe(6);
        });

        it("moving DOWN: thresholds reduced by hysteresis", () => {
            // Currently 6 fans (K4), going down
            // K3 effective: 35 - 0.5 = 34.5
            expect(getRecommendedGroupSize(34.6, 70, thresholds, { currentGroupSize: 6, hysteresis })).toBe(4);
            expect(getRecommendedGroupSize(34.4, 70, thresholds, { currentGroupSize: 6, hysteresis })).toBe(3);

            // K2 effective: 30 - 0.5 = 29.5
            expect(getRecommendedGroupSize(29.6, 70, thresholds, { currentGroupSize: 4, hysteresis })).toBe(3);
            expect(getRecommendedGroupSize(29.4, 70, thresholds, { currentGroupSize: 4, hysteresis })).toBe(2);

            // K1 effective: 25 - 0.5 = 24.5
            expect(getRecommendedGroupSize(24.6, 70, thresholds, { currentGroupSize: 3, hysteresis })).toBe(2);
            expect(getRecommendedGroupSize(24.4, 70, thresholds, { currentGroupSize: 3, hysteresis })).toBe(0);
        });

        it("same level: threshold with half hysteresis buffer", () => {
            // Currently 3 fans (K2), staying at K2
            // K2 effective: 30 - 0.25 = 29.75
            expect(getRecommendedGroupSize(29.8, 70, thresholds, { currentGroupSize: 3, hysteresis })).toBe(3);
            expect(getRecommendedGroupSize(29.7, 70, thresholds, { currentGroupSize: 3, hysteresis })).toBe(2);
        });

        it("rapid oscillation at boundary: hysteresis prevents flip-flop", () => {
            let currentSize = 0;
            const results: number[] = [];

            // Simulate rapid temp changes around K1=25°C
            const temps = [25.1, 24.9, 25.2, 24.8, 25.0, 24.6, 25.3, 24.4];

            for (const temp of temps) {
                const size = getRecommendedGroupSize(temp, 70, thresholds, { currentGroupSize: currentSize, hysteresis });
                results.push(size);
                currentSize = size;
            }

            // Count transitions
            let transitions = 0;
            for (let i = 1; i < results.length; i++) {
                if (results[i] !== results[i - 1]) transitions++;
            }

            // With hysteresis:
            // - 25.1 (currentSize=0, moving up): >= 25 → 2 fans
            // - 24.9 (currentSize=2, same level): >= 24.75 → 2 fans
            // - 25.2 (currentSize=2, same level): >= 24.75 → 2 fans
            // - 24.8 (currentSize=2, same level): >= 24.75 → 2 fans
            // - 25.0 (currentSize=2, same level): >= 24.75 → 2 fans
            // - 24.6 (currentSize=2, same level): < 24.75 → 0 fans (transition!)
            // - 25.3 (currentSize=0, moving up): >= 25 → 2 fans (transition!)
            // - 24.4 (currentSize=2, moving down): < 24.5 → 0 fans (transition!)
            // Total: 3 transitions
            expect(transitions).toBe(3); // 0→2 at 25.1, 2→0 at 24.6, 0→2 at 25.3, 2→0 at 24.4
        });
    });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const fanControlService_1 = require("../services/fanControlService");
const waterPumpControlService_1 = require("../services/waterPumpControlService");
const configService_1 = require("../services/configService");
const sensorService_1 = require("../services/sensorService");
const constants_1 = require("../constants");
const groupUtils_1 = require("../utils/groupUtils");
// ─── Helpers ───────────────────────────────────────────────────────────────
function createMockGlobalContext(data = {}) {
    const store = Object.assign({}, data);
    return {
        get: (key) => store[key],
        set: (key, value) => { store[key] = value; },
        _store: store,
    };
}
function createMockFlowContext() {
    const store = {};
    return {
        get: (key) => store[key],
        set: (key, value) => { store[key] = value; },
        _store: store,
    };
}
function createMockNode() {
    return { status: globals_1.jest.fn(), warn: globals_1.jest.fn(), log: globals_1.jest.fn(), error: globals_1.jest.fn() };
}
const DEFAULT_CONFIG = {
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
function makeHolding(temp, humi, lightOut = 0) {
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
function makeCoil(overrides = {}) {
    return Object.assign({ ts: Date.now(), quat_1: false, quat_2: false, quat_3: false, quat_4: false, quat_5: false, quat_6: false, quat_dao_1: false, quat_dao_2: false, quat_dao_3: false, bom_nuoc_1: false, luoi_1_thu: false, luoi_1_dai: false, luoi_2_thu: false, luoi_2_dai: false }, overrides);
}
async function simulateCycle(flowContext, globalContext, config, temp, humi, lightOut = 0, currentCoils = {}) {
    // Update sensor data
    globalContext.set("holdingRegisterData", makeHolding(temp, humi, lightOut));
    globalContext.set("coilRegisterData", makeCoil(currentCoils));
    const node = createMockNode();
    const options = {
        node, nodeId: "temporal-test", flowContext, globalContext,
        environmentConfig: {},
    };
    const configService = new configService_1.ConfigService(options);
    const sensorService = new sensorService_1.SensorService(options);
    const fanService = new fanControlService_1.FanControlService(options);
    const waterPumpService = new waterPumpControlService_1.WaterPumpControlService(options);
    const sensorData = sensorService.getSensorData();
    const deviceStatus = sensorService.getDeviceStatus();
    const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
    const fansOn = fanActions
        .filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"))
        .map(a => a.deviceKey)
        .sort();
    const fanDaoOn = fanActions
        .filter(a => a.deviceKey.startsWith("quat_dao_") && a.value === true)
        .length > 0;
    // K4 override check
    const k4Pump = waterPumpService.checkK4PriorityOverride(config, sensorData);
    let pumpOn = k4Pump.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true);
    if (!pumpOn) {
        const pumpActions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
        pumpOn = pumpActions.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true);
    }
    return { temp, fansOn, fanCount: fansOn.length, pumpOn, fanDaoOn };
}
/**
 * Simulate a cycle with proper coil state tracking.
 * Returns the result AND the updated coil state for the next cycle.
 */
async function simulateCycleWithState(flowContext, globalContext, config, temp, humi, lightOut, prevCoils) {
    globalContext.set("holdingRegisterData", makeHolding(temp, humi, lightOut));
    globalContext.set("coilRegisterData", makeCoil(prevCoils));
    const node = createMockNode();
    const options = {
        node, nodeId: "temporal-test", flowContext, globalContext,
        environmentConfig: {},
    };
    const configService = new configService_1.ConfigService(options);
    const sensorService = new sensorService_1.SensorService(options);
    const fanService = new fanControlService_1.FanControlService(options);
    const waterPumpService = new waterPumpControlService_1.WaterPumpControlService(options);
    const configObj = configService.getConfig();
    const sensorData = sensorService.getSensorData();
    const deviceStatus = sensorService.getDeviceStatus();
    const fanActions = await fanService.processFanControl(configObj, sensorData, deviceStatus);
    // Build new coil state from actions
    const newCoils = Object.assign({}, prevCoils);
    for (const action of fanActions) {
        if (action.value !== undefined) {
            newCoils[action.deviceKey] = !!action.value;
        }
    }
    const fansOn = fanActions
        .filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"))
        .map(a => a.deviceKey)
        .sort();
    const fanDaoOn = fanActions
        .filter(a => a.deviceKey.startsWith("quat_dao_") && a.value === true)
        .length > 0;
    const k4Pump = waterPumpService.checkK4PriorityOverride(configObj, sensorData);
    let pumpOn = k4Pump.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true);
    if (!pumpOn) {
        const pumpActions = await waterPumpService.processWaterPumpControl(configObj, sensorData, deviceStatus);
        pumpOn = pumpActions.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true);
        for (const action of pumpActions) {
            if (action.value !== undefined) {
                newCoils[action.deviceKey] = !!action.value;
            }
        }
    }
    return {
        result: { temp, fansOn, fanCount: fansOn.length, pumpOn, fanDaoOn },
        newCoils
    };
}
// ─── Temporal Tests ────────────────────────────────────────────────────────
(0, globals_1.describe)("Temporal Transition Tests — Temperature Changes Over Time", () => {
    let flowContext;
    let globalContext;
    (0, globals_1.beforeEach)(() => {
        flowContext = createMockFlowContext();
        globalContext = createMockGlobalContext({
            configKeyValues: DEFAULT_CONFIG,
            holdingRegisterData: makeHolding(25, 70),
            coilRegisterData: makeCoil(),
        });
    });
    (0, globals_1.describe)("Scenario: Temperature rises from cool to hot (K1=25, K2=30, K3=35, K4=40)", () => {
        (0, globals_1.it)("22°C → 27°C → 32°C → 37°C → 42°C", async () => {
            let coils = {};
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
                const options = { node, nodeId: "temporal-test", flowContext: freshFlow, globalContext, environmentConfig: {} };
                const fanService = new fanControlService_1.FanControlService(options);
                const configService = new configService_1.ConfigService(options);
                const sensorService = new sensorService_1.SensorService(options);
                const config = configService.getConfig();
                const sensorData = sensorService.getSensorData();
                const deviceStatus = sensorService.getDeviceStatus();
                const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
                const fansOn = fanActions
                    .filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"))
                    .map(a => a.deviceKey)
                    .sort();
                if (fansOn.length !== step.expectedFans) {
                    console.log(`[DEBUG] ${step.label}: temp=${step.temp}, expected=${step.expectedFans}, got=${fansOn.length}, fans=[${fansOn}]`);
                    console.log(`[DEBUG] config: k1=${config.set_k1_fan}, k2=${config.set_k2_fan}, k3=${config.set_k3_fan}, k4=${config.set_k4_fan}`);
                    console.log(`[DEBUG] useTransitions=${config.set_fan_group_transition_delay}ms, offDelay=${config.set_fan_group_off_delay}ms`);
                    console.log(`[DEBUG] total actions: ${fanActions.length}`);
                    console.log(`[DEBUG] all actions:`, fanActions.map(a => `${a.deviceKey}=${a.value}`));
                }
                for (const action of fanActions) {
                    if (action.value !== undefined)
                        coils[action.deviceKey] = !!action.value;
                }
                (0, globals_1.expect)(fansOn.length).toBe(step.expectedFans);
            }
        });
    });
    (0, globals_1.describe)("Scenario: Temperature drops from hot to cool", () => {
        (0, globals_1.it)("42°C → 37°C → 32°C → 27°C → 22°C", async () => {
            let coils = {};
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
                const options = { node, nodeId: "temporal-test", flowContext: freshFlow, globalContext, environmentConfig: {} };
                const fanService = new fanControlService_1.FanControlService(options);
                const configService = new configService_1.ConfigService(options);
                const sensorService = new sensorService_1.SensorService(options);
                const config = configService.getConfig();
                const sensorData = sensorService.getSensorData();
                const deviceStatus = sensorService.getDeviceStatus();
                const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
                const fansOn = fanActions
                    .filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
                if (fansOn.length !== step.expectedFans) {
                    console.log(`[DROP DEBUG] temp=${step.temp}, expected=${step.expectedFans}, got=${fansOn.length}`);
                    console.log(`[DROP DEBUG] config: k1=${config.set_k1_fan}, k2=${config.set_k2_fan}, k3=${config.set_k3_fan}, k4=${config.set_k4_fan}`);
                    console.log(`[DROP DEBUG] useTransitions=${config.set_fan_group_transition_delay}ms`);
                }
                for (const action of fanActions) {
                    if (action.value !== undefined)
                        coils[action.deviceKey] = !!action.value;
                }
                (0, globals_1.expect)(fansOn.length).toBe(step.expectedFans);
            }
        });
    });
    (0, globals_1.describe)("Scenario: User's config (K1=18, K2=20, K3=25, K4=30)", () => {
        (0, globals_1.it)("26°C(K3) → 23°C(K2) → 17°C(below K1)", async () => {
            // Set user's config
            globalContext.set("configKeyValues", Object.assign(Object.assign({}, DEFAULT_CONFIG), { set_k1_fan: 18, set_k2_fan: 20, set_k3_fan: 25, set_k4_fan: 30, set_gr_alternate_fan: 3 }));
            let coils = {};
            const steps = [
                { temp: 26, expected: 4, label: "K3 (25-30)" }, // 26 >= K3=25 → 4 fans
                { temp: 23, expected: 3, label: "K2 (20-25)" }, // 23 >= K2=20 → 3 fans
                { temp: 17, expected: 0, label: "Below K1 (18)" }, // 17 < K1=18 → 0 fans
            ];
            for (const step of steps) {
                const freshFlow = createMockFlowContext();
                globalContext.set("holdingRegisterData", makeHolding(step.temp, 70, 0));
                globalContext.set("coilRegisterData", makeCoil(coils));
                const node = createMockNode();
                const options = { node, nodeId: "temporal-test", flowContext: freshFlow, globalContext, environmentConfig: {} };
                const fanService = new fanControlService_1.FanControlService(options);
                const configService = new configService_1.ConfigService(options);
                const sensorService = new sensorService_1.SensorService(options);
                const config = configService.getConfig();
                const sensorData = sensorService.getSensorData();
                const deviceStatus = sensorService.getDeviceStatus();
                const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
                const fansOn = fanActions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
                for (const action of fanActions) {
                    if (action.value !== undefined)
                        coils[action.deviceKey] = !!action.value;
                }
                (0, globals_1.expect)(fansOn.length).toBe(step.expected);
            }
        });
    });
    (0, globals_1.describe)("Hysteresis — Oscillation Prevention (getRecommendedGroupSize)", () => {
        const thresholds = { k1: 25, k2: 30, k3: 35, k4: 40 };
        const hysteresis = constants_1.CONTROL_CONFIG.THRESHOLD_HYSTERESIS_CELSIUS;
        (0, globals_1.it)("temp oscillates at K2 boundary: hysteresis prevents flip-flop at 29.5-30.0", () => {
            let currentSize = 0;
            const results = [];
            // Temp oscillates around K2=30°C
            // Going up: 3 fans when temp >= 30
            // Going down from 3: 3 fans when temp >= 29.5 (30 - 0.5)
            const temps = [30.1, 29.9, 30.2, 29.8, 30.0, 29.7, 30.3, 29.6];
            for (const temp of temps) {
                const size = (0, groupUtils_1.getRecommendedGroupSize)(temp, 70, thresholds, { currentGroupSize: currentSize, hysteresis });
                results.push(size);
                currentSize = size;
            }
            // Count transitions
            let transitions = 0;
            for (let i = 1; i < results.length; i++) {
                if (results[i] !== results[i - 1])
                    transitions++;
            }
            // Hysteresis band: 29.5-30.0
            // At 29.6, 29.7, 29.8, 29.9: if currently at 3 fans → stays at 3 (effective threshold = 29.5)
            // At 30.0, 30.1, 30.2, 30.3: definitely at 3 fans
            // Only at 29.4 or below would it drop to 2
            (0, globals_1.expect)(transitions).toBe(1); // Only 1 transition: 0→3 at first temp >= 30
        });
        (0, globals_1.it)("temp oscillates at K1 boundary: hysteresis band 24.5-25.0", () => {
            let currentSize = 0;
            const results = [];
            const temps = [25.1, 24.9, 25.2, 24.8, 25.0, 24.6, 25.3, 24.4];
            for (const temp of temps) {
                const size = (0, groupUtils_1.getRecommendedGroupSize)(temp, 70, thresholds, { currentGroupSize: currentSize, hysteresis });
                results.push(size);
                currentSize = size;
            }
            let transitions = 0;
            for (let i = 1; i < results.length; i++) {
                if (results[i] !== results[i - 1])
                    transitions++;
            }
            // 24.4 < 24.5 (effective K1 when moving down from 2) → 0 fans
            // All others >= 24.5 → 2 fans
            // Transitions: 0→2 at 25.1, 2→0 at 24.4 = 2 transitions
            (0, globals_1.expect)(transitions).toBeLessThanOrEqual(2);
        });
        (0, globals_1.it)("WITHOUT hysteresis: many transitions at boundary", () => {
            let currentSize = 0;
            const results = [];
            const temps = [30.1, 29.9, 30.2, 29.8, 30.0, 29.7, 30.3, 29.6];
            for (const temp of temps) {
                // hysteresis = 0.001 (minimal) — note: 0 is falsy, falls back to 1.0
                const size = (0, groupUtils_1.getRecommendedGroupSize)(temp, 70, thresholds, { currentGroupSize: currentSize, hysteresis: 0.001 });
                results.push(size);
                currentSize = size;
            }
            let transitions = 0;
            for (let i = 1; i < results.length; i++) {
                if (results[i] !== results[i - 1])
                    transitions++;
            }
            // Without meaningful hysteresis: every crossing of 30°C causes a transition
            (0, globals_1.expect)(transitions).toBeGreaterThanOrEqual(4);
        });
    });
    (0, globals_1.describe)("Water Pump — Temporal Behavior", () => {
        (0, globals_1.it)("humidity drops below 60% → pump ON", async () => {
            // Step 1: Normal humidity
            const r1 = await simulateCycleWithState(flowContext, globalContext, DEFAULT_CONFIG, 28, 70, 0, {});
            (0, globals_1.expect)(r1.result.pumpOn).toBe(false);
            // Step 2: Low humidity → pump ON
            const r2 = await simulateCycleWithState(flowContext, globalContext, DEFAULT_CONFIG, 28, 45, 0, {});
            (0, globals_1.expect)(r2.result.pumpOn).toBe(true);
        });
        (0, globals_1.it)("K4 override forces pump ON even at 95% humidity", async () => {
            const r = await simulateCycleWithState(flowContext, globalContext, DEFAULT_CONFIG, 42, 95, 0, {});
            (0, globals_1.expect)(r.result.pumpOn).toBe(true);
        });
    });
    (0, globals_1.describe)("Fan Dao — Temporal Sync Mode", () => {
        (0, globals_1.it)("fan dao initializes and toggles ON on first cycle", async () => {
            let coils = {};
            const r1 = await simulateCycleWithState(flowContext, globalContext, DEFAULT_CONFIG, 28, 70, 0, coils);
            // First run: lastToggleTime=0 → elapsed huge → toggle ON
            (0, globals_1.expect)(r1.result.fanDaoOn).toBe(true);
        });
    });
    (0, globals_1.describe)("getRecommendedGroupSize — Hysteresis Unit Tests", () => {
        const thresholds = { k1: 25, k2: 30, k3: 35, k4: 40 };
        const hysteresis = constants_1.CONTROL_CONFIG.THRESHOLD_HYSTERESIS_CELSIUS;
        (0, globals_1.it)("moving UP: normal thresholds (no hysteresis applied)", () => {
            // Currently 0 fans, going up
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(25, 70, thresholds, { currentGroupSize: 0, hysteresis })).toBe(2);
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(30, 70, thresholds, { currentGroupSize: 0, hysteresis })).toBe(3);
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(35, 70, thresholds, { currentGroupSize: 0, hysteresis })).toBe(4);
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(40, 70, thresholds, { currentGroupSize: 0, hysteresis })).toBe(6);
        });
        (0, globals_1.it)("moving DOWN: thresholds reduced by hysteresis", () => {
            // Currently 6 fans (K4), going down
            // K3 effective: 35 - 0.5 = 34.5
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(34.6, 70, thresholds, { currentGroupSize: 6, hysteresis })).toBe(4);
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(34.4, 70, thresholds, { currentGroupSize: 6, hysteresis })).toBe(3);
            // K2 effective: 30 - 0.5 = 29.5
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(29.6, 70, thresholds, { currentGroupSize: 4, hysteresis })).toBe(3);
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(29.4, 70, thresholds, { currentGroupSize: 4, hysteresis })).toBe(2);
            // K1 effective: 25 - 0.5 = 24.5
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(24.6, 70, thresholds, { currentGroupSize: 3, hysteresis })).toBe(2);
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(24.4, 70, thresholds, { currentGroupSize: 3, hysteresis })).toBe(0);
        });
        (0, globals_1.it)("same level: threshold with half hysteresis buffer", () => {
            // Currently 3 fans (K2), staying at K2
            // K2 effective: 30 - 0.25 = 29.75
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(29.8, 70, thresholds, { currentGroupSize: 3, hysteresis })).toBe(3);
            (0, globals_1.expect)((0, groupUtils_1.getRecommendedGroupSize)(29.7, 70, thresholds, { currentGroupSize: 3, hysteresis })).toBe(2);
        });
        (0, globals_1.it)("rapid oscillation at boundary: hysteresis prevents flip-flop", () => {
            let currentSize = 0;
            const results = [];
            // Simulate rapid temp changes around K1=25°C
            const temps = [25.1, 24.9, 25.2, 24.8, 25.0, 24.6, 25.3, 24.4];
            for (const temp of temps) {
                const size = (0, groupUtils_1.getRecommendedGroupSize)(temp, 70, thresholds, { currentGroupSize: currentSize, hysteresis });
                results.push(size);
                currentSize = size;
            }
            // Count transitions
            let transitions = 0;
            for (let i = 1; i < results.length; i++) {
                if (results[i] !== results[i - 1])
                    transitions++;
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
            (0, globals_1.expect)(transitions).toBe(3); // 0→2 at 25.1, 2→0 at 24.6, 0→2 at 25.3, 2→0 at 24.4
        });
    });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const configService_1 = require("../services/configService");
const sensorService_1 = require("../services/sensorService");
const fanControlService_1 = require("../services/fanControlService");
const waterPumpControlService_1 = require("../services/waterPumpControlService");
const curtainControlService_1 = require("../services/curtainControlService");
const constants_1 = require("../constants");
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
function makeServiceOptions(node, flowContext, globalContext) {
    return {
        node,
        nodeId: "integration-test",
        flowContext,
        globalContext,
        environmentConfig: {},
    };
}
// ─── Default test data ─────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    set_mode_fan: 1,
    set_auto_mode_fan: 0, // 0 = threshold mode (theo nhiệt độ)
    set_k1_fan: 25,
    set_k2_fan: 30,
    set_k3_fan: 35,
    set_k4_fan: 40,
    set_gr_alternate_fan: 2,
    set_time_alternate_fan: 15,
    set_mode_fan_dao: 1,
    set_auto_mode_fan_dao: 1, // 1 = synchronization
    set_time_fan_dao_on: 5,
    set_time_fan_dao_off: 30,
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
};
function makeHoldingRegister(overrides = {}) {
    return Object.assign({ ts: Date.now(), temp_indoor: 28, humi_indoor: 70, temp_outdoor: 30, humi_outdoor: 65, light_indoor: 20000, light_outdoor: 40000 }, overrides);
}
function makeCoilRegister(overrides = {}) {
    return Object.assign({ ts: Date.now(), quat_1: false, quat_2: false, quat_3: false, quat_4: false, quat_5: false, quat_6: false, quat_dao_1: false, quat_dao_2: false, quat_dao_3: false, bom_nuoc_1: false, luoi_1_thu: false, luoi_1_dai: false, luoi_2_thu: false, luoi_2_dai: false }, overrides);
}
// ─── Integration Tests ─────────────────────────────────────────────────────
(0, globals_1.describe)("Microclimate Integration Tests", () => {
    let node;
    let flowContext;
    let globalContext;
    let configService;
    let sensorService;
    let fanService;
    let waterPumpService;
    let curtainService;
    function setupServices(configOverrides = {}, holdingOverrides = {}, coilOverrides = {}) {
        node = createMockNode();
        flowContext = createMockFlowContext();
        globalContext = createMockGlobalContext({
            configKeyValues: Object.assign(Object.assign({}, DEFAULT_CONFIG), configOverrides),
            holdingRegisterData: makeHoldingRegister(holdingOverrides),
            coilRegisterData: makeCoilRegister(coilOverrides),
        });
        const options = makeServiceOptions(node, flowContext, globalContext);
        configService = new configService_1.ConfigService(options);
        sensorService = new sensorService_1.SensorService(options);
        fanService = new fanControlService_1.FanControlService(options);
        waterPumpService = new waterPumpControlService_1.WaterPumpControlService(options);
        curtainService = new curtainControlService_1.CurtainControlService(options);
    }
    // ─── Threshold Mode Tests ──────────────────────────────────────────
    (0, globals_1.describe)("Threshold Mode — Fan Count per Temperature", () => {
        (0, globals_1.it)("K1: 2 fans when temp >= K1 (25°C) and < K2 (30°C)", async () => {
            setupServices({}, { temp_indoor: 27 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            (0, globals_1.expect)(configService.isConfigValid()).toBe(true);
            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fanOnActions).toHaveLength(2);
            // Should be a symmetric pair
            const fanKeys = fanOnActions.map(a => a.deviceKey).sort();
            const validPairs = [["quat_1", "quat_4"], ["quat_2", "quat_5"], ["quat_3", "quat_6"]];
            const isValidPair = validPairs.some(pair => pair[0] === fanKeys[0] && pair[1] === fanKeys[1]);
            (0, globals_1.expect)(isValidPair).toBe(true);
        });
        (0, globals_1.it)("K2: 3 fans when temp >= K2 (30°C) and < K3 (35°C)", async () => {
            setupServices({}, { temp_indoor: 32 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fanOnActions).toHaveLength(3);
            // Should be an interleaved triple
            const fanKeys = fanOnActions.map(a => a.deviceKey).sort();
            const validTriples = [["quat_1", "quat_3", "quat_5"], ["quat_2", "quat_4", "quat_6"]];
            const isValidTriple = validTriples.some(t => t[0] === fanKeys[0] && t[1] === fanKeys[1] && t[2] === fanKeys[2]);
            (0, globals_1.expect)(isValidTriple).toBe(true);
        });
        (0, globals_1.it)("K3: 4 fans when temp >= K3 (35°C) and < K4 (40°C)", async () => {
            setupServices({}, { temp_indoor: 37 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fanOnActions).toHaveLength(4);
        });
        (0, globals_1.it)("K4: 6 fans when temp >= K4 (40°C)", async () => {
            setupServices({}, { temp_indoor: 42 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fanOnActions).toHaveLength(6);
        });
        (0, globals_1.it)("0 fans when temp < K1 (25°C)", async () => {
            setupServices({}, { temp_indoor: 20 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fanOnActions).toHaveLength(0);
        });
    });
    // ─── Water Pump Tests ──────────────────────────────────────────────
    (0, globals_1.describe)("Water Pump — Normal + K4 Override", () => {
        (0, globals_1.it)("turns ON when humidity < low threshold (60%)", async () => {
            setupServices({}, { humi_indoor: 45 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            const actions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
            const pumpOn = actions.find(a => a.deviceKey === "bom_nuoc_1" && a.value === true);
            (0, globals_1.expect)(pumpOn).toBeDefined();
        });
        (0, globals_1.it)("turns OFF when humidity > high threshold (85%)", async () => {
            setupServices({}, { humi_indoor: 90 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            // Current device status: pump is ON
            const deviceStatus = Object.assign(Object.assign({}, sensorService.getDeviceStatus()), { bom_nuoc_1: true });
            // Set flow context state to ON
            flowContext.set(constants_1.CONTEXT_KEYS.WATER_PUMP_STATE, {
                isOn: true, lastChangeTime: Date.now(), lastHumidity: 45, changeCount: 1, isK4Override: false
            });
            const actions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
            const pumpOff = actions.find(a => a.deviceKey === "bom_nuoc_1" && a.value === false);
            (0, globals_1.expect)(pumpOff).toBeDefined();
        });
        (0, globals_1.it)("K4 override turns ON regardless of humidity", async () => {
            setupServices({}, { temp_indoor: 42, humi_indoor: 95 }); // High humidity!
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const k4Actions = waterPumpService.checkK4PriorityOverride(config, sensorData);
            const pumpOn = k4Actions.find(a => a.deviceKey === "bom_nuoc_1" && a.value === true);
            (0, globals_1.expect)(pumpOn).toBeDefined();
        });
        (0, globals_1.it)("K4 override does NOT activate in rotation mode", async () => {
            setupServices({ set_auto_mode_fan: 1 }, { temp_indoor: 42 }); // 1 = rotation
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const k4Actions = waterPumpService.checkK4PriorityOverride(config, sensorData);
            (0, globals_1.expect)(k4Actions).toEqual([]);
        });
    });
    // ─── Curtain Tests ─────────────────────────────────────────────────
    (0, globals_1.describe)("Curtain Control — Light-based", () => {
        (0, globals_1.it)("starts tolerance timer when light > dai threshold", async () => {
            setupServices({}, { light_outdoor: 60000, light_indoor: 25000 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            const timers = flowContext.get(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            (0, globals_1.expect)(Array.isArray(timers)).toBe(true);
            (0, globals_1.expect)(timers.length).toBeGreaterThan(0);
            (0, globals_1.expect)(timers[0].targetAction).toBe("dai");
        });
        (0, globals_1.it)("starts tolerance timer for thu when light < thu threshold", async () => {
            setupServices({}, { light_outdoor: 20000, light_indoor: 10000 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            const timers = flowContext.get(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            (0, globals_1.expect)(timers.length).toBeGreaterThan(0);
            (0, globals_1.expect)(timers[0].targetAction).toBe("thu");
        });
        (0, globals_1.it)("no action when light is between thu and dai thresholds", async () => {
            setupServices({}, { light_outdoor: 40000, light_indoor: 20000 }); // 30000 < 40000 < 50000
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            const actions = await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            (0, globals_1.expect)(actions).toEqual([]);
        });
        (0, globals_1.it)("executes dai action after tolerance timer elapses", async () => {
            setupServices({}, { light_outdoor: 60000, light_indoor: 25000 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            // Pre-set an elapsed tolerance timer
            const now = Date.now();
            flowContext.set(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_1", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_2", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
            ]);
            const actions = await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            // Should have dai actions for both luoi_1 and luoi_2
            const luoi1Dai = actions.find(a => a.deviceKey === "luoi_1_dai" && a.value === true);
            const luoi2Dai = actions.find(a => a.deviceKey === "luoi_2_dai" && a.value === true);
            (0, globals_1.expect)(luoi1Dai).toBeDefined();
            (0, globals_1.expect)(luoi2Dai).toBeDefined();
        });
    });
    // ─── Full Cycle Simulation ─────────────────────────────────────────
    (0, globals_1.describe)("Full Control Cycle Simulation", () => {
        (0, globals_1.it)("hot day: K4 fans + water pump + curtain retract", async () => {
            setupServices({}, { temp_indoor: 42, humi_indoor: 55, light_outdoor: 10000, light_indoor: 5000 }, {} // all devices off
            );
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            // 1. Fan control
            const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = fanActions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fansOn).toHaveLength(6); // K4 → all 6 fans
            // 2. K4 water pump override
            const k4Pump = waterPumpService.checkK4PriorityOverride(config, sensorData);
            (0, globals_1.expect)(k4Pump.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true)).toBe(true);
            // 3. Curtain — light_outdoor=10000 < thu_threshold=30000 → start thu timer
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            const timers = flowContext.get(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            (0, globals_1.expect)(timers.some((t) => t.targetAction === "thu")).toBe(true);
        });
        (0, globals_1.it)("cool day: no fans + water pump normal + curtain retract", async () => {
            setupServices({}, { temp_indoor: 22, humi_indoor: 50, light_outdoor: 20000, light_indoor: 10000 }, {} // all devices off
            );
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            // 1. Fans: temp=22 < K1=25 → no fans
            const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = fanActions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fansOn).toHaveLength(0);
            // 2. Water pump: humi=50 < low=60 → ON (normal, not K4)
            const pumpActions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
            (0, globals_1.expect)(pumpActions.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true)).toBe(true);
            // 3. K4 override should NOT activate
            const k4Pump = waterPumpService.checkK4PriorityOverride(config, sensorData);
            (0, globals_1.expect)(k4Pump).toEqual([]);
        });
        (0, globals_1.it)("sunny day: K2 fans + curtain extend", async () => {
            setupServices({}, { temp_indoor: 32, humi_indoor: 70, light_outdoor: 80000, light_indoor: 40000 }, {} // all devices off
            );
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            // 1. Fans: temp=32 >= K2=30 → 3 fans
            const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = fanActions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fansOn).toHaveLength(3);
            // 2. Water pump: humi=70 between low(60) and high(85) → no change
            const pumpActions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
            (0, globals_1.expect)(pumpActions).toEqual([]);
            // 3. Curtain: light_outdoor=80000 > dai_threshold=50000 → start dai timer
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            const timers = flowContext.get(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            (0, globals_1.expect)(timers.some((t) => t.targetAction === "dai")).toBe(true);
        });
        (0, globals_1.it)("user config: K4 fans + fan dao sync + water pump + curtain", async () => {
            // Use the user's actual config
            setupServices({
                set_k1_fan: 18,
                set_k2_fan: 20,
                set_k3_fan: 25,
                set_k4_fan: 30,
                set_gr_alternate_fan: 3,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 5,
                set_light_dai_luoi_1: 8000,
                set_light_thu_luoi_1: 45000,
                set_tolerance_light_luoi_1: 3,
                set_light_dai_luoi_2: 90000,
                set_light_thu_luoi_2: 45000,
                set_tolerance_light_luoi_2: 5,
            }, { temp_indoor: 35, humi_indoor: 26, light_outdoor: 0, light_indoor: 6225920 }, {} // all devices off
            );
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            (0, globals_1.expect)(configService.isConfigValid()).toBe(true);
            // 1. Fan control: temp=35 >= K4=30 → 6 fans
            const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = fanActions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fansOn).toHaveLength(6);
            // 2. Fan dao: sync mode, first run → toggle ON (lastToggleTime=0)
            const fanDaoActions = fanActions.filter(a => a.deviceKey.startsWith("quat_dao_"));
            (0, globals_1.expect)(fanDaoActions.length).toBeGreaterThan(0);
            (0, globals_1.expect)(fanDaoActions.every(a => a.value === true)).toBe(true); // All ON
            // 3. K4 water pump override
            const k4Pump = waterPumpService.checkK4PriorityOverride(config, sensorData);
            (0, globals_1.expect)(k4Pump.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true)).toBe(true);
            // 4. Curtain: light_outdoor=0 < thu(45000) → start thu timer
            // Note: luoi_3/4 also get timers because they use defaults (50000/30000)
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            const timers = flowContext.get(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            (0, globals_1.expect)(timers.length).toBeGreaterThanOrEqual(2); // at least luoi_1 + luoi_2
            (0, globals_1.expect)(timers.every((t) => t.targetAction === "thu")).toBe(true);
            // Verify luoi_1 and luoi_2 are present
            (0, globals_1.expect)(timers.some((t) => t.luoiId === "luoi_1")).toBe(true);
            (0, globals_1.expect)(timers.some((t) => t.luoiId === "luoi_2")).toBe(true);
        });
    });
    // ─── Config Validation ─────────────────────────────────────────────
    (0, globals_1.describe)("Config Validation", () => {
        (0, globals_1.it)("accepts set_auto_mode_fan = 0 (threshold)", () => {
            setupServices({ set_auto_mode_fan: 0 });
            (0, globals_1.expect)(configService.isConfigValid()).toBe(true);
        });
        (0, globals_1.it)("accepts set_auto_mode_fan = 1 (rotation)", () => {
            setupServices({ set_auto_mode_fan: 1 });
            (0, globals_1.expect)(configService.isConfigValid()).toBe(true);
        });
        (0, globals_1.it)("rejects set_auto_mode_fan = 2 (not in enum)", () => {
            setupServices({ set_auto_mode_fan: 2 });
            (0, globals_1.expect)(configService.isConfigValid()).toBe(false);
        });
        (0, globals_1.it)("accepts set_gr_alternate_fan = 3", () => {
            setupServices({ set_gr_alternate_fan: 3 });
            (0, globals_1.expect)(configService.isConfigValid()).toBe(true);
        });
        (0, globals_1.it)("rejects set_gr_alternate_fan = 5 (not in [1,2,3,4,6])", () => {
            setupServices({ set_gr_alternate_fan: 5 });
            (0, globals_1.expect)(configService.isConfigValid()).toBe(false);
        });
        (0, globals_1.it)("accepts user's full config", () => {
            setupServices({
                set_mode_fan: 1,
                set_auto_mode_fan: 0,
                set_k1_fan: 18,
                set_k2_fan: 20,
                set_k3_fan: 25,
                set_k4_fan: 30,
                set_gr_alternate_fan: 3,
                set_time_alternate_fan: 5,
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 1,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 5,
                set_mode_tuong_nuoc: 1,
                set_threshold_low_water_bump: 60,
                set_threshold_high_water_bump: 85,
                set_mode_luoi: 1,
                set_light_dai_luoi_1: 8000,
                set_light_thu_luoi_1: 45000,
                set_tolerance_light_luoi_1: 3,
                set_light_dai_luoi_2: 90000,
                set_light_thu_luoi_2: 45000,
                set_tolerance_light_luoi_2: 5,
            });
            (0, globals_1.expect)(configService.isConfigValid()).toBe(true);
        });
    });
    // ─── Sensor Service Integration ────────────────────────────────────
    (0, globals_1.describe)("Sensor Service — Data Parsing", () => {
        (0, globals_1.it)("parses holdingRegisterData correctly", () => {
            setupServices({}, {
                temp_indoor: 28.5,
                humi_indoor: 72.3,
                light_outdoor: 45000,
                light_indoor: 18000,
            });
            const sensorData = sensorService.getSensorData();
            (0, globals_1.expect)(sensorData).not.toBeNull();
            (0, globals_1.expect)(sensorData.temp_indoor).toBe(28.5);
            (0, globals_1.expect)(sensorData.humi_indoor).toBe(72.3);
            (0, globals_1.expect)(sensorData.light_outdoor).toBe(45000);
            (0, globals_1.expect)(sensorData.light_indoor).toBe(18000);
        });
        (0, globals_1.it)("parses coilRegisterData correctly", () => {
            setupServices({}, {}, {
                quat_1: true,
                quat_4: true,
                bom_nuoc_1: true,
                luoi_1_dai: true,
            });
            const deviceStatus = sensorService.getDeviceStatus();
            (0, globals_1.expect)(deviceStatus).not.toBeNull();
            (0, globals_1.expect)(deviceStatus.quat_1).toBe(true);
            (0, globals_1.expect)(deviceStatus.quat_4).toBe(true);
            (0, globals_1.expect)(deviceStatus.quat_2).toBe(false);
            (0, globals_1.expect)(deviceStatus.bom_nuoc_1).toBe(true);
            (0, globals_1.expect)(deviceStatus.luoi_1_dai).toBe(true);
            (0, globals_1.expect)(deviceStatus.luoi_1_thu).toBe(false);
        });
        (0, globals_1.it)("returns null when holdingRegisterData is missing", () => {
            globalContext = createMockGlobalContext({
                configKeyValues: DEFAULT_CONFIG,
                // No holdingRegisterData
                coilRegisterData: makeCoilRegister(),
            });
            const options = makeServiceOptions(createMockNode(), createMockFlowContext(), globalContext);
            const svc = new sensorService_1.SensorService(options);
            (0, globals_1.expect)(svc.getSensorData()).toBeNull();
        });
    });
    // ─── Rotation Mode Tests ────────────────────────────────────────────
    (0, globals_1.describe)("Rotation Mode (set_auto_mode_fan=1)", () => {
        (0, globals_1.it)("rotates fan groups by time interval", async () => {
            setupServices({ set_auto_mode_fan: 1, set_gr_alternate_fan: 2, set_time_alternate_fan: 15, set_fan_group_transition_delay: 0, set_fan_group_off_delay: 0 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            // First cycle: should activate first group
            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fansOn).toHaveLength(2);
        });
        (0, globals_1.it)("respects set_gr_alternate_fan group size", async () => {
            setupServices({ set_auto_mode_fan: 1, set_gr_alternate_fan: 3, set_time_alternate_fan: 15, set_fan_group_transition_delay: 0, set_fan_group_off_delay: 0 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            (0, globals_1.expect)(fansOn).toHaveLength(3);
        });
        (0, globals_1.it)("K4 override does NOT activate in rotation mode", async () => {
            setupServices({ set_auto_mode_fan: 1 }, { temp_indoor: 42 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const k4Actions = waterPumpService.checkK4PriorityOverride(config, sensorData);
            (0, globals_1.expect)(k4Actions).toEqual([]);
        });
    });
    // ─── Curtain Timer Elapse Tests ─────────────────────────────────────
    (0, globals_1.describe)("Curtain — Timer Elapse Scenarios", () => {
        (0, globals_1.it)("luoi_1 dai: timer elapsed + light still high → execute", async () => {
            setupServices({}, { light_outdoor: 60000, light_indoor: 25000 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            // Pre-set elapsed timer
            const now = Date.now();
            flowContext.set(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_1", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
            ]);
            const actions = await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "luoi_1_dai" && a.value === true)).toBeDefined();
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "luoi_1_thu" && a.value === false)).toBeDefined();
        });
        (0, globals_1.it)("luoi_2 thu: timer elapsed + light still low → execute", async () => {
            setupServices({}, { light_outdoor: 20000, light_indoor: 10000 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            const now = Date.now();
            flowContext.set(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_2", startTime: now - 10 * 60 * 1000, targetAction: "thu", lightValue: 20000 },
            ]);
            const actions = await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "luoi_2_thu" && a.value === true)).toBeDefined();
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "luoi_2_dai" && a.value === false)).toBeDefined();
        });
        (0, globals_1.it)("timer restarts when condition changes during wait", async () => {
            setupServices({}, { light_outdoor: 60000, light_indoor: 25000 });
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            // Pre-set timer with thu target, but now light is high (should be dai)
            const now = Date.now();
            flowContext.set(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_1", startTime: now - 10 * 60 * 1000, targetAction: "thu", lightValue: 20000 },
            ]);
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            // Timer should be restarted with new target (dai)
            const timers = flowContext.get(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            const luoi1Timer = timers.find((t) => t.luoiId === "luoi_1");
            (0, globals_1.expect)(luoi1Timer).toBeDefined();
            (0, globals_1.expect)(luoi1Timer.targetAction).toBe("dai");
            // Timer should be recent (just restarted)
            (0, globals_1.expect)(now - luoi1Timer.startTime).toBeLessThan(1000);
        });
        (0, globals_1.it)("expired timers (>30 min) are cleaned up", async () => {
            setupServices({}, { light_outdoor: 40000, light_indoor: 20000 }); // Between thresholds
            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData();
            const deviceStatus = sensorService.getDeviceStatus();
            // Pre-set expired timer (35 min old)
            const now = Date.now();
            flowContext.set(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_1", startTime: now - 35 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_2", startTime: now - 5 * 60 * 1000, targetAction: "dai", lightValue: 60000 }, // Not expired
            ]);
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            const timers = flowContext.get(constants_1.CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            // Expired timer should be removed
            (0, globals_1.expect)(timers.find((t) => t.luoiId === "luoi_1")).toBeUndefined();
            // Non-expired timer should remain
            (0, globals_1.expect)(timers.find((t) => t.luoiId === "luoi_2")).toBeDefined();
        });
    });
});

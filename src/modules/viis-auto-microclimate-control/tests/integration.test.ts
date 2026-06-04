import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { ConfigService } from "../services/configService";
import { SensorService } from "../services/sensorService";
import { FanControlService } from "../services/fanControlService";
import { WaterPumpControlService } from "../services/waterPumpControlService";
import { CurtainControlService } from "../services/curtainControlService";
import { FAN_CONFIG, FAN_DAO_CONFIG, WATER_PUMP_CONFIG, CURTAIN_CONFIG, CONTEXT_KEYS } from "../constants";
import { AutoControlConfig, SensorData, DeviceStatus } from "../interfaces/types";

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

function makeServiceOptions(node: any, flowContext: any, globalContext: any) {
    return {
        node,
        nodeId: "integration-test",
        flowContext,
        globalContext,
        environmentConfig: {} as any,
    };
}

// ─── Default test data ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: Record<string, any> = {
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

function makeHoldingRegister(overrides: Partial<SensorData> = {}): Record<string, any> {
    return {
        ts: Date.now(),
        temp_indoor: 28,
        humi_indoor: 70,
        temp_outdoor: 30,
        humi_outdoor: 65,
        light_indoor: 20000,
        light_outdoor: 40000,
        ...overrides,
    };
}

function makeCoilRegister(overrides: Record<string, boolean> = {}): Record<string, any> {
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

// ─── Integration Tests ─────────────────────────────────────────────────────

describe("Microclimate Integration Tests", () => {
    let node: any;
    let flowContext: ReturnType<typeof createMockFlowContext>;
    let globalContext: ReturnType<typeof createMockGlobalContext>;
    let configService: ConfigService;
    let sensorService: SensorService;
    let fanService: FanControlService;
    let waterPumpService: WaterPumpControlService;
    let curtainService: CurtainControlService;

    function setupServices(configOverrides: Record<string, any> = {}, holdingOverrides: Partial<SensorData> = {}, coilOverrides: Record<string, boolean> = {}) {
        node = createMockNode();
        flowContext = createMockFlowContext();
        globalContext = createMockGlobalContext({
            configKeyValues: { ...DEFAULT_CONFIG, ...configOverrides },
            holdingRegisterData: makeHoldingRegister(holdingOverrides),
            coilRegisterData: makeCoilRegister(coilOverrides),
        });

        const options = makeServiceOptions(node, flowContext, globalContext);
        configService = new ConfigService(options);
        sensorService = new SensorService(options);
        fanService = new FanControlService(options);
        waterPumpService = new WaterPumpControlService(options);
        curtainService = new CurtainControlService(options);
    }

    // ─── Threshold Mode Tests ──────────────────────────────────────────

    describe("Threshold Mode — Fan Count per Temperature", () => {
        it("K1: 2 fans when temp >= K1 (25°C) and < K2 (30°C)", async () => {
            setupServices({}, { temp_indoor: 27 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            expect(configService.isConfigValid()).toBe(true);

            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));

            expect(fanOnActions).toHaveLength(2);
            // Should be a symmetric pair
            const fanKeys = fanOnActions.map(a => a.deviceKey).sort();
            const validPairs = [["quat_1", "quat_4"], ["quat_2", "quat_5"], ["quat_3", "quat_6"]];
            const isValidPair = validPairs.some(pair => pair[0] === fanKeys[0] && pair[1] === fanKeys[1]);
            expect(isValidPair).toBe(true);
        });

        it("K2: 3 fans when temp >= K2 (30°C) and < K3 (35°C)", async () => {
            setupServices({}, { temp_indoor: 32 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));

            expect(fanOnActions).toHaveLength(3);
            // Should be an interleaved triple
            const fanKeys = fanOnActions.map(a => a.deviceKey).sort();
            const validTriples = [["quat_1", "quat_3", "quat_5"], ["quat_2", "quat_4", "quat_6"]];
            const isValidTriple = validTriples.some(t => t[0] === fanKeys[0] && t[1] === fanKeys[1] && t[2] === fanKeys[2]);
            expect(isValidTriple).toBe(true);
        });

        it("K3: 4 fans when temp >= K3 (35°C) and < K4 (40°C)", async () => {
            setupServices({}, { temp_indoor: 37 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));

            expect(fanOnActions).toHaveLength(4);
        });

        it("K4: 6 fans when temp >= K4 (40°C)", async () => {
            setupServices({}, { temp_indoor: 42 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));

            expect(fanOnActions).toHaveLength(6);
        });

        it("0 fans when temp < K1 (25°C)", async () => {
            setupServices({}, { temp_indoor: 20 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fanOnActions = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));

            expect(fanOnActions).toHaveLength(0);
        });
    });

    // ─── Water Pump Tests ──────────────────────────────────────────────

    describe("Water Pump — Normal + K4 Override", () => {
        it("turns ON when humidity < low threshold (60%)", async () => {
            setupServices({}, { humi_indoor: 45 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const actions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
            const pumpOn = actions.find(a => a.deviceKey === "bom_nuoc_1" && a.value === true);

            expect(pumpOn).toBeDefined();
        });

        it("turns OFF when humidity > high threshold (85%)", async () => {
            setupServices({}, { humi_indoor: 90 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            // Current device status: pump is ON
            const deviceStatus = { ...sensorService.getDeviceStatus()!, bom_nuoc_1: true };

            // Set flow context state to ON
            flowContext.set(CONTEXT_KEYS.WATER_PUMP_STATE, {
                isOn: true, lastChangeTime: Date.now(), lastHumidity: 45, changeCount: 1, isK4Override: false
            });

            const actions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
            const pumpOff = actions.find(a => a.deviceKey === "bom_nuoc_1" && a.value === false);

            expect(pumpOff).toBeDefined();
        });

        it("K4 override turns ON regardless of humidity", async () => {
            setupServices({}, { temp_indoor: 42, humi_indoor: 95 }); // High humidity!

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;

            const k4Actions = waterPumpService.checkK4PriorityOverride(config, sensorData);
            const pumpOn = k4Actions.find(a => a.deviceKey === "bom_nuoc_1" && a.value === true);

            expect(pumpOn).toBeDefined();
        });

        it("K4 override does NOT activate in rotation mode", async () => {
            setupServices({ set_auto_mode_fan: 1 }, { temp_indoor: 42 }); // 1 = rotation

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;

            const k4Actions = waterPumpService.checkK4PriorityOverride(config, sensorData);

            expect(k4Actions).toEqual([]);
        });
    });

    // ─── Curtain Tests ─────────────────────────────────────────────────

    describe("Curtain Control — Light-based", () => {
        it("starts tolerance timer when light > dai threshold", async () => {
            setupServices({}, { light_outdoor: 60000, light_indoor: 25000 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            await curtainService.processCurtainControl(config, sensorData, deviceStatus);

            const timers = flowContext.get(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            expect(Array.isArray(timers)).toBe(true);
            expect(timers.length).toBeGreaterThan(0);
            expect(timers[0].targetAction).toBe("dai");
        });

        it("starts tolerance timer for thu when light < thu threshold", async () => {
            setupServices({}, { light_outdoor: 20000, light_indoor: 10000 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            await curtainService.processCurtainControl(config, sensorData, deviceStatus);

            const timers = flowContext.get(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            expect(timers.length).toBeGreaterThan(0);
            expect(timers[0].targetAction).toBe("thu");
        });

        it("no action when light is between thu and dai thresholds", async () => {
            setupServices({}, { light_outdoor: 40000, light_indoor: 20000 }); // 30000 < 40000 < 50000

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const actions = await curtainService.processCurtainControl(config, sensorData, deviceStatus);

            expect(actions).toEqual([]);
        });

        it("executes dai action after tolerance timer elapses", async () => {
            setupServices({}, { light_outdoor: 60000, light_indoor: 25000 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            // Pre-set an elapsed tolerance timer
            const now = Date.now();
            flowContext.set(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_1", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_2", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
            ]);

            const actions = await curtainService.processCurtainControl(config, sensorData, deviceStatus);

            // Should have dai actions for both luoi_1 and luoi_2
            const luoi1Dai = actions.find(a => a.deviceKey === "luoi_1_dai" && a.value === true);
            const luoi2Dai = actions.find(a => a.deviceKey === "luoi_2_dai" && a.value === true);
            expect(luoi1Dai).toBeDefined();
            expect(luoi2Dai).toBeDefined();
        });
    });

    // ─── Full Cycle Simulation ─────────────────────────────────────────

    describe("Full Control Cycle Simulation", () => {
        it("hot day: K4 fans + water pump + curtain retract", async () => {
            setupServices(
                {},
                { temp_indoor: 42, humi_indoor: 55, light_outdoor: 10000, light_indoor: 5000 },
                {} // all devices off
            );

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            // 1. Fan control
            const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = fanActions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            expect(fansOn).toHaveLength(6); // K4 → all 6 fans

            // 2. K4 water pump override
            const k4Pump = waterPumpService.checkK4PriorityOverride(config, sensorData);
            expect(k4Pump.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true)).toBe(true);

            // 3. Curtain — light_outdoor=10000 < thu_threshold=30000 → start thu timer
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            const timers = flowContext.get(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            expect(timers.some((t: any) => t.targetAction === "thu")).toBe(true);
        });

        it("cool day: no fans + water pump normal + curtain retract", async () => {
            setupServices(
                {},
                { temp_indoor: 22, humi_indoor: 50, light_outdoor: 20000, light_indoor: 10000 },
                {} // all devices off
            );

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            // 1. Fans: temp=22 < K1=25 → no fans
            const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = fanActions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            expect(fansOn).toHaveLength(0);

            // 2. Water pump: humi=50 < low=60 → ON (normal, not K4)
            const pumpActions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
            expect(pumpActions.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true)).toBe(true);

            // 3. K4 override should NOT activate
            const k4Pump = waterPumpService.checkK4PriorityOverride(config, sensorData);
            expect(k4Pump).toEqual([]);
        });

        it("sunny day: K2 fans + curtain extend", async () => {
            setupServices(
                {},
                { temp_indoor: 32, humi_indoor: 70, light_outdoor: 80000, light_indoor: 40000 },
                {} // all devices off
            );

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            // 1. Fans: temp=32 >= K2=30 → 3 fans
            const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = fanActions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            expect(fansOn).toHaveLength(3);

            // 2. Water pump: humi=70 between low(60) and high(85) → no change
            const pumpActions = await waterPumpService.processWaterPumpControl(config, sensorData, deviceStatus);
            expect(pumpActions).toEqual([]);

            // 3. Curtain: light_outdoor=80000 > dai_threshold=50000 → start dai timer
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            const timers = flowContext.get(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            expect(timers.some((t: any) => t.targetAction === "dai")).toBe(true);
        });

        it("user config: K4 fans + fan dao sync + water pump + curtain", async () => {
            // Use the user's actual config
            setupServices(
                {
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
                },
                { temp_indoor: 35, humi_indoor: 26, light_outdoor: 0, light_indoor: 6225920 },
                {} // all devices off
            );

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            expect(configService.isConfigValid()).toBe(true);

            // 1. Fan control: temp=35 >= K4=30 → 6 fans
            const fanActions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = fanActions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            expect(fansOn).toHaveLength(6);

            // 2. Fan dao: sync mode, first run → toggle ON (lastToggleTime=0)
            const fanDaoActions = fanActions.filter(a => a.deviceKey.startsWith("quat_dao_"));
            expect(fanDaoActions.length).toBeGreaterThan(0);
            expect(fanDaoActions.every(a => a.value === true)).toBe(true); // All ON

            // 3. K4 water pump override
            const k4Pump = waterPumpService.checkK4PriorityOverride(config, sensorData);
            expect(k4Pump.some(a => a.deviceKey === "bom_nuoc_1" && a.value === true)).toBe(true);

            // 4. Curtain: light_outdoor=0 < thu(45000) → start thu timer
            // Note: luoi_3/4 also get timers because they use defaults (50000/30000)
            await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            const timers = flowContext.get(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            expect(timers.length).toBeGreaterThanOrEqual(2); // at least luoi_1 + luoi_2
            expect(timers.every((t: any) => t.targetAction === "thu")).toBe(true);
            // Verify luoi_1 and luoi_2 are present
            expect(timers.some((t: any) => t.luoiId === "luoi_1")).toBe(true);
            expect(timers.some((t: any) => t.luoiId === "luoi_2")).toBe(true);
        });
    });

    // ─── Config Validation ─────────────────────────────────────────────

    describe("Config Validation", () => {
        it("accepts set_auto_mode_fan = 0 (threshold)", () => {
            setupServices({ set_auto_mode_fan: 0 });
            expect(configService.isConfigValid()).toBe(true);
        });

        it("accepts set_auto_mode_fan = 1 (rotation)", () => {
            setupServices({ set_auto_mode_fan: 1 });
            expect(configService.isConfigValid()).toBe(true);
        });

        it("rejects set_auto_mode_fan = 2 (not in enum)", () => {
            setupServices({ set_auto_mode_fan: 2 });
            expect(configService.isConfigValid()).toBe(false);
        });

        it("accepts set_gr_alternate_fan = 3", () => {
            setupServices({ set_gr_alternate_fan: 3 });
            expect(configService.isConfigValid()).toBe(true);
        });

        it("rejects set_gr_alternate_fan = 5 (not in [1,2,3,4,6])", () => {
            setupServices({ set_gr_alternate_fan: 5 });
            expect(configService.isConfigValid()).toBe(false);
        });

        it("accepts user's full config", () => {
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
            expect(configService.isConfigValid()).toBe(true);
        });
    });

    // ─── Sensor Service Integration ────────────────────────────────────

    describe("Sensor Service — Data Parsing", () => {
        it("parses holdingRegisterData correctly", () => {
            setupServices({}, {
                temp_indoor: 28.5,
                humi_indoor: 72.3,
                light_outdoor: 45000,
                light_indoor: 18000,
            });

            const sensorData = sensorService.getSensorData();
            expect(sensorData).not.toBeNull();
            expect(sensorData!.temp_indoor).toBe(28.5);
            expect(sensorData!.humi_indoor).toBe(72.3);
            expect(sensorData!.light_outdoor).toBe(45000);
            expect(sensorData!.light_indoor).toBe(18000);
        });

        it("parses coilRegisterData correctly", () => {
            setupServices({}, {}, {
                quat_1: true,
                quat_4: true,
                bom_nuoc_1: true,
                luoi_1_dai: true,
            });

            const deviceStatus = sensorService.getDeviceStatus();
            expect(deviceStatus).not.toBeNull();
            expect(deviceStatus!.quat_1).toBe(true);
            expect(deviceStatus!.quat_4).toBe(true);
            expect(deviceStatus!.quat_2).toBe(false);
            expect(deviceStatus!.bom_nuoc_1).toBe(true);
            expect(deviceStatus!.luoi_1_dai).toBe(true);
            expect(deviceStatus!.luoi_1_thu).toBe(false);
        });

        it("returns null when holdingRegisterData is missing", () => {
            globalContext = createMockGlobalContext({
                configKeyValues: DEFAULT_CONFIG,
                // No holdingRegisterData
                coilRegisterData: makeCoilRegister(),
            });
            const options = makeServiceOptions(createMockNode(), createMockFlowContext(), globalContext);
            const svc = new SensorService(options);

            expect(svc.getSensorData()).toBeNull();
        });
    });

    // ─── Rotation Mode Tests ────────────────────────────────────────────

    describe("Rotation Mode (set_auto_mode_fan=1)", () => {
        it("rotates fan groups by time interval", async () => {
            setupServices({ set_auto_mode_fan: 1, set_gr_alternate_fan: 2, set_time_alternate_fan: 15, set_fan_group_transition_delay: 0, set_fan_group_off_delay: 0 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            // First cycle: should activate first group
            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            expect(fansOn).toHaveLength(2);
        });

        it("respects set_gr_alternate_fan group size", async () => {
            setupServices({ set_auto_mode_fan: 1, set_gr_alternate_fan: 3, set_time_alternate_fan: 15, set_fan_group_transition_delay: 0, set_fan_group_off_delay: 0 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const actions = await fanService.processFanControl(config, sensorData, deviceStatus);
            const fansOn = actions.filter(a => a.value === true && a.deviceKey.startsWith("quat_") && !a.deviceKey.includes("dao"));
            expect(fansOn).toHaveLength(3);
        });

        it("K4 override does NOT activate in rotation mode", async () => {
            setupServices({ set_auto_mode_fan: 1 }, { temp_indoor: 42 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;

            const k4Actions = waterPumpService.checkK4PriorityOverride(config, sensorData);
            expect(k4Actions).toEqual([]);
        });
    });

    // ─── Curtain Timer Elapse Tests ─────────────────────────────────────

    describe("Curtain — Timer Elapse Scenarios", () => {
        it("luoi_1 dai: timer elapsed + light still high → execute", async () => {
            setupServices({}, { light_outdoor: 60000, light_indoor: 25000 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            // Pre-set elapsed timer
            const now = Date.now();
            flowContext.set(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_1", startTime: now - 10 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
            ]);

            const actions = await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            expect(actions.find(a => a.deviceKey === "luoi_1_dai" && a.value === true)).toBeDefined();
            expect(actions.find(a => a.deviceKey === "luoi_1_thu" && a.value === false)).toBeDefined();
        });

        it("luoi_2 thu: timer elapsed + light still low → execute", async () => {
            setupServices({}, { light_outdoor: 20000, light_indoor: 10000 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            const now = Date.now();
            flowContext.set(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_2", startTime: now - 10 * 60 * 1000, targetAction: "thu", lightValue: 20000 },
            ]);

            const actions = await curtainService.processCurtainControl(config, sensorData, deviceStatus);
            expect(actions.find(a => a.deviceKey === "luoi_2_thu" && a.value === true)).toBeDefined();
            expect(actions.find(a => a.deviceKey === "luoi_2_dai" && a.value === false)).toBeDefined();
        });

        it("timer restarts when condition changes during wait", async () => {
            setupServices({}, { light_outdoor: 60000, light_indoor: 25000 });

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            // Pre-set timer with thu target, but now light is high (should be dai)
            const now = Date.now();
            flowContext.set(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_1", startTime: now - 10 * 60 * 1000, targetAction: "thu", lightValue: 20000 },
            ]);

            await curtainService.processCurtainControl(config, sensorData, deviceStatus);

            // Timer should be restarted with new target (dai)
            const timers = flowContext.get(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            const luoi1Timer = timers.find((t: any) => t.luoiId === "luoi_1");
            expect(luoi1Timer).toBeDefined();
            expect(luoi1Timer.targetAction).toBe("dai");
            // Timer should be recent (just restarted)
            expect(now - luoi1Timer.startTime).toBeLessThan(1000);
        });

        it("expired timers (>30 min) are cleaned up", async () => {
            setupServices({}, { light_outdoor: 40000, light_indoor: 20000 }); // Between thresholds

            const config = configService.getConfig();
            const sensorData = sensorService.getSensorData()!;
            const deviceStatus = sensorService.getDeviceStatus()!;

            // Pre-set expired timer (35 min old)
            const now = Date.now();
            flowContext.set(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS, [
                { luoiId: "luoi_1", startTime: now - 35 * 60 * 1000, targetAction: "dai", lightValue: 60000 },
                { luoiId: "luoi_2", startTime: now - 5 * 60 * 1000, targetAction: "dai", lightValue: 60000 }, // Not expired
            ]);

            await curtainService.processCurtainControl(config, sensorData, deviceStatus);

            const timers = flowContext.get(CONTEXT_KEYS.CURTAIN_TOLERANCE_TIMERS);
            // Expired timer should be removed
            expect(timers.find((t: any) => t.luoiId === "luoi_1")).toBeUndefined();
            // Non-expired timer should remain
            expect(timers.find((t: any) => t.luoiId === "luoi_2")).toBeDefined();
        });
    });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const constants_1 = require("../constants");
const groupUtils_1 = require("../utils/groupUtils");
// Helper to build a minimal FanControlService for testing processFanDaoControl
function createMockFlowContext() {
    const store = {};
    return {
        get: (key) => store[key],
        set: (key, value) => { store[key] = value; },
        keys: () => Object.keys(store),
        _store: store
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
// Import the service after setting up mocks
const fanControlService_1 = require("../services/fanControlService");
function createService() {
    const flowContext = createMockFlowContext();
    const globalContext = createMockGlobalContext();
    const node = { status: globals_1.jest.fn() };
    const service = new fanControlService_1.FanControlService({
        node,
        nodeId: "test-node",
        flowContext,
        globalContext,
        environmentConfig: {},
    });
    return { service, flowContext, globalContext };
}
(0, globals_1.describe)("Fan Dao Control", () => {
    (0, globals_1.describe)("utility functions", () => {
        (0, globals_1.it)("getAllFanDaoKeys returns 3 fans", () => {
            (0, globals_1.expect)((0, groupUtils_1.getAllFanDaoKeys)()).toEqual(["quat_dao_1", "quat_dao_2", "quat_dao_3"]);
        });
        (0, globals_1.it)("createFanDaoActions creates ON actions for all 3 fans", () => {
            const coilMapping = {
                quat_dao_1: 6,
                quat_dao_2: 7,
                quat_dao_3: 8,
            };
            const actions = (0, groupUtils_1.createFanDaoActions)(true, "test on", coilMapping);
            (0, globals_1.expect)(actions).toHaveLength(3);
            actions.forEach((action, i) => {
                (0, globals_1.expect)(action.value).toBe(true);
                (0, globals_1.expect)(action.deviceKey).toBe(`quat_dao_${i + 1}`);
                (0, globals_1.expect)(action.fc).toBe(constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL);
            });
        });
        (0, globals_1.it)("createFanDaoActions creates OFF actions for all 3 fans", () => {
            const coilMapping = {
                quat_dao_1: 6,
                quat_dao_2: 7,
                quat_dao_3: 8,
            };
            const actions = (0, groupUtils_1.createFanDaoActions)(false, "test off", coilMapping);
            (0, globals_1.expect)(actions).toHaveLength(3);
            actions.forEach(action => {
                (0, globals_1.expect)(action.value).toBe(false);
            });
        });
    });
    (0, globals_1.describe)("processFanDaoControl", () => {
        (0, globals_1.it)("returns empty when set_mode_fan_dao !== 1", async () => {
            const { service } = createService();
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 0,
                set_auto_mode_fan_dao: 1,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 30,
            });
            (0, globals_1.expect)(actions).toEqual([]);
        });
        (0, globals_1.it)("defaults to Synchronization mode when set_auto_mode_fan_dao is not set", async () => {
            const { service, flowContext } = createService();
            // First call initializes state with lastToggleTime=0, which means
            // elapsed time is huge → immediately toggles ON
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 30,
            });
            // Should have initialized sync state and toggled ON (since lastToggleTime=0)
            const state = flowContext.get("fanRotationState_dao_sync");
            (0, globals_1.expect)(state).toBeDefined();
            (0, globals_1.expect)(state.isOn).toBe(true); // Toggled ON because elapsed > T_off
        });
    });
    (0, globals_1.describe)("Synchronization mode (autoMode=1)", () => {
        (0, globals_1.it)("initializes state correctly on first run", async () => {
            const { service, flowContext } = createService();
            // First run with lastToggleTime=0 → elapsed is huge → toggles ON immediately
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 1,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 30,
            });
            const state = flowContext.get("fanRotationState_dao_sync");
            (0, globals_1.expect)(state).toBeDefined();
            (0, globals_1.expect)(state.isOn).toBe(true); // Toggled ON because elapsed > T_off
            (0, globals_1.expect)(state.lastToggleTime).toBeGreaterThan(0);
        });
        (0, globals_1.it)("toggles ON after time_off elapses", async () => {
            const { service, flowContext } = createService();
            // Set state as if it was turned off 31 minutes ago
            const now = Date.now();
            flowContext.set("fanRotationState_dao_sync", {
                isOn: false,
                lastToggleTime: now - 31 * 60 * 1000, // 31 minutes ago
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 1,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 30,
            });
            (0, globals_1.expect)(actions.length).toBeGreaterThan(0);
            // All fan dao should turn ON
            const onActions = actions.filter(a => a.value === true);
            (0, globals_1.expect)(onActions).toHaveLength(3);
            const state = flowContext.get("fanRotationState_dao_sync");
            (0, globals_1.expect)(state.isOn).toBe(true);
        });
        (0, globals_1.it)("toggles OFF after time_on elapses", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            flowContext.set("fanRotationState_dao_sync", {
                isOn: true,
                lastToggleTime: now - 6 * 60 * 1000, // 6 minutes ago
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 1,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 30,
            });
            (0, globals_1.expect)(actions.length).toBeGreaterThan(0);
            const offActions = actions.filter(a => a.value === false);
            (0, globals_1.expect)(offActions).toHaveLength(3);
            const state = flowContext.get("fanRotationState_dao_sync");
            (0, globals_1.expect)(state.isOn).toBe(false);
        });
        (0, globals_1.it)("returns empty when timer has not elapsed", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            flowContext.set("fanRotationState_dao_sync", {
                isOn: true,
                lastToggleTime: now - 1 * 60 * 1000, // 1 minute ago (less than T_on=5)
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 1,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 30,
            });
            (0, globals_1.expect)(actions).toEqual([]);
        });
    });
    (0, globals_1.describe)("Scrolling mode (autoMode=2)", () => {
        (0, globals_1.it)("initializes state correctly on first run", async () => {
            const { service, flowContext } = createService();
            await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            const state = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state).toBeDefined();
            (0, globals_1.expect)(state.currentIndex).toBe(0);
            (0, globals_1.expect)(state.phase).toBe("ON");
        });
        (0, globals_1.it)("transitions from ON to OFF phase after T_on", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 0,
                phase: "ON",
                lastTransitionTime: now - 6 * 60 * 1000, // 6 min > T_on=5
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            // Should turn OFF quat_dao_1
            (0, globals_1.expect)(actions.length).toBeGreaterThan(0);
            const offAction = actions.find(a => a.deviceKey === "quat_dao_1" && a.value === false);
            (0, globals_1.expect)(offAction).toBeDefined();
            const state = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state.phase).toBe("OFF");
            (0, globals_1.expect)(state.currentIndex).toBe(0);
        });
        (0, globals_1.it)("transitions from OFF to next fan ON after T_off", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 0,
                phase: "OFF",
                lastTransitionTime: now - 11 * 60 * 1000, // 11 min > T_off=10
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            // Should turn ON quat_dao_2 (next in sequence)
            (0, globals_1.expect)(actions.length).toBeGreaterThan(0);
            const onAction = actions.find(a => a.deviceKey === "quat_dao_2" && a.value === true);
            (0, globals_1.expect)(onAction).toBeDefined();
            const state = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state.phase).toBe("ON");
            (0, globals_1.expect)(state.currentIndex).toBe(1);
        });
        (0, globals_1.it)("wraps around from Q3 back to Q0", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 2, // Q3
                phase: "OFF",
                lastTransitionTime: now - 11 * 60 * 1000,
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            // Should turn ON quat_dao_1 (wraps to index 0)
            const onAction = actions.find(a => a.deviceKey === "quat_dao_1" && a.value === true);
            (0, globals_1.expect)(onAction).toBeDefined();
            const state = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state.currentIndex).toBe(0);
        });
        (0, globals_1.it)("returns empty when timer has not elapsed", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 0,
                phase: "ON",
                lastTransitionTime: now - 1 * 60 * 1000, // 1 min < T_on=5
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            (0, globals_1.expect)(actions).toEqual([]);
        });
    });
});

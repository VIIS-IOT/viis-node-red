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
        (0, globals_1.it)("starts first fan on first run", async () => {
            const { service, flowContext } = createService();
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            // First run: should turn ON quat_dao_1
            const onAction = actions.find(a => a.deviceKey === "quat_dao_1" && a.value === true);
            (0, globals_1.expect)(onAction).toBeDefined();
            const state = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state.currentIndex).toBe(0);
            (0, globals_1.expect)(state.isRunning).toBe(true);
        });
        (0, globals_1.it)("transitions to next fan after T_on (T_off < 2×T_on, no gap)", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 0,
                lastStopTime: [0, 0, 0], // all fans never stopped → available
                activeFanSince: now - 6 * 60 * 1000, // 6 min > T_on=5
                isRunning: true,
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 3, // T_off=3 < 2×T_on=10 → no gap
            });
            // Should turn OFF quat_dao_1 and ON quat_dao_2
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_1" && a.value === false)).toBeDefined();
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_2" && a.value === true)).toBeDefined();
            const state = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state.currentIndex).toBe(1);
            (0, globals_1.expect)(state.isRunning).toBe(true);
        });
        (0, globals_1.it)("creates gap when T_off > 2×T_on and no fan rested enough", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            // Q1 just stopped, Q2 stopped 3 min ago, Q3 stopped 3 min ago
            // T_off=10 → none rested enough (need 10 min)
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 0,
                lastStopTime: [now, now - 3 * 60 * 1000, now - 3 * 60 * 1000],
                activeFanSince: now - 6 * 60 * 1000,
                isRunning: true,
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10, // T_off=10 > rest times
            });
            // Q1 should turn OFF
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_1" && a.value === false)).toBeDefined();
            // No fan should turn ON (gap)
            (0, globals_1.expect)(actions.find(a => a.value === true)).toBeUndefined();
            const state = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state.isRunning).toBe(false);
        });
        (0, globals_1.it)("finds next available fan after gap", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            // State: not running (gap), Q1 stopped 15 min ago, Q2 stopped 3 min ago, Q3 stopped 3 min ago
            // T_off=10 → Q1 rested enough (15 >= 10)
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 2, // Q3 was last active
                lastStopTime: [now - 15 * 60 * 1000, now - 3 * 60 * 1000, now],
                activeFanSince: now - 6 * 60 * 1000,
                isRunning: false, // gap state
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            // Should start Q1 (it's the next available after Q3, rested 15 min >= 10)
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_1" && a.value === true)).toBeDefined();
            const state = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state.currentIndex).toBe(0);
            (0, globals_1.expect)(state.isRunning).toBe(true);
        });
        (0, globals_1.it)("skips fans that haven't rested enough, finds the one that has", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            // Q1 just stopped, Q2 stopped 12 min ago, Q3 stopped 2 min ago
            // T_off=10 → Q2 rested enough (12 >= 10), Q3 not (2 < 10)
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 0,
                lastStopTime: [now, now - 12 * 60 * 1000, now - 2 * 60 * 1000],
                activeFanSince: now - 6 * 60 * 1000,
                isRunning: true,
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            // Should skip Q2 (index 1 → next after Q1 is Q2), find Q2 rested enough
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_2" && a.value === true)).toBeDefined();
        });
        (0, globals_1.it)("returns empty when current fan still running (T_on not elapsed)", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 0,
                lastStopTime: [0, 0, 0],
                activeFanSince: now - 1 * 60 * 1000, // 1 min < T_on=5
                isRunning: true,
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            (0, globals_1.expect)(actions).toEqual([]);
        });
        (0, globals_1.it)("wraps around from Q3 back to Q1", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 2, // Q3
                lastStopTime: [now - 20 * 60 * 1000, now - 20 * 60 * 1000, now], // Q1 and Q2 rested long ago
                activeFanSince: now - 6 * 60 * 1000,
                isRunning: true,
            });
            const actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1,
                set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5,
                set_time_fan_dao_off: 10,
            });
            // Should wrap to Q1 (index 0)
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_1" && a.value === true)).toBeDefined();
            const state = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state.currentIndex).toBe(0);
        });
        (0, globals_1.it)("multi-cycle: Q1→gap→Q1→Q2→Q3 with T_off > 2×T_on", async () => {
            const { service, flowContext } = createService();
            const now = Date.now();
            // Cycle 1: Q1 starts (first run)
            flowContext.set("fanRotationState_dao_scroll", {
                currentIndex: 0,
                lastStopTime: [0, 0, 0],
                activeFanSince: now,
                isRunning: false,
            });
            let actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1, set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5, set_time_fan_dao_off: 30,
            });
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_1" && a.value === true)).toBeDefined();
            // Cycle 2: Q1 finished T_on (6 min later), Q2 never ran → available
            const state1 = flowContext.get("fanRotationState_dao_scroll");
            state1.activeFanSince = now - 6 * 60 * 1000;
            flowContext.set("fanRotationState_dao_scroll", state1);
            actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1, set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5, set_time_fan_dao_off: 30,
            });
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_1" && a.value === false)).toBeDefined();
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_2" && a.value === true)).toBeDefined();
            // Cycle 3: Q2 finished T_on, Q3 never ran → available
            const state2 = flowContext.get("fanRotationState_dao_scroll");
            state2.activeFanSince = now - 6 * 60 * 1000;
            flowContext.set("fanRotationState_dao_scroll", state2);
            actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1, set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5, set_time_fan_dao_off: 30,
            });
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_2" && a.value === false)).toBeDefined();
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_3" && a.value === true)).toBeDefined();
            // Cycle 4: Q3 finished T_on, Q1 rested 12 min < T_off=30, Q2 rested 6 min < 30 → GAP
            const state3 = flowContext.get("fanRotationState_dao_scroll");
            state3.activeFanSince = now - 6 * 60 * 1000;
            flowContext.set("fanRotationState_dao_scroll", state3);
            actions = await service.processFanDaoControl({
                set_mode_fan_dao: 1, set_auto_mode_fan_dao: 2,
                set_time_fan_dao_on: 5, set_time_fan_dao_off: 30,
            });
            (0, globals_1.expect)(actions.find(a => a.deviceKey === "quat_dao_3" && a.value === false)).toBeDefined();
            (0, globals_1.expect)(actions.find(a => a.value === true)).toBeUndefined(); // No fan ON → gap
            const state4 = flowContext.get("fanRotationState_dao_scroll");
            (0, globals_1.expect)(state4.isRunning).toBe(false);
        });
    });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Scenario trigger events of OFFLINE intents (ADR-035, G1/G2).
 * Path under test: AutomationHandler.processAutomation → ProcessingService (protection gate) →
 * ScenarioTriggerReporter → (flow) → viis-modbus-flex reportScenarioWriteFromMsg → sink.
 */
const automationHandler_1 = require("../handlers/automationHandler");
const intentService_1 = require("../services/intentService");
const mqttService_1 = require("../services/mqttService");
const processingService_1 = require("../services/processingService");
const scenarioTriggerEvents_1 = require("../services/scenarioTriggerEvents");
const scenarioTriggerTracker_1 = require("../services/scenarioTriggerTracker");
const DEVICE = "dev-1";
const AT = new Date("2026-10-15T03:04:05.000Z");
function fakeNode() {
    const store = {};
    return {
        store,
        context: () => ({ get: (key) => store[key], set: (key, value) => { store[key] = value; } }),
        send: jest.fn(),
        status: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
}
const quietLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
/** Intent "Tưới khi khô": soil_moisture < 30 (%) → pump_1 = true, valve_2 = true. */
function intent(overrides = {}) {
    return Object.assign({ id: "intent-42", label: "Tưới khi khô", enable: true, type: "OFFLINE", connecter: "AND", interval_windown: 60, conditions: [
            {
                id: "c1",
                type: "SINGLE",
                connecter: "AND",
                conditions: null,
                predicate: {
                    id: "p1",
                    device_id: DEVICE,
                    identifier: "soil_moisture",
                    operation: "<",
                    dbl_v: 30,
                    function: { identifier: "soil_moisture", data_type: "Double", unit: "%" },
                },
            },
        ], device_actions: [
            { id: "a1", device_id: DEVICE, bool_v: true, function: { identifier: "pump_1", data_type: "Bool" } },
            { id: "a2", device_id: DEVICE, bool_v: true, function: { identifier: "valve_2", data_type: "Bool" } },
        ], schedule_plan_actions: [] }, overrides);
}
function data(moisture, extra = {}) {
    const latest = [{ key: "soil_moisture", value: moisture, ts: 1 }, { key: "pump_1", value: false, ts: 1 }, { key: "valve_2", value: false, ts: 1 }];
    for (const [key, value] of Object.entries(extra)) {
        const row = latest.find(r => r.key === key);
        if (row)
            row.value = value;
        else
            latest.push({ key, value: value, ts: 1 });
    }
    return [{ device_id: DEVICE, latest_data: latest }];
}
function setup(opts = {}) {
    var _a, _b;
    const node = fakeNode();
    const globalStore = {};
    if (opts.gate)
        globalStore.protectionGateService = opts.gate;
    const options = { node, flowContext: {}, globalContext: { get: (k) => globalStore[k] } };
    const sink = (_a = opts.sink) !== null && _a !== void 0 ? _a : jest.fn().mockResolvedValue(true);
    let n = 0;
    const reporter = new scenarioTriggerTracker_1.ScenarioTriggerReporter({
        deviceId: DEVICE,
        edges: new scenarioTriggerEvents_1.ScenarioTriggerEdges(node.context()),
        sink,
        logger: quietLogger,
        writeResultTimeoutMs: (_b = opts.timeoutMs) !== null && _b !== void 0 ? _b : 30000,
        now: () => AT,
        newId: () => `uuid-${++n}`,
    });
    const handler = new automationHandler_1.AutomationHandler(options, new intentService_1.IntentService(options, { id: DEVICE, accessToken: "tok" }), new processingService_1.ProcessingService(options), new mqttService_1.MqttAutomationService(options), reporter);
    /** Output-1 msg of the last evaluation. */
    const lastOut = () => node.send.mock.calls[node.send.mock.calls.length - 1][0][0];
    return { node, handler, sink, reporter, lastOut };
}
/** What the flow does with output 1: one write command per allowed action, then viis-modbus-flex. */
function writeAll(out, responses) {
    var _a;
    for (const result of out.payload.results) {
        for (const action of result.device_actions) {
            const command = Object.assign(Object.assign({}, out), { payload: { fc: 5 }, device_id: DEVICE, offlineKey: action.key, offlineValue: action.value });
            (0, scenarioTriggerTracker_1.reportScenarioWriteFromMsg)(command, (_a = responses[action.key]) !== null && _a !== void 0 ? _a : { success: true });
        }
    }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function blockingGate(blockedKey, reason) {
    return {
        checkGate: jest.fn((key) => key === blockedKey
            ? { allowed: false, reason, action: "block" }
            : { allowed: true, reason: "ok", action: "allow" }),
        updateState: jest.fn(),
    };
}
afterEach(() => {
    (0, scenarioTriggerTracker_1.clearPendingScenarioBatches)();
    jest.useRealTimers();
});
describe("worstScenarioResult", () => {
    it("ranks failed > blocked > executed", () => {
        expect((0, scenarioTriggerEvents_1.worstScenarioResult)(["executed", "executed"])).toBe("executed");
        expect((0, scenarioTriggerEvents_1.worstScenarioResult)(["executed", "blocked"])).toBe("blocked");
        expect((0, scenarioTriggerEvents_1.worstScenarioResult)(["blocked", "failed", "executed"])).toBe("failed");
        expect((0, scenarioTriggerEvents_1.worstScenarioResult)(["failed", "blocked"])).toBe("failed");
        expect((0, scenarioTriggerEvents_1.worstScenarioResult)([])).toBe("executed");
    });
});
describe("scenario trigger event", () => {
    it("sends the contract payload once every write succeeded", async () => {
        const { handler, sink, lastOut } = setup();
        await handler.processAutomation([intent()], data(22.5));
        const out = lastOut();
        expect(out[scenarioTriggerEvents_1.SCENARIO_TRIGGER_BATCH_PROP]).toBe("uuid-2");
        expect(sink).not.toHaveBeenCalled(); // waits for the write results
        writeAll(out, {});
        await flush();
        expect(sink).toHaveBeenCalledTimes(1);
        const event = sink.mock.calls[0][0];
        expect(event).toEqual({
            alarm_name: "Tưới khi khô",
            id: DEVICE,
            msg: 'Kịch bản "Tưới khi khô" đã kích hoạt',
            message_key: "iot.notification.scenario.triggered",
            message_params: {
                scenarioName: "Tưới khi khô",
                scenarioId: "intent-42",
                triggerId: "uuid-1",
                runsOn: "device",
                result: "executed",
                conditions: [{ key: "soil_moisture", value: 22.5, operator: "<", threshold: 30, unit: "%" }],
                actions: [
                    { kind: "device", key: "pump_1", target_id: DEVICE, value: true, status: "executed" },
                    { kind: "device", key: "valve_2", target_id: DEVICE, value: true, status: "executed" },
                ],
                triggeredAt: "2026-10-15T03:04:05.000Z",
            },
            message_locale: "vi-VN",
            severity: "notification",
            trigger_time: "2026-10-15T03:04:05.000Z",
            tb_alarm_id: "scenario:intent-42:uuid-1",
            alarm_status: "Pending",
            clear_by: "",
            clear_by_user_id: "",
            entity: DEVICE,
        });
        expect((0, scenarioTriggerTracker_1.pendingScenarioBatchCount)()).toBe(0);
    });
    it("maps a failed Modbus write to failed with its error (severity error)", async () => {
        const { handler, sink, lastOut } = setup();
        await handler.processAutomation([intent()], data(10));
        writeAll(lastOut(), { valve_2: { error: "Modbus client not connected", timestamp: 1 } });
        await flush();
        const event = sink.mock.calls[0][0];
        expect(event.message_params.actions.map(a => [a.key, a.status, a.reason])).toEqual([
            ["pump_1", "executed", undefined],
            ["valve_2", "failed", "Modbus client not connected"],
        ]);
        expect(event.message_params.result).toBe("failed");
        expect(event.severity).toBe("error");
        expect(event.msg).not.toMatch(/thành công/);
    });
    it("maps a protection-gate block to blocked with the gate reason; the blocked action is not written", async () => {
        const gate = blockingGate("pump_1", "Min off time not met (12s/60s) — must stay OFF");
        const { handler, sink, lastOut } = setup({ gate });
        await handler.processAutomation([intent()], data(10));
        const out = lastOut();
        expect(out.payload.results[0].device_actions.map((a) => a.key)).toEqual(["valve_2"]);
        writeAll(out, {});
        await flush();
        const event = sink.mock.calls[0][0];
        expect(event.message_params.actions).toEqual([
            { kind: "device", key: "valve_2", target_id: DEVICE, value: true, status: "executed" },
            { kind: "device", key: "pump_1", target_id: DEVICE, value: true, status: "blocked", reason: "Min off time not met (12s/60s) — must stay OFF" },
        ]);
        expect(event.message_params.result).toBe("blocked");
        expect(event.severity).toBe("notification");
    });
    it("sends at once when every action was blocked (nothing to write)", async () => {
        const gate = { checkGate: jest.fn(() => ({ allowed: false, reason: "Force OFF active", action: "force_off" })), updateState: jest.fn() };
        const { handler, sink, lastOut } = setup({ gate });
        await handler.processAutomation([intent()], data(10));
        await flush();
        expect(lastOut()[scenarioTriggerEvents_1.SCENARIO_TRIGGER_BATCH_PROP]).toBeUndefined();
        expect(sink).toHaveBeenCalledTimes(1);
        expect(sink.mock.calls[0][0].message_params.result).toBe("blocked");
        expect((0, scenarioTriggerTracker_1.pendingScenarioBatchCount)()).toBe(0);
    });
    it("marks an action without a write result as failed after the timeout", async () => {
        jest.useFakeTimers();
        const { handler, sink, lastOut } = setup({ timeoutMs: 5000 });
        await handler.processAutomation([intent()], data(10));
        const out = lastOut();
        // Only pump_1 reaches viis-modbus-flex (valve_2 was dropped by the flow, e.g. no Modbus mapping).
        (0, scenarioTriggerTracker_1.reportScenarioWriteFromMsg)(Object.assign(Object.assign({}, out), { device_id: DEVICE, offlineKey: "pump_1" }), { success: true });
        expect(sink).not.toHaveBeenCalled();
        jest.advanceTimersByTime(5000);
        jest.useRealTimers();
        await flush();
        const event = sink.mock.calls[0][0];
        expect(event.message_params.actions.map(a => [a.key, a.status, a.reason])).toEqual([
            ["pump_1", "executed", undefined],
            ["valve_2", "failed", scenarioTriggerTracker_1.NO_WRITE_RESULT_REASON],
        ]);
        expect((0, scenarioTriggerTracker_1.pendingScenarioBatchCount)()).toBe(0);
    });
    it("sends nothing when every action is already applied", async () => {
        const { handler, sink, lastOut } = setup();
        await handler.processAutomation([intent()], data(10, { pump_1: true, valve_2: true }));
        await flush();
        expect(lastOut()[scenarioTriggerEvents_1.SCENARIO_TRIGGER_BATCH_PROP]).toBeUndefined();
        expect(sink).not.toHaveBeenCalled();
    });
    it("ignores ONLINE and disabled intents", async () => {
        const { handler, sink } = setup();
        await handler.processAutomation([intent({ id: "online", type: "ONLINE" }), intent({ id: "off", enable: false })], data(10));
        await flush();
        expect(sink).not.toHaveBeenCalled();
        expect((0, scenarioTriggerTracker_1.pendingScenarioBatchCount)()).toBe(0);
    });
    it("ignores write results without a trigger batch", () => {
        expect((0, scenarioTriggerTracker_1.reportScenarioWriteFromMsg)({ device_id: DEVICE, offlineKey: "pump_1" }, { success: true })).toBe(false);
    });
});
describe("rising-edge debounce", () => {
    async function evaluate(ctx, moisture) {
        // Writes keep failing, so every true evaluation still has actions to send.
        await ctx.handler.processAutomation([intent()], data(moisture));
        writeAll(ctx.lastOut(), { pump_1: { error: "timeout" }, valve_2: { error: "timeout" } });
        await flush();
    }
    it("true, true, true → one event", async () => {
        const ctx = setup();
        await evaluate(ctx, 10);
        await evaluate(ctx, 11);
        await evaluate(ctx, 12);
        expect(ctx.sink).toHaveBeenCalledTimes(1);
        // The later evaluations still write; they carry no batch id.
        expect(ctx.lastOut()[scenarioTriggerEvents_1.SCENARIO_TRIGGER_BATCH_PROP]).toBeUndefined();
        expect(ctx.lastOut().payload.results[0].device_actions).toHaveLength(2);
    });
    it("true, false, true → two events", async () => {
        const ctx = setup();
        await evaluate(ctx, 10);
        await evaluate(ctx, 50);
        await evaluate(ctx, 10);
        expect(ctx.sink).toHaveBeenCalledTimes(2);
        const triggerIds = ctx.sink.mock.calls.map(c => c[0].message_params.triggerId);
        expect(new Set(triggerIds).size).toBe(2);
    });
    it("keeps the fired state in the node context across a restart", async () => {
        const first = setup();
        await evaluate(first, 10);
        expect(first.node.store[scenarioTriggerEvents_1.FIRED_INTENTS_CONTEXT_KEY]).toEqual(["intent-42"]);
        // New node instance (restart) with the persisted context: the condition is still true.
        const second = setup();
        Object.assign(second.node.store, first.node.store);
        const reporter = new scenarioTriggerTracker_1.ScenarioTriggerReporter({
            deviceId: DEVICE,
            edges: new scenarioTriggerEvents_1.ScenarioTriggerEdges(second.node.context()),
            sink: second.sink,
            logger: quietLogger,
        });
        reporter.onEvaluation([intent()], data(10), [{ id: "intent-42", schedule_plan_actions: [], device_actions: [{ device_id: DEVICE, key: "pump_1", value: true }] }]);
        await flush();
        expect(second.sink).not.toHaveBeenCalled();
        expect((0, scenarioTriggerTracker_1.pendingScenarioBatchCount)()).toBe(0);
    });
});
describe("sender failures never reach the evaluation", () => {
    it("a rejecting sink is logged, the evaluation output is still sent", async () => {
        const sink = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
        const { handler, node, lastOut } = setup({ sink, gate: { checkGate: () => ({ allowed: false, reason: "x", action: "block" }), updateState: jest.fn() } });
        await expect(handler.processAutomation([intent()], data(10))).resolves.toBeUndefined();
        await flush();
        expect(sink).toHaveBeenCalledTimes(1);
        expect(lastOut().payload.results).toHaveLength(1);
        expect(node.error).not.toHaveBeenCalled();
        expect(quietLogger.error).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
    });
    it("a sink that throws synchronously is contained too", async () => {
        const sink = jest.fn(() => { throw new Error("boom"); });
        const { handler, lastOut } = setup({ sink: sink });
        await handler.processAutomation([intent()], data(10));
        expect(() => writeAll(lastOut(), {})).not.toThrow();
        await flush();
        expect(sink).toHaveBeenCalledTimes(1);
    });
    it("a reporter that blows up does not stop the output", async () => {
        const { node, handler } = setup();
        handler.scenarioTriggers.evaluate = () => { throw new Error("bad state"); };
        await handler.processAutomation([intent()], data(10));
        expect(node.send).toHaveBeenCalledTimes(1);
        expect(node.send.mock.calls[0][0][0][scenarioTriggerEvents_1.SCENARIO_TRIGGER_BATCH_PROP]).toBeUndefined();
    });
});

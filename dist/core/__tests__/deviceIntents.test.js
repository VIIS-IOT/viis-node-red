"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * OFFLINE intent evaluator (`DeviceIntentService`) reads values with the backend rule
 * (`intentValue.ts`): the POPULATED column decides, not `function.data_type` alone.
 * Mirrors the `DeviceIntentService.*` describes of backend
 * `tests/services/device-intent-predicate-compare.test.ts` @ 2940375b.
 */
const deviceIntents_1 = require("../deviceIntents");
const DEVICE_ID = "dev-1";
const latestData = (...entries) => [
    {
        device_id: DEVICE_ID,
        latest_data: entries.map((entry) => ({ key: entry.key, ts: Date.now(), value: entry.value })),
    },
];
const fn = (data_type, identifier) => ({ name: data_type, data_type, identifier });
const predicate = (overrides = {}) => (Object.assign({ id: "pred-1", function_id: "fn-enum", function: fn("Enum"), operation: "=", identifier: "mode", bool_v: null, dbl_v: null, str_v: "AUTO", device_id: DEVICE_ID }, overrides));
const action = (overrides = {}) => (Object.assign({ id: "action-1", device_id: DEVICE_ID, function: fn("Enum", "mode"), bool_v: null, dbl_v: null, str_v: null }, overrides));
describe("DeviceIntentService.getIntentPredicateResult", () => {
    const evaluate = (node, ...cached) => new deviceIntents_1.DeviceIntentService([], latestData(...cached)).getIntentPredicateResult(node, 60);
    it("does not match an Enum str_v predicate against cached telemetry 0", async () => {
        await expect(evaluate(predicate(), { key: "mode", value: 0 })).resolves.toBe(false);
        await expect(evaluate(predicate(), { key: "mode", value: "0" })).resolves.toBe(false);
    });
    it("matches an Enum str_v predicate against the same label", async () => {
        await expect(evaluate(predicate(), { key: "mode", value: "AUTO" })).resolves.toBe(true);
        await expect(evaluate(predicate(), { key: "mode", value: "MANUAL" })).resolves.toBe(false);
        await expect(evaluate(predicate({ operation: "!=" }), { key: "mode", value: "MANUAL" })).resolves.toBe(true);
    });
    it("matches an Enum str_v numeric code against numeric and numeric-string telemetry", async () => {
        await expect(evaluate(predicate({ str_v: "2" }), { key: "mode", value: 2 })).resolves.toBe(true);
        await expect(evaluate(predicate({ str_v: "2" }), { key: "mode", value: "2" })).resolves.toBe(true);
        await expect(evaluate(predicate({ str_v: "2" }), { key: "mode", value: 3 })).resolves.toBe(false);
    });
    it("matches an Enum dbl_v code (mobile writes numeric text to dbl_v)", async () => {
        await expect(evaluate(predicate({ str_v: null, dbl_v: 1 }), { key: "mode", value: "1" })).resolves.toBe(true);
        await expect(evaluate(predicate({ str_v: null, dbl_v: 1 }), { key: "mode", value: 0 })).resolves.toBe(false);
    });
    it("does not read the string 'false' as true for a Bool bool_v predicate (Boolean('false') regression)", async () => {
        const boolTrue = predicate({ function: fn("Bool"), str_v: null, bool_v: true });
        await expect(evaluate(boolTrue, { key: "mode", value: "false" })).resolves.toBe(false);
        await expect(evaluate(boolTrue, { key: "mode", value: "off" })).resolves.toBe(false);
        await expect(evaluate(boolTrue, { key: "mode", value: "true" })).resolves.toBe(true);
        await expect(evaluate(boolTrue, { key: "mode", value: 1 })).resolves.toBe(true);
        await expect(evaluate(Object.assign(Object.assign({}, boolTrue), { operation: "!=" }), { key: "mode", value: "false" })).resolves.toBe(true);
    });
    it("matches a Button bool_v predicate against numeric telemetry 1", async () => {
        const button = predicate({ function: fn("Button"), str_v: null, bool_v: true });
        await expect(evaluate(button, { key: "mode", value: 1 })).resolves.toBe(true);
        await expect(evaluate(button, { key: "mode", value: 0 })).resolves.toBe(false);
    });
    it("compares a Value dbl_v predicate numerically with every ordering operator", async () => {
        const value = (operation) => predicate({ function: fn("Value"), str_v: null, dbl_v: 10, operation });
        await expect(evaluate(value(">"), { key: "mode", value: "25.5" })).resolves.toBe(true);
        await expect(evaluate(value("<"), { key: "mode", value: 9 })).resolves.toBe(true);
        await expect(evaluate(value(">="), { key: "mode", value: 10 })).resolves.toBe(true);
        await expect(evaluate(value("<="), { key: "mode", value: 11 })).resolves.toBe(false);
        await expect(evaluate(value("="), { key: "mode", value: null })).resolves.toBe(false);
    });
    it("breaks a multi-column tie by function data_type (rows saved with coerced bool_v=false / dbl_v=0)", async () => {
        const legacyValue = predicate({ function: fn("Value"), bool_v: false, dbl_v: 25, str_v: null });
        await expect(evaluate(legacyValue, { key: "mode", value: 25 })).resolves.toBe(true);
        await expect(evaluate(legacyValue, { key: "mode", value: 0 })).resolves.toBe(false);
        const legacyEnum = predicate({ function: fn("Enum"), bool_v: false, dbl_v: 0, str_v: "AUTO" });
        await expect(evaluate(legacyEnum, { key: "mode", value: "AUTO" })).resolves.toBe(true);
        await expect(evaluate(legacyEnum, { key: "mode", value: 0 })).resolves.toBe(false);
        const legacyBool = predicate({ function: fn("Bool"), bool_v: true, dbl_v: 0, str_v: null });
        await expect(evaluate(legacyBool, { key: "mode", value: 1 })).resolves.toBe(true);
    });
    it("reads the telemetry of the predicate's own device and key", async () => {
        const service = new deviceIntents_1.DeviceIntentService([], [
            { device_id: "dev-2", latest_data: [{ key: "mode", ts: Date.now(), value: "AUTO" }] },
            { device_id: DEVICE_ID, latest_data: [{ key: "other", ts: Date.now(), value: "AUTO" }] },
        ]);
        await expect(service.getIntentPredicateResult(predicate(), 60)).resolves.toBe(false);
    });
    it("keeps the cache-miss and missing-function guards", async () => {
        await expect(new deviceIntents_1.DeviceIntentService([], []).getIntentPredicateResult(predicate(), 60)).resolves.toBe(false);
        await expect(evaluate(predicate(), { key: "other", value: "AUTO" })).resolves.toBe(false);
        await expect(evaluate(predicate({ function: undefined }), { key: "mode", value: "AUTO" })).resolves.toBe(false);
    });
});
describe("DeviceIntentService.processDeviceIntents", () => {
    const TRIGGER = { key: "trigger", value: 1 };
    const intentWith = (deviceActions, conditionPredicate) => ({
        id: "intent-1",
        label: "Mode switch",
        enable: true,
        type: "OFFLINE",
        connecter: "AND",
        interval_windown: 60,
        conditions: [
            {
                id: "cond-1",
                type: "SINGLE",
                connecter: "AND",
                conditions: null,
                predicate: conditionPredicate !== null && conditionPredicate !== void 0 ? conditionPredicate : predicate({ function: fn("Value"), identifier: "trigger", operation: "=", str_v: null, dbl_v: 1 }),
            },
        ],
        device_actions: deviceActions,
        schedule_plan_actions: [{ id: "plan-1", schedule_id: "sched-1", enable: true }],
    });
    const run = async (deviceActions, cached = [TRIGGER], conditionPredicate) => {
        const service = new deviceIntents_1.DeviceIntentService([intentWith(deviceActions, conditionPredicate)], latestData(...cached));
        return service.processDeviceIntents();
    };
    it("emits an Enum str_v action as the number it spells ({str_v:'2'} -> 2)", async () => {
        const [result] = await run([action({ str_v: "2", bool_v: null, dbl_v: null })], [TRIGGER, { key: "mode", value: 0 }]);
        expect(result.device_actions).toEqual([{ device_id: DEVICE_ID, key: "mode", value: 2 }]);
    });
    it("emits the dbl_v setpoint of a Value action stored with a coerced bool_v=false", async () => {
        const [result] = await run([
            action({ function: fn("Value", "set_ec"), bool_v: false, dbl_v: 12, str_v: null }),
        ]);
        expect(result.device_actions).toEqual([{ device_id: DEVICE_ID, key: "set_ec", value: 12 }]);
    });
    it("emits a Button bool_v action as a boolean and a text Enum label as text", async () => {
        const [result] = await run([
            action({ function: fn("Button", "start"), bool_v: true }),
            action({ id: "action-2", function: fn("Enum", "mode"), str_v: "Auto EC/PH" }),
        ]);
        expect(result.device_actions).toEqual([
            { device_id: DEVICE_ID, key: "start", value: true },
            { device_id: DEVICE_ID, key: "mode", value: "Auto EC/PH" },
        ]);
    });
    it("does not emit an action that carries no value, and keeps the others", async () => {
        const [result] = await run([
            action({ function: fn("Raw", "raw"), bool_v: null, dbl_v: null, str_v: null }),
            action({ id: "action-2", function: fn("Enum", "mode"), str_v: "1" }),
        ]);
        expect(result.device_actions).toEqual([{ device_id: DEVICE_ID, key: "mode", value: 1 }]);
    });
    it("emits nothing for an intent whose only action has no value, but still reports the intent", async () => {
        const [result] = await run([action({ bool_v: null, dbl_v: null, str_v: "   " })]);
        expect(result).toEqual({
            id: "intent-1",
            schedule_plan_actions: [{ id: "plan-1", schedule_id: "sched-1", enable: true }],
            device_actions: [],
        });
    });
    it("skips an action the device already reports, comparing with the value rule", async () => {
        const [skipEnum] = await run([action({ str_v: "2" })], [TRIGGER, { key: "mode", value: "2" }]);
        expect(skipEnum.device_actions).toEqual([]);
        const [skipBool] = await run([action({ function: fn("Button", "start"), bool_v: true })], [TRIGGER, { key: "start", value: 1 }]);
        expect(skipBool.device_actions).toEqual([]);
        const [sendEnum] = await run([action({ str_v: "2" })], [TRIGGER, { key: "mode", value: 0 }]);
        expect(sendEnum.device_actions).toEqual([{ device_id: DEVICE_ID, key: "mode", value: 2 }]);
        const [sendUnknown] = await run([action({ str_v: "2" })], [TRIGGER]);
        expect(sendUnknown.device_actions).toEqual([{ device_id: DEVICE_ID, key: "mode", value: 2 }]);
    });
    it("does not fire an intent whose Enum str_v condition meets telemetry 0", async () => {
        const enumCondition = predicate({ identifier: "mode", str_v: "AUTO" });
        await expect(run([action({ str_v: "2" })], [{ key: "mode", value: 0 }], enumCondition)).resolves.toEqual([]);
        await expect(run([action({ str_v: "2" })], [{ key: "mode", value: "AUTO" }], enumCondition)).resolves.toHaveLength(1);
    });
    it("ignores disabled and ONLINE intents", async () => {
        const disabled = Object.assign(Object.assign({}, intentWith([action({ str_v: "2" })])), { enable: false });
        const online = Object.assign(Object.assign({}, intentWith([action({ str_v: "2" })])), { type: "ONLINE" });
        await expect(new deviceIntents_1.DeviceIntentService([disabled, online], latestData(TRIGGER)).processDeviceIntents()).resolves.toEqual([]);
    });
});

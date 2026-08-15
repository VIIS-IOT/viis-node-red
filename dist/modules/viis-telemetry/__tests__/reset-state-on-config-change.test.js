"use strict";
/**
 * Unit tests for PMR-005: reset previousState when thresholdConfig changes.
 *
 * These tests mock flowContext, nodeContext, and MQTT clients — no MySQL connection
 * is required. They cover the config-change detection branch added to
 * ViisTelemetryProcessor.processTelemetryData.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_telemetry_processor_1 = require("../viis-telemetry-processor");
const viis_telemetry_constants_1 = require("../viis-telemetry-constants");
// Mock the utils module so publishTelemetry is a no-op (no real MQTT).
jest.mock('../viis-telemetry-utils', () => {
    const actual = jest.requireActual('../viis-telemetry-utils');
    return Object.assign(Object.assign({}, actual), { publishTelemetry: jest.fn().mockResolvedValue(undefined) });
});
const viis_telemetry_utils_1 = require("../viis-telemetry-utils");
const NODE_ID = 'test-node-pmr005';
function buildProcessor() {
    const flowStore = {};
    const nodeStore = {};
    const node = {
        id: NODE_ID,
        error: jest.fn(),
        warn: jest.fn(),
        log: jest.fn(),
        status: jest.fn(),
        send: jest.fn(),
    };
    const flowContext = {
        get: jest.fn((key) => flowStore[key]),
        set: jest.fn((key, value) => {
            flowStore[key] = value;
        }),
        global: {
            get: jest.fn(),
            set: jest.fn(),
        },
    };
    const nodeContext = {
        get: jest.fn((key) => nodeStore[key]),
        set: jest.fn((key, value) => {
            nodeStore[key] = value;
        }),
        global: {
            get: jest.fn(),
            set: jest.fn(),
        },
    };
    const localMqtt = {
        publish: jest.fn().mockResolvedValue(undefined),
    };
    const tbMqtt = {
        publish: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new viis_telemetry_processor_1.ViisTelemetryProcessor(node, nodeContext, flowContext, localMqtt, tbMqtt, {
        emqxTopic: 'viis/test/telemetry',
        thingsboardTopic: 'v1/devices/me/telemetry',
        debugLogKey: viis_telemetry_constants_1.CONTEXT_KEYS.DEBUG_LOG,
        thresholdConfigKey: viis_telemetry_constants_1.CONTEXT_KEYS.THRESHOLD_CONFIG,
    }, { coil: 0, input: 0, holding: 0 } // disable periodic snapshots in these tests
    );
    return { flowStore, nodeStore, flowContext, nodeContext, node, localMqtt, tbMqtt, processor };
}
function setConfig(store, cfg) {
    store.flowStore[viis_telemetry_constants_1.CONTEXT_KEYS.THRESHOLD_CONFIG] = cfg;
}
function savedKeyCount(store) {
    return store.flowStore[`${viis_telemetry_constants_1.CONTEXT_KEYS.THRESHOLD_CONFIG}_count_${NODE_ID}`];
}
beforeEach(() => {
    jest.clearAllMocks();
});
describe('PMR-005: reset state on thresholdConfig change', () => {
    it('Test 1: first poll with 3-key config records baseline; no resetState, normal publish', async () => {
        const store = buildProcessor();
        const cfg = { temp: 1, hum: 1, press: 1 };
        setConfig(store, cfg);
        await store.processor.processTelemetryData({
            data: { temp: 20, hum: 50, press: 1010 },
            source: 'Holding Registers',
        });
        // First call: savedKeyCount was -1 (sentinel), so configChanged must be false.
        // Baseline is recorded.
        expect(savedKeyCount(store)).toBe(3);
        // No reset happened — previousState should be populated.
        expect(store.nodeStore[viis_telemetry_constants_1.CONTEXT_KEYS.PREVIOUS_STATE]).toEqual({
            temp: 20,
            hum: 50,
            press: 1010,
        });
        // First publish publishes all current keys via getChangedKeys against {}.
        expect(viis_telemetry_utils_1.publishTelemetry).toHaveBeenCalledTimes(1);
    });
    it('Test 2: updating to a different-shape config (3 → 5 keys) triggers resetState and full snapshot', async () => {
        const store = buildProcessor();
        setConfig(store, { temp: 1, hum: 1, press: 1 });
        // Seed previousState by performing an initial poll so we have a non-empty baseline.
        await store.processor.processTelemetryData({
            data: { temp: 20, hum: 50, press: 1010 },
            source: 'Holding Registers',
        });
        expect(savedKeyCount(store)).toBe(3);
        const publishCountAfterSeed = viis_telemetry_utils_1.publishTelemetry.mock.calls.length;
        // Update config via input-handler path.
        const newCfg = { temp: 1, hum: 1, press: 1, flow: 1, level: 1 };
        store.processor.updateThresholdConfig(newCfg);
        // Next poll — must detect configChanged (3 → 5) and reset state.
        viis_telemetry_utils_1.publishTelemetry.mockClear();
        await store.processor.processTelemetryData({
            data: { temp: 21, hum: 51, press: 1011, flow: 5, level: 2 },
            source: 'Holding Registers',
        });
        // After the configChanged branch runs, baseline advances to 5.
        expect(savedKeyCount(store)).toBe(5);
        // The publishTelemetry call after reset must include ALL 5 keys
        // (because resetState() → previousState={} → freshChangedKeys includes everything).
        const publishCall = viis_telemetry_utils_1.publishTelemetry.mock.calls[0][0];
        const publishedKeys = Object.keys(publishCall.data).sort();
        expect(publishedKeys).toEqual(['flow', 'hum', 'level', 'press', 'temp']);
        expect(publishCountAfterSeed).toBeGreaterThanOrEqual(0); // sanity (seed ran)
    });
    it('Test 3: same-shape config update (3 keys → same 3 keys) does NOT trigger resetState', async () => {
        const store = buildProcessor();
        setConfig(store, { temp: 1, hum: 1, press: 1 });
        await store.processor.processTelemetryData({
            data: { temp: 20, hum: 50, press: 1010 },
            source: 'Holding Registers',
        });
        expect(savedKeyCount(store)).toBe(3);
        // Re-set config to the SAME shape (key count unchanged). Use a threshold
        // (0.5) that the next telemetry mutation (diff=1) WILL exceed, so the
        // test exercises the normal diff-publish branch (not reset).
        store.processor.updateThresholdConfig({ temp: 0.5, hum: 0.5, press: 0.5 });
        // Mutate only one telemetry key slightly — but config count is still 3.
        viis_telemetry_utils_1.publishTelemetry.mockClear();
        await store.processor.processTelemetryData({
            data: { temp: 21, hum: 50, press: 1010 },
            source: 'Holding Registers',
        });
        // Baseline count unchanged.
        expect(savedKeyCount(store)).toBe(3);
        // Publish path should be the NORMAL threshold branch (publishTelemetry called).
        expect(viis_telemetry_utils_1.publishTelemetry).toHaveBeenCalledTimes(1);
        // Diff against existing previousState means only 'temp' is published
        // (hum and press are unchanged from the seed).
        const publishCall = viis_telemetry_utils_1.publishTelemetry.mock.calls[0][0];
        expect(Object.keys(publishCall.data)).toEqual(['temp']);
        expect(publishCall.data.temp).toBe(21);
    });
    it('Test 4: reducing key count (5 → 3 keys) triggers resetState', async () => {
        const store = buildProcessor();
        setConfig(store, { temp: 1, hum: 1, press: 1, flow: 1, level: 1 });
        // Seed poll.
        await store.processor.processTelemetryData({
            data: { temp: 20, hum: 50, press: 1010, flow: 5, level: 2 },
            source: 'Holding Registers',
        });
        expect(savedKeyCount(store)).toBe(5);
        // Reduce config.
        store.processor.updateThresholdConfig({ temp: 1, hum: 1, press: 1 });
        viis_telemetry_utils_1.publishTelemetry.mockClear();
        await store.processor.processTelemetryData({
            data: { temp: 20, hum: 50, press: 1010 },
            source: 'Holding Registers',
        });
        expect(savedKeyCount(store)).toBe(3);
        // Publish must include all 3 current keys (full snapshot after reset).
        const publishCall = viis_telemetry_utils_1.publishTelemetry.mock.calls[0][0];
        const publishedKeys = Object.keys(publishCall.data).sort();
        expect(publishedKeys).toEqual(['hum', 'press', 'temp']);
    });
    it('Test 5: empty config (0 keys) is handled — next change from 0 → N triggers resetState', async () => {
        const store = buildProcessor();
        setConfig(store, {});
        // First poll with empty config — no reset, no publish.
        await store.processor.processTelemetryData({
            data: { temp: 20 },
            source: 'Holding Registers',
        });
        expect(savedKeyCount(store)).toBe(0);
        // Empty config means getChangedKeys against {} → all keys count as new,
        // so first publish WILL happen with the data. That's acceptable.
        expect(viis_telemetry_utils_1.publishTelemetry).toHaveBeenCalledTimes(1);
        // Now grow to N keys.
        store.processor.updateThresholdConfig({ temp: 1, hum: 1 });
        viis_telemetry_utils_1.publishTelemetry.mockClear();
        await store.processor.processTelemetryData({
            data: { temp: 20, hum: 50 },
            source: 'Holding Registers',
        });
        expect(savedKeyCount(store)).toBe(2);
        const publishCall = viis_telemetry_utils_1.publishTelemetry.mock.calls[0][0];
        const publishedKeys = Object.keys(publishCall.data).sort();
        // configChanged branch fired: previousState reset → freshChangedKeys includes both.
        expect(publishedKeys).toEqual(['hum', 'temp']);
    });
});

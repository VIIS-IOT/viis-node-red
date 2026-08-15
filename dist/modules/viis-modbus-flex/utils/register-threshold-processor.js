"use strict";
/**
 * Register Threshold Processor
 *
 * Pure-function module that mirrors the state-machine logic of the
 * "Process Holding Threshold" function node embedded in
 * services/flows/standard_flows_rtu.json.
 *
 * Extracted so the algorithm is unit-testable from TypeScript and is
 * reusable for symmetric flow function nodes (Detect Coils Changes,
 * Detect Input Changes, future flow-RTU function nodes).
 *
 * IMPORTANT: this module has NO Node-RED imports. It takes a
 * `ThresholdProcessorInput` POJO and returns a `ThresholdProcessorResult`
 * discriminated union — nothing else. The caller (function node code,
 * other modules, tests) owns all side-effects (global context, status
 * indicators, downstream messages).
 *
 * PMR-007.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.processRegisterThreshold = processRegisterThreshold;
const DEFAULT_EPSILON = 1e-9;
/**
 * Compute the scaled value for a numeric register reading.
 * Mirrors the legacy hardcoded scaling rules from the flow JSON
 * (keysToDivideBy1000/100/10). When `key` is binary, returns
 * `Boolean(value)`. NaN inputs are preserved as NaN.
 */
function scaleValue(key, value, scalingDividers, binaryKeys) {
    // Binary keys are stored as boolean — comparison uses !== not delta.
    if (binaryKeys && binaryKeys.includes(key)) {
        return Boolean(value);
    }
    if (scalingDividers) {
        if (scalingDividers.divide1000 && scalingDividers.divide1000.includes(key)) {
            return value / 1000;
        }
        if (scalingDividers.divide100 && scalingDividers.divide100.includes(key)) {
            return value / 100;
        }
        if (scalingDividers.divide10 && scalingDividers.divide10.includes(key)) {
            return value / 10;
        }
    }
    return value;
}
/**
 * Pure state-machine for Process Holding Threshold.
 *
 * Behaviour summary:
 * 1. If `payload` is not an array → `{ kind: 'invalid_payload', changedKeys: {} }`.
 * 2. Apply scaling/binary conversion per config; merge into a cloned `currentState`.
 * 3. If `rangeIndex < ranges.length - 1` → `{ kind: 'continue', ... }` carrying the
 *    accumulator forward.
 * 4. Else → compute `changedKeys` by comparing each entry in the accumulator to
 *    `previousState[key]`. `oldValue` undefined/null always publishes (first frame).
 *    Returns `{ kind: 'publish', changedKeys, updatedAccumulator: {}, finalState: {...} }`.
 *
 * The function clones `currentState` on entry so the caller can keep using its own
 * reference without aliasing side-effects.
 */
function processRegisterThreshold(input) {
    const epsilon = input.epsilon !== undefined && Number.isFinite(input.epsilon)
        ? input.epsilon
        : DEFAULT_EPSILON;
    // 1. Validate payload
    if (!Array.isArray(input.payload)) {
        return { kind: 'invalid_payload', changedKeys: {} };
    }
    // 2. Clone currentState to avoid mutating the caller's reference.
    const nextState = Object.assign({}, input.currentState);
    input.payload.forEach((value, index) => {
        const actualAddr = input.startAddr + index;
        const key = input.addrToKey[actualAddr];
        if (key !== undefined && typeof value === 'number') {
            nextState[key] = scaleValue(key, value, input.scalingDividers, input.binaryKeys);
        }
    });
    // 3. Multi-range continuation
    if (input.rangeIndex < input.ranges.length - 1) {
        const nextRange = input.ranges[input.rangeIndex + 1];
        return {
            kind: 'continue',
            next: {
                payload: null,
                rangeIndex: input.rangeIndex + 1,
                startAddr: nextRange.start,
            },
            updatedAccumulator: nextState,
        };
    }
    // 4. All ranges complete — detect changes
    const changedKeys = {};
    for (const key of Object.keys(nextState)) {
        const oldValue = input.previousState[key];
        const newValue = nextState[key];
        const threshold = input.thresholds[key] !== undefined ? Number(input.thresholds[key]) : 0;
        // First frame — always publish.
        if (oldValue === undefined || oldValue === null) {
            changedKeys[key] = newValue;
            continue;
        }
        // Skip NaN — invalid comparisons.
        if (typeof newValue === 'number' && Number.isNaN(newValue)) {
            continue;
        }
        if (typeof oldValue === 'number' && Number.isNaN(oldValue)) {
            continue;
        }
        // Numeric comparison with threshold + epsilon.
        if (typeof newValue === 'number' && typeof oldValue === 'number') {
            const delta = Math.abs(newValue - oldValue);
            if (delta > threshold + epsilon) {
                changedKeys[key] = newValue;
            }
            continue;
        }
        // Non-numeric (boolean or mixed) — publish on any change.
        if (newValue !== oldValue) {
            changedKeys[key] = newValue;
        }
    }
    return {
        kind: 'publish',
        changedKeys,
        updatedAccumulator: {},
        finalState: Object.assign({}, nextState),
    };
}

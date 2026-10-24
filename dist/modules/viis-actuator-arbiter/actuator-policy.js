"use strict";
/**
 * Which actuator coils the arbiter owns, from the `actuatorPolicy` section of device1.json:
 *
 *   "actuatorPolicy": { "valve_1": "managed", "valve_2": { "mode": "hold", "manualLeaseS": 60 } }
 *
 * env-loader exposes it as one JSON env var `ACTUATOR_POLICY` (global `actuator_policy`), so the
 * raw value is either that JSON string or the object itself.
 *
 * - `managed`: the arbiter reconciles the coil; with no live claim it is driven OFF.
 * - `hold`: arbitrated while claims exist; with no live claim the arbiter writes nothing.
 * - `unmanaged` (default, every key not listed): today's direct writes, the arbiter never touches it.
 *
 * Only fc=5 coil keys present in modbusMappings are accepted; anything else is ignored with a warning.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.coilKeysFromMappings = coilKeysFromMappings;
exports.loadActuatorPolicy = loadActuatorPolicy;
const ARBITRATED_MODES = new Set(['managed', 'hold']);
function parseObject(raw, label, warn) {
    if (raw === undefined || raw === null || raw === '') {
        return {};
    }
    let value = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        }
        catch (error) {
            warn(`[actuator-policy] ${label} is not valid JSON: ${error.message}`);
            return {};
        }
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        warn(`[actuator-policy] ${label} must be an object`);
        return {};
    }
    return value;
}
function toKeyPolicy(entry) {
    const mode = typeof entry === 'string' ? entry : entry === null || entry === void 0 ? void 0 : entry.mode;
    if (typeof mode !== 'string' || !ARBITRATED_MODES.has(mode)) {
        return null;
    }
    const lease = typeof entry === 'object' ? entry.manualLeaseS : undefined;
    const manualLeaseS = typeof lease === 'number' && Number.isFinite(lease) && lease > 0 ? lease : undefined;
    return { mode: mode, manualLeaseS };
}
/** Coil keys of every board in a modbusMappings object (or its JSON string): `{ board1: { coils: { key: addr } } }`. */
function coilKeysFromMappings(raw) {
    const mappings = parseObject(raw, 'modbusMappings', () => undefined);
    const keys = [];
    for (const board of Object.values(mappings)) {
        const coils = board === null || board === void 0 ? void 0 : board.coils;
        if (coils && typeof coils === 'object' && !Array.isArray(coils)) {
            keys.push(...Object.keys(coils));
        }
    }
    return keys;
}
function loadActuatorPolicy(raw, options) {
    var _a;
    const warn = (_a = options.warn) !== null && _a !== void 0 ? _a : ((message) => console.warn(message));
    const coilKeys = new Set(options.coilKeys);
    const policies = new Map();
    for (const [key, entry] of Object.entries(parseObject(raw, 'ACTUATOR_POLICY', warn))) {
        if (!coilKeys.has(key)) {
            warn(`[actuator-policy] ${key} ignored: not an fc=5 coil in modbusMappings`);
            continue;
        }
        const policy = toKeyPolicy(entry);
        if (!policy) {
            warn(`[actuator-policy] ${key} ignored: mode must be "managed" or "hold"`);
            continue;
        }
        policies.set(key, policy);
    }
    return {
        mode: (key) => { var _a, _b; return (_b = (_a = policies.get(key)) === null || _a === void 0 ? void 0 : _a.mode) !== null && _b !== void 0 ? _b : 'unmanaged'; },
        manualLeaseS: (key) => { var _a, _b; return (_b = (_a = policies.get(key)) === null || _a === void 0 ? void 0 : _a.manualLeaseS) !== null && _b !== void 0 ? _b : options.manualLeaseS; },
        managedKeys: () => Array.from(policies.keys()),
    };
}

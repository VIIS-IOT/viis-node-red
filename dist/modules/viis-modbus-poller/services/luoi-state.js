"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LUOI_UNKNOWN = exports.LUOI_DAI = exports.LUOI_THU = void 0;
exports.luoiKeysFromCoils = luoiKeysFromCoils;
exports.deriveLuoiStates = deriveLuoiStates;
/**
 * Curtain (lưới) state from its motor coil pair, published as the profile Enum `luoi_N`
 * (ADR-033 wire values): 0 = Thu, 1 = Dải, 2 = N/A.
 *
 * The coils drive the motor, so both off means the motor stopped and the curtain stays where it went:
 * keep the last known direction. With no history (first read after a fresh start) or both on, report N/A.
 */
exports.LUOI_THU = 0;
exports.LUOI_DAI = 1;
exports.LUOI_UNKNOWN = 2;
const LUOI_COIL_PATTERN = /^(luoi_\d+)_(thu|dai)$/;
function isOn(value) {
    return value === true || value === 1;
}
/** `luoi_N` keys whose `_thu` and `_dai` coils are both mapped. */
function luoiKeysFromCoils(coilKeys) {
    var _a;
    const halves = new Map();
    for (const key of coilKeys) {
        const match = LUOI_COIL_PATTERN.exec(key);
        if (!match)
            continue;
        const seen = (_a = halves.get(match[1])) !== null && _a !== void 0 ? _a : new Set();
        seen.add(match[2]);
        halves.set(match[1], seen);
    }
    return Array.from(halves.entries())
        .filter(([, seen]) => seen.has("thu") && seen.has("dai"))
        .map(([luoiKey]) => luoiKey)
        .sort();
}
function deriveLuoiStates(luoiKeys, coilValues, lastStates) {
    const states = {};
    for (const luoiKey of luoiKeys) {
        const thu = coilValues[`${luoiKey}_thu`];
        const dai = coilValues[`${luoiKey}_dai`];
        if (thu === undefined || dai === undefined)
            continue;
        if (isOn(thu) && !isOn(dai)) {
            states[luoiKey] = exports.LUOI_THU;
        }
        else if (isOn(dai) && !isOn(thu)) {
            states[luoiKey] = exports.LUOI_DAI;
        }
        else if (!isOn(thu) && !isOn(dai)) {
            const last = lastStates[luoiKey];
            states[luoiKey] = last === exports.LUOI_THU || last === exports.LUOI_DAI ? last : exports.LUOI_UNKNOWN;
        }
        else {
            states[luoiKey] = exports.LUOI_UNKNOWN;
        }
    }
    return states;
}

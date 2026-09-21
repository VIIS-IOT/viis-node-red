"use strict";
/** Editor + Node-RED deploy rules for waterHammerDelay. Runtime still defaults missing to 7s. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWaterHammerDelayEditorValid = isWaterHammerDelayEditorValid;
exports.isNodeRedPropertyDeployable = isNodeRedPropertyDeployable;
exports.legacyWaterHammerDelayValidate = legacyWaterHammerDelayValidate;
function isWaterHammerDelayEditorValid(v) {
    if (v === undefined || v === null || String(v).trim() === '') {
        return true;
    }
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
}
/** Node-RED 4: required only rejects "". validate() then runs on the stored property. */
function isNodeRedPropertyDeployable(value, def) {
    let valid = true;
    if (def.required) {
        valid = value !== '';
    }
    if (valid && typeof def.validate === 'function') {
        valid = def.validate(value);
    }
    return valid;
}
/** Broken editor rule that blocked Deploy on existing nodes without the new field. */
function legacyWaterHammerDelayValidate(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
}

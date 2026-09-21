/** Editor + Node-RED deploy rules for waterHammerDelay. Runtime still defaults missing to 7s. */

export function isWaterHammerDelayEditorValid(v: unknown): boolean {
    if (v === undefined || v === null || String(v).trim() === '') {
        return true;
    }
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
}

/** Node-RED 4: required only rejects "". validate() then runs on the stored property. */
export function isNodeRedPropertyDeployable(
    value: unknown,
    def: { required?: boolean; validate?: (v: unknown) => boolean },
): boolean {
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
export function legacyWaterHammerDelayValidate(v: unknown): boolean {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
}

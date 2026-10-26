"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseArbiterMode = parseArbiterMode;
exports.getArbiter = getArbiter;
exports.registerArbiter = registerArbiter;
exports.unregisterArbiter = unregisterArbiter;
let current = null;
/** `ARBITER_MODE` value → mode; anything unknown (or missing) is `off`. */
function parseArbiterMode(raw) {
    const value = String(raw !== null && raw !== void 0 ? raw : '').trim().toLowerCase();
    return value === 'observe' || value === 'enforce' ? value : 'off';
}
function getArbiter() {
    return current;
}
/** The latest deployed node wins (a redeploy starts the new node before the old one closed). */
function registerArbiter(api) {
    current = api;
}
/** Forgets `api` only if it is still the registered one. */
function unregisterArbiter(api) {
    if (current === api) {
        current = null;
    }
}

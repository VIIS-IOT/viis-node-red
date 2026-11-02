"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LARGE_CHANGE_FACTOR = void 0;
exports.detectChangedData = detectChangedData;
/** A change at least this many deadbands wide skips the minimum interval. */
exports.LARGE_CHANGE_FACTOR = 5;
function positiveThreshold(threshold) {
    return Number.isFinite(threshold) && threshold > 0 ? threshold : 0;
}
function hasMetNumericThreshold(currentValue, previousValue, threshold) {
    const delta = Math.abs(currentValue - previousValue);
    return delta > 0 && delta >= threshold;
}
function isHeldBackByInterval(delta, threshold, input) {
    var _a, _b;
    const minInterval = (_a = input.minPublishIntervalMs) !== null && _a !== void 0 ? _a : 0;
    if (minInterval <= 0 || threshold <= 0)
        return false;
    if (delta >= threshold * exports.LARGE_CHANGE_FACTOR)
        return false;
    if (input.lastAnalogPublishAt === undefined)
        return false;
    return ((_b = input.now) !== null && _b !== void 0 ? _b : Date.now()) - input.lastAnalogPublishAt < minInterval;
}
function detectChangedData(input) {
    const changed = {};
    for (const [key, currentValue] of Object.entries(input.current)) {
        const previousValue = input.previous[key];
        if (input.publishFullSnapshot || previousValue === undefined || previousValue === null) {
            changed[key] = currentValue;
            continue;
        }
        if (typeof currentValue === "number" && typeof previousValue === "number") {
            const threshold = positiveThreshold(input.thresholds[key]);
            if (hasMetNumericThreshold(currentValue, previousValue, threshold) &&
                !isHeldBackByInterval(Math.abs(currentValue - previousValue), threshold, input)) {
                changed[key] = currentValue;
            }
            continue;
        }
        if (currentValue !== previousValue) {
            changed[key] = currentValue;
        }
    }
    return changed;
}

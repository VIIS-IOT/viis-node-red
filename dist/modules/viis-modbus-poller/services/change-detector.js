"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectChangedData = detectChangedData;
function hasMetNumericThreshold(currentValue, previousValue, threshold) {
    const safeThreshold = Number.isFinite(threshold) ? threshold : 0;
    return Math.abs(currentValue - previousValue) >= safeThreshold;
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
            if (hasMetNumericThreshold(currentValue, previousValue, input.thresholds[key])) {
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

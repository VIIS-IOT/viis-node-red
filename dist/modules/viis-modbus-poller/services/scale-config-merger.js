"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeScaleConfigs = mergeScaleConfigs;
function scaleConfigKey(config) {
    return `${config.key}:${config.direction}`;
}
function mergeScaleConfigs(globalConfigs, overrideConfigs) {
    const byKey = new Map();
    for (const config of globalConfigs !== null && globalConfigs !== void 0 ? globalConfigs : []) {
        byKey.set(scaleConfigKey(config), config);
    }
    for (const config of overrideConfigs !== null && overrideConfigs !== void 0 ? overrideConfigs : []) {
        byKey.set(scaleConfigKey(config), config);
    }
    return Array.from(byKey.values());
}

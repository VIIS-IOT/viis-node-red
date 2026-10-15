"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readGlobalScaleConfigs = readGlobalScaleConfigs;
/**
 * Scale configs for Modbus writes/reads, resolved the same way as viis-modbus-poller.
 *
 * Nodes keep their own merged list under `scaleConfigs` (GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS), but the
 * device JSON's `scaleConfigs` section reaches the global context through env-loader as the
 * snake-case JSON string `scale_configs`. Reading only `scaleConfigs` (an empty array when no node
 * sets it) made the schedule executor and RPC control write setpoints unscaled. Env-loader entries
 * win over node entries for the same key + direction, as in the poller's config resolver.
 */
const viis_telemetry_constants_1 = require("../modules/viis-telemetry/viis-telemetry-constants");
const ENV_LOADER_KEYS = ["scale_configs", "SCALE_CONFIGS"];
function toConfigList(value) {
    let parsed = value;
    if (typeof value === "string") {
        if (!value.trim())
            return [];
        try {
            parsed = JSON.parse(value);
        }
        catch (_a) {
            return [];
        }
    }
    if (!Array.isArray(parsed))
        return [];
    return parsed.filter((config) => !!config &&
        typeof config.key === "string" &&
        (config.direction === "read" || config.direction === "write") &&
        (config.operation === "multiply" || config.operation === "divide") &&
        Number.isFinite(Number(config.factor)) &&
        Number(config.factor) !== 0);
}
function readGlobalScaleConfigs(globalContext) {
    if (!globalContext)
        return [];
    const byKey = new Map();
    const add = (configs) => {
        for (const config of configs)
            byKey.set(`${config.key}:${config.direction}`, config);
    };
    add(toConfigList(globalContext.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS)));
    for (const key of ENV_LOADER_KEYS) {
        const configs = toConfigList(globalContext.get(key));
        if (configs.length) {
            add(configs);
            break;
        }
    }
    return Array.from(byKey.values());
}

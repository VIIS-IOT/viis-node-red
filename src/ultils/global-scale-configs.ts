/**
 * Scale configs for Modbus writes/reads, resolved the same way as viis-modbus-poller.
 *
 * Nodes keep their own merged list under `scaleConfigs` (GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS), but the
 * device JSON's `scaleConfigs` section reaches the global context through env-loader as the
 * snake-case JSON string `scale_configs`. Reading only `scaleConfigs` (an empty array when no node
 * sets it) made the schedule executor and RPC control write setpoints unscaled. Env-loader entries
 * win over node entries for the same key + direction, as in the poller's config resolver.
 */
import { GLOBAL_CONTEXT_KEYS } from "../modules/viis-telemetry/viis-telemetry-constants";

export interface GlobalScaleConfig {
    key: string;
    operation: "multiply" | "divide";
    factor: number;
    direction: "read" | "write";
}

interface ContextReader {
    get(key: string): unknown;
}

const ENV_LOADER_KEYS = ["scale_configs", "SCALE_CONFIGS"];

function toConfigList(value: unknown): GlobalScaleConfig[] {
    let parsed = value;
    if (typeof value === "string") {
        if (!value.trim()) return [];
        try {
            parsed = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
        (config): config is GlobalScaleConfig =>
            !!config &&
            typeof config.key === "string" &&
            (config.direction === "read" || config.direction === "write") &&
            (config.operation === "multiply" || config.operation === "divide") &&
            Number.isFinite(Number(config.factor)) &&
            Number(config.factor) !== 0,
    );
}

export function readGlobalScaleConfigs(globalContext: ContextReader | undefined | null): GlobalScaleConfig[] {
    if (!globalContext) return [];
    const byKey = new Map<string, GlobalScaleConfig>();
    const add = (configs: GlobalScaleConfig[]) => {
        for (const config of configs) byKey.set(`${config.key}:${config.direction}`, config);
    };
    add(toConfigList(globalContext.get(GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS)));
    for (const key of ENV_LOADER_KEYS) {
        const configs = toConfigList(globalContext.get(key));
        if (configs.length) {
            add(configs);
            break;
        }
    }
    return Array.from(byKey.values());
}

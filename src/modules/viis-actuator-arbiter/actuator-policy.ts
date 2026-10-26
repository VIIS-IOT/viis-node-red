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

export type KeyMode = 'managed' | 'hold' | 'unmanaged';

export interface KeyPolicy {
    mode: KeyMode;
    manualLeaseS?: number;
}

export interface ActuatorPolicy {
    mode(key: string): KeyMode;
    manualLeaseS(key: string): number;
    /** Keys whose mode is `managed` or `hold`, in config order. */
    managedKeys(): string[];
}

export interface ActuatorPolicyOptions {
    /** Lease of a manual claim when the key gives none (ARBITER_MANUAL_LEASE_S). */
    manualLeaseS: number;
    /** fc=5 coil keys from modbusMappings; see coilKeysFromMappings. */
    coilKeys: Iterable<string>;
    warn?: (message: string) => void;
}

const ARBITRATED_MODES: ReadonlySet<string> = new Set(['managed', 'hold']);

function parseObject(raw: unknown, label: string, warn: (message: string) => void): Record<string, unknown> {
    if (raw === undefined || raw === null || raw === '') {
        return {};
    }
    let value = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch (error) {
            warn(`[actuator-policy] ${label} is not valid JSON: ${(error as Error).message}`);
            return {};
        }
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        warn(`[actuator-policy] ${label} must be an object`);
        return {};
    }
    return value as Record<string, unknown>;
}

function toKeyPolicy(entry: unknown): KeyPolicy | null {
    const mode = typeof entry === 'string' ? entry : (entry as { mode?: unknown } | null)?.mode;
    if (typeof mode !== 'string' || !ARBITRATED_MODES.has(mode)) {
        return null;
    }
    const lease = typeof entry === 'object' ? (entry as { manualLeaseS?: unknown }).manualLeaseS : undefined;
    const manualLeaseS = typeof lease === 'number' && Number.isFinite(lease) && lease > 0 ? lease : undefined;
    return { mode: mode as KeyMode, manualLeaseS };
}

/** Coil keys of every board in a modbusMappings object (or its JSON string): `{ board1: { coils: { key: addr } } }`. */
export function coilKeysFromMappings(raw: unknown): string[] {
    const mappings = parseObject(raw, 'modbusMappings', () => undefined);
    const keys: string[] = [];
    for (const board of Object.values(mappings)) {
        const coils = (board as { coils?: unknown } | null)?.coils;
        if (coils && typeof coils === 'object' && !Array.isArray(coils)) {
            keys.push(...Object.keys(coils));
        }
    }
    return keys;
}

export function loadActuatorPolicy(raw: unknown, options: ActuatorPolicyOptions): ActuatorPolicy {
    const warn = options.warn ?? ((message: string) => console.warn(message));
    const coilKeys = new Set(options.coilKeys);
    const policies = new Map<string, KeyPolicy>();

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
        mode: (key) => policies.get(key)?.mode ?? 'unmanaged',
        manualLeaseS: (key) => policies.get(key)?.manualLeaseS ?? options.manualLeaseS,
        managedKeys: () => Array.from(policies.keys()),
    };
}

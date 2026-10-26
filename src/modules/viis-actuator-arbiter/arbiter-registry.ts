/**
 * The one actuator arbiter of this Node-RED process. Kept in this module rather than in Node-RED global
 * context: the `localfilesystem` context store serialises values and strips their methods (the same
 * reason as the event outbox registry and the protection gate bug).
 *
 * `getArbiter()` is null while `ARBITER_MODE` is `off` (the node then registers nothing) or no
 * `viis-actuator-arbiter` node is deployed: every writer keeps today's direct writes.
 */
import type { ActuatorArbiterApi } from './arbiter-api';

export type ArbiterMode = 'off' | 'observe' | 'enforce';

let current: ActuatorArbiterApi | null = null;

/** `ARBITER_MODE` value → mode; anything unknown (or missing) is `off`. */
export function parseArbiterMode(raw: unknown): ArbiterMode {
    const value = String(raw ?? '').trim().toLowerCase();
    return value === 'observe' || value === 'enforce' ? value : 'off';
}

export function getArbiter(): ActuatorArbiterApi | null {
    return current;
}

/** The latest deployed node wins (a redeploy starts the new node before the old one closed). */
export function registerArbiter(api: ActuatorArbiterApi): void {
    current = api;
}

/** Forgets `api` only if it is still the registered one. */
export function unregisterArbiter(api: ActuatorArbiterApi): void {
    if (current === api) {
        current = null;
    }
}

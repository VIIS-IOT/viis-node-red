/**
 * Pure claim bookkeeping of the actuator arbiter (flag `ARBITER_MODE`). Sources do not write an
 * arbitrated coil; they submit an expiring claim for it, and the arbiter drives the coil to the value of
 * the one winning claim:
 *
 *   safety 100 > alarm_action 90 > manual 80 > scenario 60 > schedule 50 > automation 30
 *
 * Ties go to the newest `createdAt` (then to the claim submitted last). Releasing a claim is not an OFF:
 * the next live claim takes over, and only with no live claim does the policy decide (`managed` → OFF,
 * `hold` → write nothing). Keys the policy leaves `unmanaged` are never arbitrated.
 *
 * Times are epoch milliseconds; `expiresAt: null` never expires (safety holds).
 */
import { ActuatorPolicy } from './actuator-policy';

export type ClaimSource = 'safety' | 'alarm_action' | 'manual' | 'scenario' | 'schedule' | 'automation';

export const SOURCE_PRIORITY: Record<ClaimSource, number> = {
    safety: 100,
    alarm_action: 90,
    manual: 80,
    scenario: 60,
    schedule: 50,
    automation: 30,
};

export interface ActuatorClaim {
    key: string;
    value: boolean;
    source: ClaimSource;
    ownerId: string;
    expiresAt: number | null;
    createdAt: number;
}

/** `desired: null` = hold: the arbiter writes nothing for this key. */
export interface Resolution {
    key: string;
    desired: boolean | null;
    winner: ActuatorClaim | null;
}

/**
 * A claim created further ahead than this is dropped on load: the gateway clock jumped back after a
 * restart, and such a claim would otherwise win every tie (and outlive its lease) indefinitely.
 */
export const MAX_FUTURE_SKEW_MS = 60_000;

function isClaimSource(value: unknown): value is ClaimSource {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_PRIORITY, value);
}

function isLive(claim: ActuatorClaim, now: number): boolean {
    return claim.expiresAt === null || claim.expiresAt > now;
}

export class ArbiterCore {
    /** `ownerId \u0000 key` → claim. Map order = submission order, used as the last tie-break. */
    private readonly claims = new Map<string, ActuatorClaim>();

    constructor(private readonly policy: ActuatorPolicy) {}

    private static id(ownerId: string, key: string): string {
        return `${ownerId}\u0000${key}`;
    }

    private arbitrated(key: string): boolean {
        return this.policy.mode(key) !== 'unmanaged';
    }

    /** Adds the claim, replacing the same (ownerId, key). Throws for an unmanaged key or an unknown source. */
    claim(c: ActuatorClaim): void {
        if (!this.arbitrated(c.key)) {
            throw new Error(`[arbiter] ${c.key} is not arbitrated (policy unmanaged)`);
        }
        if (!isClaimSource(c.source)) {
            throw new Error(`[arbiter] unknown claim source ${String(c.source)}`);
        }
        if (typeof c.value !== 'boolean' || !c.ownerId) {
            throw new Error(`[arbiter] invalid claim for ${c.key}`);
        }
        const id = ArbiterCore.id(c.ownerId, c.key);
        this.claims.delete(id);
        this.claims.set(id, { ...c });
    }

    /**
     * Drops the owner's claims (one key, or all its keys). An `ownerId` ending in `*` matches by prefix
     * (`manual:*`). Returns the affected keys, each once.
     */
    release(ownerId: string, key?: string): string[] {
        const prefix = ownerId.endsWith('*') ? ownerId.slice(0, -1) : null;
        const affected = new Set<string>();
        for (const [id, c] of this.claims) {
            const ownerMatches = prefix !== null ? c.ownerId.startsWith(prefix) : c.ownerId === ownerId;
            if (ownerMatches && (key === undefined || c.key === key)) {
                this.claims.delete(id);
                affected.add(c.key);
            }
        }
        return Array.from(affected);
    }

    /** Removes and returns every claim whose lease ended at or before `now`. */
    expire(now: number): ActuatorClaim[] {
        const expired: ActuatorClaim[] = [];
        for (const [id, c] of this.claims) {
            if (!isLive(c, now)) {
                this.claims.delete(id);
                expired.push({ ...c });
            }
        }
        return expired;
    }

    resolve(key: string, now: number): Resolution {
        const mode = this.policy.mode(key);
        if (mode === 'unmanaged') {
            return { key, desired: null, winner: null };
        }
        let winner: ActuatorClaim | null = null;
        for (const c of this.claims.values()) {
            if (c.key !== key || !isLive(c, now)) continue;
            // `>=` on equal priority and createdAt: the claim submitted later wins.
            if (
                winner === null ||
                SOURCE_PRIORITY[c.source] > SOURCE_PRIORITY[winner.source] ||
                (SOURCE_PRIORITY[c.source] === SOURCE_PRIORITY[winner.source] && c.createdAt >= winner.createdAt)
            ) {
                winner = c;
            }
        }
        if (winner) {
            return { key, desired: winner.value, winner: { ...winner } };
        }
        return { key, desired: mode === 'managed' ? false : null, winner: null };
    }

    /**
     * Live claims for `key`, best first: the order `resolve` picks its winner by (priority, then
     * createdAt, then the claim submitted later). `[0]` is the winner, `[1]` the claim that takes over
     * when it ends.
     */
    rankedClaims(key: string, now: number): ActuatorClaim[] {
        const live: { claim: ActuatorClaim; position: number }[] = [];
        let position = 0;
        for (const c of this.claims.values()) {
            if (c.key === key && isLive(c, now)) live.push({ claim: c, position });
            position++;
        }
        live.sort(
            (a, b) =>
                SOURCE_PRIORITY[b.claim.source] - SOURCE_PRIORITY[a.claim.source] ||
                b.claim.createdAt - a.claim.createdAt ||
                b.position - a.position
        );
        return live.map(({ claim }) => ({ ...claim }));
    }

    /** One resolution per managed/hold key, in policy order. */
    resolveAll(now: number): Resolution[] {
        return this.policy.managedKeys().map(key => this.resolve(key, now));
    }

    snapshot(): ActuatorClaim[] {
        return Array.from(this.claims.values(), c => ({ ...c }));
    }

    /**
     * Replaces the claims with persisted ones (gateway restart). Drops claims that already expired, claims
     * created more than MAX_FUTURE_SKEW_MS after `now` (clock jumped back), unknown sources and keys the
     * policy no longer arbitrates.
     */
    load(claims: ActuatorClaim[], now: number): void {
        this.claims.clear();
        const ordered = [...claims].sort((a, b) => a.createdAt - b.createdAt);
        for (const c of ordered) {
            if (!isLive(c, now) || c.createdAt > now + MAX_FUTURE_SKEW_MS) continue;
            if (!this.arbitrated(c.key) || !isClaimSource(c.source)) continue;
            this.claims.set(ArbiterCore.id(c.ownerId, c.key), { ...c });
        }
    }
}

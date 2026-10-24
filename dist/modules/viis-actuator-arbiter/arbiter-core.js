"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArbiterCore = exports.MAX_FUTURE_SKEW_MS = exports.SOURCE_PRIORITY = void 0;
exports.SOURCE_PRIORITY = {
    safety: 100,
    alarm_action: 90,
    manual: 80,
    scenario: 60,
    schedule: 50,
    automation: 30,
};
/**
 * A claim created further ahead than this is dropped on load: the gateway clock jumped back after a
 * restart, and such a claim would otherwise win every tie (and outlive its lease) indefinitely.
 */
exports.MAX_FUTURE_SKEW_MS = 60000;
function isClaimSource(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(exports.SOURCE_PRIORITY, value);
}
function isLive(claim, now) {
    return claim.expiresAt === null || claim.expiresAt > now;
}
class ArbiterCore {
    constructor(policy) {
        this.policy = policy;
        /** `ownerId \u0000 key` → claim. Map order = submission order, used as the last tie-break. */
        this.claims = new Map();
    }
    static id(ownerId, key) {
        return `${ownerId}\u0000${key}`;
    }
    arbitrated(key) {
        return this.policy.mode(key) !== 'unmanaged';
    }
    /** Adds the claim, replacing the same (ownerId, key). Throws for an unmanaged key or an unknown source. */
    claim(c) {
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
        this.claims.set(id, Object.assign({}, c));
    }
    /**
     * Drops the owner's claims (one key, or all its keys). An `ownerId` ending in `*` matches by prefix
     * (`manual:*`). Returns the affected keys, each once.
     */
    release(ownerId, key) {
        const prefix = ownerId.endsWith('*') ? ownerId.slice(0, -1) : null;
        const affected = new Set();
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
    expire(now) {
        const expired = [];
        for (const [id, c] of this.claims) {
            if (!isLive(c, now)) {
                this.claims.delete(id);
                expired.push(Object.assign({}, c));
            }
        }
        return expired;
    }
    resolve(key, now) {
        const mode = this.policy.mode(key);
        if (mode === 'unmanaged') {
            return { key, desired: null, winner: null };
        }
        let winner = null;
        for (const c of this.claims.values()) {
            if (c.key !== key || !isLive(c, now))
                continue;
            // `>=` on equal priority and createdAt: the claim submitted later wins.
            if (winner === null ||
                exports.SOURCE_PRIORITY[c.source] > exports.SOURCE_PRIORITY[winner.source] ||
                (exports.SOURCE_PRIORITY[c.source] === exports.SOURCE_PRIORITY[winner.source] && c.createdAt >= winner.createdAt)) {
                winner = c;
            }
        }
        if (winner) {
            return { key, desired: winner.value, winner: Object.assign({}, winner) };
        }
        return { key, desired: mode === 'managed' ? false : null, winner: null };
    }
    /** One resolution per managed/hold key, in policy order. */
    resolveAll(now) {
        return this.policy.managedKeys().map(key => this.resolve(key, now));
    }
    snapshot() {
        return Array.from(this.claims.values(), c => (Object.assign({}, c)));
    }
    /**
     * Replaces the claims with persisted ones (gateway restart). Drops claims that already expired, claims
     * created more than MAX_FUTURE_SKEW_MS after `now` (clock jumped back), unknown sources and keys the
     * policy no longer arbitrates.
     */
    load(claims, now) {
        this.claims.clear();
        const ordered = [...claims].sort((a, b) => a.createdAt - b.createdAt);
        for (const c of ordered) {
            if (!isLive(c, now) || c.createdAt > now + exports.MAX_FUTURE_SKEW_MS)
                continue;
            if (!this.arbitrated(c.key) || !isClaimSource(c.source))
                continue;
            this.claims.set(ArbiterCore.id(c.ownerId, c.key), Object.assign({}, c));
        }
    }
}
exports.ArbiterCore = ArbiterCore;

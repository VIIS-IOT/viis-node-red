/**
 * One reconcile pass of the actuator arbiter: read each arbitrated coil, compare it with the winning
 * claim (ArbiterCore.resolve), and in `enforce` write only the coils that differ.
 *
 * Write order inside one tick follows the schedule executor (water hammer):
 *
 *   OFF pumps → OFF other → [sleep] → OFF valves → [sleep] → ON valves → ON other → [sleep] → ON pumps
 *
 * Each pause is `waterHammerMs` and only happens when writes really sit on both sides of it: pumps
 * stop before valves close, valves open before pumps start, and an ON never directly follows an OFF.
 *
 * - A key whose read failed is not written (the coil state is unknown); it is listed in `readFailed`.
 * - Never fight an outside OFF. Once the coil was seen ON under the winning claim of a manual, scenario,
 *   schedule or automation source (read ON, or the arbiter's ON write succeeded) and then reads OFF, the
 *   PLC, an HMI or an interlock switched it. One OFF read proves nothing (a stale or glitched read, a tick
 *   racing the write), so the first OFF read writes nothing and keeps the claims; the second OFF read on the
 *   next tick, with no write of that key in between, ends it (`externalOff`): the key's manual ON claims are
 *   released and its scenario/schedule/automation ON claims are suspended until they expire, so nothing
 *   writes ON again. A new claim for the key (a new command) is written normally. `safety` and
 *   `alarm_action` claims are never given up.
 * - An ON write is checked against `allowOn` (device protection) on every tick, not only when the claim was made.
 * - A `hold` key with no live claim resolves to `null` and is neither read nor written.
 * - `observe` reads and reports diffs but never writes.
 *
 * The reconciler does not change the claims; expiring and persisting them is the node's job.
 */
import { ActuatorClaim, ArbiterCore, Resolution, SUSPENDABLE_SOURCES } from './arbiter-core';
import { isPumpKey, isSystemPowerKey, isChannelPowerKey, isValveKey } from '../viis-schedule-executor/schedule-coil-classify';

export interface CoilTarget {
    key: string;
    boardId: string;
    address: number;
    unitId?: number;
}

export type CoilClass = 'pump' | 'valve' | 'other';

export interface ReconcilerDeps {
    /** managed/hold keys only */
    targets: CoilTarget[];
    /** throws on Modbus failure */
    readCoil(t: CoilTarget): Promise<boolean>;
    writeCoil(t: CoilTarget, value: boolean): Promise<void>;
    classify(key: string): CoilClass;
    /** Device protection for an ON write (checked on every tick); absent = always allowed. */
    allowOn?(key: string): { allowed: boolean; reason?: string };
    mode: 'observe' | 'enforce';
    waterHammerMs: number;
    sleep(ms: number): Promise<void>;
    now(): number;
}

export interface TickWrite {
    key: string;
    value: boolean;
    ok: boolean;
    error?: string;
}

export interface TickReport {
    desired: Record<string, boolean | null>;
    /** The winning claim per read key (null = no live claim: the policy default applies); names the owner in diffs. */
    winners: Record<string, { source: string; ownerId: string } | null>;
    actual: Record<string, boolean | undefined>;
    diffs: string[];
    writes: TickWrite[];
    readFailed: string[];
    /** Keys whose coil an outside party switched OFF (two OFF reads after it was seen ON), with what was dropped. */
    externalOff: ExternalOff[];
    /** ON writes held back this tick by device protection. */
    gateBlocked: { key: string; reason: string }[];
}

export interface ExternalOff {
    key: string;
    /** The claim that held the key when the second OFF read came. */
    winner: { source: string; ownerId: string };
    /** Owner ids of the manual ON claims released. */
    released: string[];
    /** Owner ids of the scenario/schedule/automation ON claims suspended until they expire. */
    suspended: string[];
}

/** Consecutive OFF reads (on different ticks) after an ON before an outside party is taken to have switched the coil. */
export const OFF_READS_TO_RELEASE = 2;

/** Sources whose ON claims are judged against OFF reads; safety and alarm_action keep enforcing. */
const WATCHED_SOURCES: ReadonlySet<string> = new Set(['manual', ...SUSPENDABLE_SOURCES]);

/** What the reconciler remembers about the claim that currently wins a key. */
interface KeyWatch {
    /** `ownerId@createdAt`: a re-submitted claim is a new claim and starts the count again. */
    claimId: string;
    /** The coil was read ON, or the arbiter wrote it ON successfully, under this claim. */
    seenOn: boolean;
    /** Consecutive ticks that read the coil OFF since it was seen ON. */
    offReads: number;
}

function claimId(claim: ActuatorClaim): string {
    return `${claim.ownerId}@${claim.createdAt}`;
}

/** Executor coil groups (schedule-coil-classify.ts): pumps and power coils stop first and start last. */
export function classifyActuatorKey(key: string): CoilClass {
    if (isPumpKey(key) || isSystemPowerKey(key) || isChannelPowerKey(key)) return 'pump';
    if (isValveKey(key)) return 'valve';
    return 'other';
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class Reconciler {
    private readonly failures = new Map<string, number>();
    private readonly watch = new Map<string, KeyWatch>();

    constructor(private readonly core: ArbiterCore, private readonly deps: ReconcilerDeps) {}

    consecutiveFailures(key: string): number {
        return this.failures.get(key) ?? 0;
    }

    async tick(): Promise<TickReport> {
        const { deps } = this;
        const now = deps.now();
        const report: TickReport = { desired: {}, winners: {}, actual: {}, diffs: [], writes: [], readFailed: [], externalOff: [], gateBlocked: [] };
        const pending: { target: CoilTarget; value: boolean }[] = [];

        for (const target of deps.targets) {
            let resolution = this.core.resolve(target.key, now);
            if (resolution.desired === null) {
                report.desired[target.key] = null;
                this.watch.delete(target.key);
                continue;
            }

            let actual: boolean;
            try {
                actual = Boolean(await deps.readCoil(target));
            } catch {
                report.desired[target.key] = resolution.desired;
                report.winners[target.key] = resolution.winner
                    ? { source: resolution.winner.source, ownerId: resolution.winner.ownerId }
                    : null;
                report.actual[target.key] = undefined;
                report.readFailed.push(target.key);
                continue;
            }
            report.actual[target.key] = actual;

            const verdict = this.judgeRead(target.key, resolution, actual, now);
            if (typeof verdict === 'object') {
                report.externalOff.push(verdict);
                resolution = this.core.resolve(target.key, now);
            }
            const { desired, winner } = resolution;
            report.desired[target.key] = desired;
            report.winners[target.key] = winner ? { source: winner.source, ownerId: winner.ownerId } : null;
            if (desired === null) continue;
            if (actual === desired) {
                // The coil already shows what the winner wants: whatever failed before is resolved.
                this.failures.delete(target.key);
                continue;
            }
            report.diffs.push(target.key);
            if (verdict === 'hold') continue;
            pending.push({ target, value: desired });
        }

        if (deps.mode === 'enforce' && deps.allowOn) {
            for (let i = pending.length - 1; i >= 0; i--) {
                const { target, value } = pending[i];
                if (!value) continue;
                const gate = deps.allowOn(target.key);
                if (gate.allowed) continue;
                report.gateBlocked.push({ key: target.key, reason: gate.reason ?? 'protection' });
                pending.splice(i, 1);
            }
            report.gateBlocked.reverse();
        }

        if (deps.mode !== 'enforce' || pending.length === 0) {
            return report;
        }

        const group = (value: boolean, cls: CoilClass) =>
            pending.filter(p => p.value === value && deps.classify(p.target.key) === cls);
        // A pause is due before a phase when the phase named in `pauseAfter` wrote in this tick.
        const phases: { items: typeof pending; pauseAfter: 'pumpsOff' | 'anyOff' | 'onBeforePumps' | null }[] = [
            { items: group(false, 'pump'), pauseAfter: null },
            { items: group(false, 'other'), pauseAfter: null },
            { items: group(false, 'valve'), pauseAfter: 'pumpsOff' },
            { items: group(true, 'valve'), pauseAfter: 'anyOff' },
            { items: group(true, 'other'), pauseAfter: 'anyOff' },
            { items: group(true, 'pump'), pauseAfter: 'onBeforePumps' },
        ];

        let pumpsOff = false;
        let anyOff = false;
        let onBeforePumps = false;
        let pausedSinceLastWrite = true;

        for (const phase of phases) {
            if (phase.items.length === 0) continue;
            const due =
                (phase.pauseAfter === 'pumpsOff' && pumpsOff) ||
                // Only before the first ON phase: ON valves and ON other run back to back.
                (phase.pauseAfter === 'anyOff' && anyOff && !onBeforePumps) ||
                (phase.pauseAfter === 'onBeforePumps' && (onBeforePumps || anyOff));
            if (due && !pausedSinceLastWrite) {
                await deps.sleep(deps.waterHammerMs);
                pausedSinceLastWrite = true;
            }
            for (const { target, value } of phase.items) {
                report.writes.push(await this.write(target, value));
                pausedSinceLastWrite = false;
                if (!value) {
                    anyOff = true;
                    if (deps.classify(target.key) === 'pump') pumpsOff = true;
                } else if (deps.classify(target.key) !== 'pump') {
                    onBeforePumps = true;
                }
            }
        }

        return report;
    }

    /**
     * Judges one successful read of `key` against the claim that wins it: `write` = reconcile as usual,
     * `hold` = the coil read OFF once after it was seen ON, so write nothing this tick and keep the claims,
     * an `ExternalOff` = the second OFF read: the claims were released/suspended (the caller resolves again).
     */
    private judgeRead(key: string, resolution: Resolution, actual: boolean, now: number): 'write' | 'hold' | ExternalOff {
        const winner = resolution.winner;
        if (!winner || !winner.value || !WATCHED_SOURCES.has(winner.source) || this.consecutiveFailures(key) > 0) {
            this.watch.delete(key);
            return 'write';
        }
        const id = claimId(winner);
        let state = this.watch.get(key);
        if (!state || state.claimId !== id) {
            state = { claimId: id, seenOn: false, offReads: 0 };
            this.watch.set(key, state);
        }
        if (actual) {
            state.seenOn = true;
            state.offReads = 0;
            return 'write';
        }
        if (!state.seenOn) return 'write';
        state.offReads++;
        if (state.offReads < OFF_READS_TO_RELEASE) return 'hold';

        const event: ExternalOff = { key, winner: { source: winner.source, ownerId: winner.ownerId }, released: [], suspended: [] };
        for (const claim of this.core.rankedClaims(key, now)) {
            if (!claim.value) continue;
            if (claim.source === 'manual') {
                this.core.release(claim.ownerId, key);
                event.released.push(claim.ownerId);
            } else if (SUSPENDABLE_SOURCES.has(claim.source) && this.core.suspend(claim.ownerId, key)) {
                event.suspended.push(claim.ownerId);
            }
        }
        this.watch.delete(key);
        return event;
    }

    private async write(target: CoilTarget, value: boolean): Promise<TickWrite> {
        try {
            await this.deps.writeCoil(target, value);
            this.failures.delete(target.key);
            if (value) {
                // An ON that was written counts as seen ON: a PLC that closes the coil within one tick is
                // then released as device-closed after two OFF reads instead of being written ON again.
                const state = this.watch.get(target.key);
                if (state) {
                    state.seenOn = true;
                    state.offReads = 0;
                }
            }
            return { key: target.key, value, ok: true };
        } catch (error) {
            this.failures.set(target.key, this.consecutiveFailures(target.key) + 1);
            return { key: target.key, value, ok: false, error: errorText(error) };
        }
    }
}

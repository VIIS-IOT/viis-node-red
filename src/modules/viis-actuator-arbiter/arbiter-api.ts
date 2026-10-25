/**
 * The running actuator arbiter (flag `ARBITER_MODE` = `observe` | `enforce`), the object behind
 * getArbiter(). It ties ArbiterCore (claims), the Reconciler (Modbus) and the ClaimStore (MySQL):
 *
 * - `claim()` records the claim, asks for a tick (debounced 200 ms) and answers once that tick has
 *   reconciled the key (at most 15 s): `applied` says whether this claim is the winner, `actual` what the
 *   coil reads (the written value when the tick wrote it). A losing claim stays in the core: the caller
 *   decides whether to keep or withdraw it.
 * - Every `ARBITER_TICK_MS` the arbiter expires leases and reconciles every managed/hold key.
 * - Claims are saved on every change and on stop, and loaded on start (expired / future claims dropped).
 * - A key whose write failed on 3 consecutive ticks raises the gateway state alarm
 *   `actuator_write_failed:<key>` through the event outbox (nothing when the outbox is off); the next
 *   good write clears it.
 * - Every coil write that did not throw is reported through `onCoilWrite` so the node can publish the
 *   value as telemetry: the Modbus poller only publishes changes it polled itself, so an arbiter OFF
 *   (expired or released claim) would otherwise leave the key's telemetry stale until the next poll.
 * - A manual ON lease is a ceiling, not a timer: once the coil was seen ON under the claim and later
 *   reads OFF (the PLC closed it), the claim is released before the tick could write it back. When the
 *   ceiling ends with the coil still ON the arbiter drives it OFF and raises
 *   `manual_runtime_exceeded:<key>`, cleared when the coil reads OFF or another claim takes the key.
 */
import type { EventOutbox } from '../../services/event-outbox/event-outbox';
import { ActuatorPolicy, KeyMode } from './actuator-policy';
import { ActuatorClaim, ArbiterCore, ClaimSource } from './arbiter-core';
import type { ClaimStore } from './arbiter-store';
import { CoilTarget, Reconciler, ReconcilerDeps, TickReport } from './reconciler';

export interface ClaimInput {
    key: string;
    value: boolean;
    source: ClaimSource;
    ownerId: string;
    expiresAt: number | null;
}

export interface ClaimResult {
    applied: boolean;
    actual: boolean | undefined;
    blockedBy?: ClaimSource;
    mode: 'observe' | 'enforce';
}

export interface OwnerInfo {
    source: ClaimSource;
    ownerId: string;
    expiresAt: number | null;
}

/** Winner per key; `next` is the live claim that takes over when the winner ends (null = none). */
export type ArbiterOwners = Record<string, OwnerInfo & { next: OwnerInfo | null }>;

/** A coil value the reconciler wrote (the write did not throw); `ts` is the arbiter clock at the tick. */
export interface CoilWrite {
    key: string;
    value: boolean;
    ts: number;
}

export interface ActuatorArbiterApi {
    /** policy mode managed | hold */
    manages(key: string): boolean;
    /** Policy mode of `key` (`unmanaged` for a key the policy does not list). */
    keyMode(key: string): KeyMode;
    /** The coil the arbiter writes for `key` (board + address); undefined when it does not arbitrate the key. */
    target(key: string): CoilTarget | undefined;
    mode(): 'observe' | 'enforce';
    /** Lease of a new claim from `source` on `key`, in ms (manual: key policy, others: scenario lease). */
    leaseMs(source: ClaimSource, key: string): number;
    /** Resolves after the next tick reconciled this key (debounced tick), at most `claimWaitMs`. */
    claim(input: ClaimInput): Promise<ClaimResult>;
    release(ownerId: string, key?: string): Promise<void>;
    owners(): ArbiterOwners;
}

export type ClaimStoreLike = Pick<ClaimStore, 'ensureTable' | 'load' | 'save'> & { isAvailable?: () => boolean };
export type AlarmOutbox = Pick<EventOutbox, 'raise' | 'clear' | 'activeAlarms'>;

export interface ArbiterOptions {
    policy: ActuatorPolicy;
    mode: 'observe' | 'enforce';
    reconcilerDeps: Omit<ReconcilerDeps, 'mode' | 'now'>;
    /** ARBITER_SCENARIO_LEASE_S: lease of scenario and alarm_action claims. */
    scenarioLeaseS: number;
    store?: ClaimStoreLike | null;
    now?: () => number;
    /** ARBITER_TICK_MS (min 2000). */
    tickMs?: number;
    debounceMs?: number;
    claimWaitMs?: number;
    /** getEventOutbox; null = outbox off, alarms are skipped. */
    outbox?: () => AlarmOutbox | null;
    deviceId?: () => string;
    onOwnersChange?: (owners: ArbiterOwners) => void;
    /** Called once per confirmed write of a tick, in write order (enforce only; observe never writes). */
    onCoilWrite?: (write: CoilWrite) => void;
    onTickReport?: (report: TickReport) => void;
    warn?: (message: string) => void;
    log?: (message: string) => void;
}

export const DEFAULT_TICK_MS = 5000;
export const MIN_TICK_MS = 2000;
export const CLAIM_DEBOUNCE_MS = 200;
export const CLAIM_MAX_WAIT_MS = 15_000;
/** Consecutive failed write ticks before `actuator_write_failed:<key>` is raised. */
export const WRITE_FAILED_ALARM_TICKS = 3;
const WRITE_FAILED_PREFIX = 'actuator_write_failed:';
const RUNTIME_EXCEEDED_PREFIX = 'manual_runtime_exceeded:';

type TickWaiter = (report: TickReport | null) => void;

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class ActuatorArbiter implements ActuatorArbiterApi {
    private readonly core: ArbiterCore;
    private readonly reconciler: Reconciler;
    private readonly now: () => number;
    private readonly tickMs: number;
    private readonly debounceMs: number;
    private readonly claimWaitMs: number;
    private readonly warn: (message: string) => void;
    private readonly log: (message: string) => void;
    /** Source of `leaseMs`; setPolicy swaps it. Modes and targets stay those of `opts.policy` for the run. */
    private leasePolicy: ActuatorPolicy;

    private waiters: TickWaiter[] = [];
    private tickChain: Promise<unknown> = Promise.resolve();
    private queuedTicks = 0;
    private saveChain: Promise<void> = Promise.resolve();
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private interval: ReturnType<typeof setInterval> | null = null;
    private stopped = false;
    /** Last owners published; null until the first computed state, which is always published (even `{}`). */
    private lastOwners: string | null = null;
    /** `actuator_write_failed:<key>` alarms raised (or found Pending in the outbox on start). */
    private readonly alarmed = new Set<string>();
    /** `manual_runtime_exceeded:<key>` alarms raised (or found Pending on start) -> owner of the key then (null = none). */
    private readonly ceilingAlarmed = new Map<string, string | null>();
    /** Manual ON claims (`ownerId NUL key`) seen ON on the coil: only these are released when the coil later reads OFF. */
    private readonly confirmedOn = new Set<string>();
    /** Manual ON claims whose lease ended and whose tick has not reported yet. */
    private pendingExpired: ActuatorClaim[] = [];

    constructor(private readonly opts: ArbiterOptions) {
        this.core = new ArbiterCore(opts.policy);
        this.now = opts.now ?? Date.now;
        this.reconciler = new Reconciler(this.core, { ...opts.reconcilerDeps, mode: opts.mode, now: this.now });
        this.tickMs = Math.max(MIN_TICK_MS, Number(opts.tickMs) || DEFAULT_TICK_MS);
        this.debounceMs = opts.debounceMs ?? CLAIM_DEBOUNCE_MS;
        this.claimWaitMs = opts.claimWaitMs ?? CLAIM_MAX_WAIT_MS;
        this.warn = opts.warn ?? ((message: string) => console.warn(message));
        this.log = opts.log ?? ((message: string) => console.log(message));
        this.leasePolicy = opts.policy;
    }

    manages(key: string): boolean {
        return this.opts.policy.mode(key) !== 'unmanaged';
    }

    keyMode(key: string): KeyMode {
        return this.opts.policy.mode(key);
    }

    target(key: string): CoilTarget | undefined {
        return this.opts.reconcilerDeps.targets.find(t => t.key === key);
    }

    mode(): 'observe' | 'enforce' {
        return this.opts.mode;
    }

    leaseMs(source: ClaimSource, key: string): number {
        const seconds = source === 'manual' ? this.leasePolicy.manualLeaseS(key) : this.opts.scenarioLeaseS;
        return seconds * 1000;
    }

    /**
     * Takes the manual leases from a reloaded policy (device1.json changed after a gateway sync). Claims
     * already submitted keep their expiry. Which keys are managed, and in what mode, is not reloaded.
     */
    setPolicy(policy: ActuatorPolicy): void {
        this.leasePolicy = policy;
    }

    /** Loads saved claims, picks up Pending write alarms and starts ticking. */
    async start(): Promise<void> {
        const { store } = this.opts;
        if (store) {
            try {
                await store.ensureTable();
                this.core.load(await store.load(), this.now());
            } catch (error) {
                this.warn(`[arbiter] saved claims not loaded: ${errorText(error)}`);
            }
        }
        const outbox = this.outbox();
        if (outbox) {
            try {
                const now = this.now();
                for (const { alarm_key } of await outbox.activeAlarms()) {
                    if (alarm_key.startsWith(WRITE_FAILED_PREFIX)) this.alarmed.add(alarm_key);
                    if (alarm_key.startsWith(RUNTIME_EXCEEDED_PREFIX)) {
                        const key = alarm_key.slice(RUNTIME_EXCEEDED_PREFIX.length);
                        this.ceilingAlarmed.set(alarm_key, this.core.resolve(key, now).winner?.ownerId ?? null);
                    }
                }
            } catch (error) {
                this.warn(`[arbiter] active alarms not read: ${errorText(error)}`);
            }
        }
        this.emitOwnersIfChanged();
        this.interval = setInterval(() => {
            if (this.queuedTicks === 0) void this.tick();
        }, this.tickMs);
        (this.interval as any).unref?.();
        this.requestTick();
    }

    /** Stops ticking, waits for the running tick and saves the claims. */
    async stop(): Promise<void> {
        this.stopped = true;
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        if (this.interval) clearInterval(this.interval);
        this.debounceTimer = null;
        this.interval = null;
        await this.tickChain;
        this.persist();
        await this.saveChain;
        for (const waiter of this.waiters.splice(0)) waiter(null);
    }

    async claim(input: ClaimInput): Promise<ClaimResult> {
        this.core.claim({ ...input, createdAt: this.now() });
        this.persist();
        this.emitOwnersIfChanged();
        const report = await this.waitForTick();
        return this.resultFor(input, report);
    }

    async release(ownerId: string, key?: string): Promise<void> {
        if (this.core.release(ownerId, key).length === 0) return;
        this.persist();
        this.emitOwnersIfChanged();
        this.requestTick();
    }

    owners(): ArbiterOwners {
        const now = this.now();
        const info = (c: ActuatorClaim): OwnerInfo => ({ source: c.source, ownerId: c.ownerId, expiresAt: c.expiresAt });
        const owners: ArbiterOwners = {};
        for (const { key, winner } of this.core.resolveAll(now)) {
            if (!winner) continue;
            const runnerUp = this.core.rankedClaims(key, now)[1];
            owners[key] = { ...info(winner), next: runnerUp ? info(runnerUp) : null };
        }
        return owners;
    }

    /** One reconcile pass (serialised with every other tick). */
    tick(): Promise<TickReport | null> {
        this.queuedTicks++;
        const run = this.tickChain.then(() => this.runTick());
        this.tickChain = run.finally(() => {
            this.queuedTicks--;
        });
        return run;
    }

    private async runTick(): Promise<TickReport | null> {
        // Claims submitted from here on wait for the next tick: this one may already have resolved their key.
        const waiters = this.waiters.splice(0);
        let report: TickReport | null = null;
        try {
            const expired = this.core.expire(this.now());
            if (expired.length > 0) {
                this.persist();
                this.pendingExpired.push(...expired.filter(c => c.source === 'manual' && c.value));
            }
            await this.releaseClosedByDevice();
            report = await this.reconciler.tick();
            this.emitCoilWrites(report);
            this.opts.onTickReport?.(report);
            await this.updateWriteAlarms(report);
            await this.updateCeilingAlarms(report);
            this.rememberConfirmedOn(report);
        } catch (error) {
            this.warn(`[arbiter] tick failed: ${errorText(error)}`);
        }
        this.emitOwnersIfChanged();
        for (const waiter of waiters) waiter(report);
        return report;
    }

    private requestTick(): void {
        if (this.stopped || this.debounceTimer) return;
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.tick();
        }, this.debounceMs);
    }

    private waitForTick(): Promise<TickReport | null> {
        if (this.stopped) return Promise.resolve(null);
        return new Promise(resolve => {
            const waiter: TickWaiter = report => {
                clearTimeout(timer);
                resolve(report);
            };
            const timer = setTimeout(() => {
                this.waiters = this.waiters.filter(w => w !== waiter);
                resolve(null);
            }, this.claimWaitMs);
            this.waiters.push(waiter);
            this.requestTick();
        });
    }

    private resultFor(input: ClaimInput, report: TickReport | null): ClaimResult {
        const { winner } = this.core.resolve(input.key, this.now());
        const applied = winner !== null && winner.ownerId === input.ownerId;
        let actual: boolean | undefined;
        if (report) {
            const write = report.writes.filter(w => w.key === input.key).pop();
            actual = write && write.ok ? write.value : report.actual[input.key];
        }
        const result: ClaimResult = { applied, actual, mode: this.opts.mode };
        if (!applied && winner) result.blockedBy = winner.source;
        return result;
    }

    private outbox(): AlarmOutbox | null {
        try {
            return this.opts.outbox?.() ?? null;
        } catch {
            return null;
        }
    }

    private async updateWriteAlarms(report: TickReport): Promise<void> {
        for (const { key } of this.opts.reconcilerDeps.targets) {
            const alarmKey = `${WRITE_FAILED_PREFIX}${key}`;
            const failures = this.reconciler.consecutiveFailures(key);
            const raise = failures >= WRITE_FAILED_ALARM_TICKS && !this.alarmed.has(alarmKey);
            const clear = failures === 0 && this.alarmed.has(alarmKey);
            if (!raise && !clear) continue;
            const outbox = this.outbox();
            if (!outbox) continue;
            const lastError = report.writes.filter(w => w.key === key && !w.ok).pop()?.error ?? null;
            try {
                if (raise) {
                    await outbox.raise(alarmKey, this.alarmPayload(key, alarmKey, true, lastError));
                    this.alarmed.add(alarmKey);
                } else {
                    await outbox.clear(alarmKey, this.alarmPayload(key, alarmKey, false, null));
                    this.alarmed.delete(alarmKey);
                }
            } catch (error) {
                this.warn(`[arbiter] ${alarmKey} not ${raise ? 'raised' : 'cleared'}: ${errorText(error)}`);
            }
        }
    }

    private alarmPayload(key: string, alarmKey: string, raise: boolean, error: string | null): Record<string, unknown> {
        const deviceId = this.opts.deviceId?.() || 'unknown_device';
        return {
            alarm_name: alarmKey,
            alarm_key: alarmKey,
            id: deviceId,
            msg: raise ? `Không ghi được ${key}` : `Đã ghi được ${key}`,
            message_key: 'iot.notification.device.actuator_write_failed',
            message_params: { key, error },
            message_locale: 'vi-VN',
            severity: 'error',
            trigger_time: new Date(this.now()).toISOString(),
            tb_alarm_id: alarmKey,
            clear_by_user_id: '',
            entity: deviceId,
        };
    }

    private ceilingPayload(key: string, alarmKey: string, raise: boolean): Record<string, unknown> {
        const deviceId = this.opts.deviceId?.() || 'unknown_device';
        return {
            alarm_name: `Quá mức trần bật tay ${key}`,
            alarm_key: alarmKey,
            id: deviceId,
            msg: raise ? `${key} đã tắt: quá mức trần bật tay` : `${key} đã tắt hẳn`,
            message_key: 'iot.notification.device.manual_runtime_exceeded',
            message_params: { key },
            message_locale: 'vi-VN',
            severity: 'notification',
            trigger_time: new Date(this.now()).toISOString(),
            tb_alarm_id: alarmKey,
            clear_by_user_id: '',
            entity: deviceId,
        };
    }

    /**
     * A manual ON claim that was seen ON on the coil and now reads OFF was closed by the device (the PLC
     * ran its own program out): release it before the tick would write ON again. A claim never seen ON
     * (its first write is still due), a failed read or a key with failed writes releases nothing.
     */
    private async releaseClosedByDevice(): Promise<void> {
        if (this.confirmedOn.size === 0) return;
        const now = this.now();
        let released = false;
        for (const id of Array.from(this.confirmedOn)) {
            const [ownerId, key] = id.split('\u0000');
            const { winner } = this.core.resolve(key, now);
            if (!winner) {
                this.confirmedOn.delete(id);
                continue;
            }
            if (winner.ownerId !== ownerId || !winner.value) continue;
            const target = this.target(key);
            if (!target || this.reconciler.consecutiveFailures(key) > 0) continue;
            let actual: boolean;
            try {
                actual = Boolean(await this.opts.reconcilerDeps.readCoil(target));
            } catch {
                continue;
            }
            if (actual) continue;
            this.core.release(ownerId, key);
            this.confirmedOn.delete(id);
            released = true;
            this.log(`[arbiter] manual claim released: ${key} closed by device`);
        }
        if (released) this.persist();
    }

    /** Remembers the manual ON claims this tick saw ON on the coil; forgets claims that are gone. */
    private rememberConfirmedOn(report: TickReport): void {
        const now = this.now();
        const present = new Set(this.core.snapshot().map(c => `${c.ownerId}\u0000${c.key}`));
        for (const id of Array.from(this.confirmedOn)) {
            if (!present.has(id)) this.confirmedOn.delete(id);
        }
        for (const key of Object.keys(report.actual)) {
            const { winner } = this.core.resolve(key, now);
            if (winner && winner.source === 'manual' && winner.value && report.desired[key] === true && report.actual[key] === true) {
                this.confirmedOn.add(`${winner.ownerId}\u0000${key}`);
            }
        }
    }

    /**
     * `manual_runtime_exceeded:<key>`: a manual ON claim ended while its coil still read ON and the
     * arbiter is driving it OFF (enforce only; nothing is raised when the outbox is off). Cleared once the
     * coil reads OFF, or when a claim other than the one that held the key at raise time wins it.
     */
    private async updateCeilingAlarms(report: TickReport): Promise<void> {
        const expired = this.pendingExpired.splice(0);
        const now = this.now();
        for (const claim of expired) {
            const alarmKey = `${RUNTIME_EXCEEDED_PREFIX}${claim.key}`;
            if (this.opts.mode !== 'enforce' || this.ceilingAlarmed.has(alarmKey)) continue;
            if (report.actual[claim.key] !== true || report.desired[claim.key] !== false) continue;
            const outbox = this.outbox();
            if (!outbox) continue;
            try {
                await outbox.raise(alarmKey, this.ceilingPayload(claim.key, alarmKey, true));
                this.ceilingAlarmed.set(alarmKey, this.core.resolve(claim.key, now).winner?.ownerId ?? null);
            } catch (error) {
                this.warn(`[arbiter] ${alarmKey} not raised: ${errorText(error)}`);
            }
        }
        for (const [alarmKey, raisedOwner] of Array.from(this.ceilingAlarmed)) {
            const key = alarmKey.slice(RUNTIME_EXCEEDED_PREFIX.length);
            const owner = this.core.resolve(key, now).winner?.ownerId ?? null;
            const newWinner = owner !== null && owner !== raisedOwner;
            if (report.actual[key] !== false && !newWinner) continue;
            const outbox = this.outbox();
            if (!outbox) continue;
            try {
                await outbox.clear(alarmKey, this.ceilingPayload(key, alarmKey, false));
                this.ceilingAlarmed.delete(alarmKey);
            } catch (error) {
                this.warn(`[arbiter] ${alarmKey} not cleared: ${errorText(error)}`);
            }
        }
    }

    /** Saves the current claims; saves run one after another so the last one holds the latest set. */
    private persist(): void {
        const { store } = this.opts;
        // Every change is saved while running, so a store whose DataSource another node already closed
        // (node close order) has nothing new to take; warning there was only noise.
        if (!store || store.isAvailable?.() === false) return;
        this.saveChain = this.saveChain
            .then(() => store.save(this.core.snapshot()))
            .catch(error => this.warn(`[arbiter] claims not saved: ${errorText(error)}`));
    }

    /** Reports the writes of this tick that did not throw; a listener error must not fail the tick. */
    private emitCoilWrites(report: TickReport): void {
        const { onCoilWrite } = this.opts;
        if (!onCoilWrite) return;
        const ts = this.now();
        for (const write of report.writes) {
            if (!write.ok) continue;
            try {
                onCoilWrite({ key: write.key, value: write.value, ts });
            } catch (error) {
                this.warn(`[arbiter] coil write of ${write.key} not reported: ${errorText(error)}`);
            }
        }
    }

    private emitOwnersIfChanged(): void {
        const owners = this.owners();
        const serialised = JSON.stringify(owners);
        if (serialised === this.lastOwners) return;
        this.lastOwners = serialised;
        this.opts.onOwnersChange?.(owners);
    }
}

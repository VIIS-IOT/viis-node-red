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
 */
import type { EventOutbox } from '../../services/event-outbox/event-outbox';
import { ActuatorPolicy } from './actuator-policy';
import { ArbiterCore, ClaimSource } from './arbiter-core';
import type { ClaimStore } from './arbiter-store';
import { Reconciler, ReconcilerDeps, TickReport } from './reconciler';

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

export type ArbiterOwners = Record<string, { source: ClaimSource; ownerId: string; expiresAt: number | null }>;

export interface ActuatorArbiterApi {
    /** policy mode managed | hold */
    manages(key: string): boolean;
    mode(): 'observe' | 'enforce';
    /** Lease of a new claim from `source` on `key`, in ms (manual: key policy, others: scenario lease). */
    leaseMs(source: ClaimSource, key: string): number;
    /** Resolves after the next tick reconciled this key (debounced tick), at most `claimWaitMs`. */
    claim(input: ClaimInput): Promise<ClaimResult>;
    release(ownerId: string, key?: string): Promise<void>;
    owners(): ArbiterOwners;
}

export type ClaimStoreLike = Pick<ClaimStore, 'ensureTable' | 'load' | 'save'>;
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
    onTickReport?: (report: TickReport) => void;
    warn?: (message: string) => void;
}

export const DEFAULT_TICK_MS = 5000;
export const MIN_TICK_MS = 2000;
export const CLAIM_DEBOUNCE_MS = 200;
export const CLAIM_MAX_WAIT_MS = 15_000;
/** Consecutive failed write ticks before `actuator_write_failed:<key>` is raised. */
export const WRITE_FAILED_ALARM_TICKS = 3;
const WRITE_FAILED_PREFIX = 'actuator_write_failed:';

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

    private waiters: TickWaiter[] = [];
    private tickChain: Promise<unknown> = Promise.resolve();
    private queuedTicks = 0;
    private saveChain: Promise<void> = Promise.resolve();
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private interval: ReturnType<typeof setInterval> | null = null;
    private stopped = false;
    private lastOwners = '{}';
    /** `actuator_write_failed:<key>` alarms raised (or found Pending in the outbox on start). */
    private readonly alarmed = new Set<string>();

    constructor(private readonly opts: ArbiterOptions) {
        this.core = new ArbiterCore(opts.policy);
        this.now = opts.now ?? Date.now;
        this.reconciler = new Reconciler(this.core, { ...opts.reconcilerDeps, mode: opts.mode, now: this.now });
        this.tickMs = Math.max(MIN_TICK_MS, Number(opts.tickMs) || DEFAULT_TICK_MS);
        this.debounceMs = opts.debounceMs ?? CLAIM_DEBOUNCE_MS;
        this.claimWaitMs = opts.claimWaitMs ?? CLAIM_MAX_WAIT_MS;
        this.warn = opts.warn ?? ((message: string) => console.warn(message));
    }

    manages(key: string): boolean {
        return this.opts.policy.mode(key) !== 'unmanaged';
    }

    mode(): 'observe' | 'enforce' {
        return this.opts.mode;
    }

    leaseMs(source: ClaimSource, key: string): number {
        const seconds = source === 'manual' ? this.opts.policy.manualLeaseS(key) : this.opts.scenarioLeaseS;
        return seconds * 1000;
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
                for (const { alarm_key } of await outbox.activeAlarms()) {
                    if (alarm_key.startsWith(WRITE_FAILED_PREFIX)) this.alarmed.add(alarm_key);
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
        const owners: ArbiterOwners = {};
        for (const { key, winner } of this.core.resolveAll(this.now())) {
            if (winner) owners[key] = { source: winner.source, ownerId: winner.ownerId, expiresAt: winner.expiresAt };
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
            if (this.core.expire(this.now()).length > 0) this.persist();
            report = await this.reconciler.tick();
            this.opts.onTickReport?.(report);
            await this.updateWriteAlarms(report);
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

    /** Saves the current claims; saves run one after another so the last one holds the latest set. */
    private persist(): void {
        const { store } = this.opts;
        if (!store) return;
        this.saveChain = this.saveChain
            .then(() => store.save(this.core.snapshot()))
            .catch(error => this.warn(`[arbiter] claims not saved: ${errorText(error)}`));
    }

    private emitOwnersIfChanged(): void {
        const owners = this.owners();
        const serialised = JSON.stringify(owners);
        if (serialised === this.lastOwners) return;
        this.lastOwners = serialised;
        this.opts.onOwnersChange?.(owners);
    }
}

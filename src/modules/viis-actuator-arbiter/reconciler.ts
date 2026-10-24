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
 * - A `hold` key with no live claim resolves to `null` and is neither read nor written.
 * - `observe` reads and reports diffs but never writes.
 *
 * The reconciler does not change the claims; expiring and persisting them is the node's job.
 */
import { ArbiterCore } from './arbiter-core';
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
    actual: Record<string, boolean | undefined>;
    diffs: string[];
    writes: TickWrite[];
    readFailed: string[];
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

    constructor(private readonly core: ArbiterCore, private readonly deps: ReconcilerDeps) {}

    consecutiveFailures(key: string): number {
        return this.failures.get(key) ?? 0;
    }

    async tick(): Promise<TickReport> {
        const { deps } = this;
        const now = deps.now();
        const report: TickReport = { desired: {}, actual: {}, diffs: [], writes: [], readFailed: [] };
        const pending: { target: CoilTarget; value: boolean }[] = [];

        for (const target of deps.targets) {
            const { desired } = this.core.resolve(target.key, now);
            report.desired[target.key] = desired;
            if (desired === null) continue;

            let actual: boolean;
            try {
                actual = Boolean(await deps.readCoil(target));
            } catch {
                report.actual[target.key] = undefined;
                report.readFailed.push(target.key);
                continue;
            }
            report.actual[target.key] = actual;
            if (actual === desired) {
                // The coil already shows what the winner wants: whatever failed before is resolved.
                this.failures.delete(target.key);
                continue;
            }
            report.diffs.push(target.key);
            pending.push({ target, value: desired });
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

    private async write(target: CoilTarget, value: boolean): Promise<TickWrite> {
        try {
            await this.deps.writeCoil(target, value);
            this.failures.delete(target.key);
            return { key: target.key, value, ok: true };
        } catch (error) {
            this.failures.set(target.key, this.consecutiveFailures(target.key) + 1);
            return { key: target.key, value, ok: false, error: errorText(error) };
        }
    }
}

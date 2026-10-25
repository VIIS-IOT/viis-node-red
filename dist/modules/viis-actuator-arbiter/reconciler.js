"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reconciler = exports.OFF_READS_TO_RELEASE = void 0;
exports.classifyActuatorKey = classifyActuatorKey;
const schedule_coil_classify_1 = require("../viis-schedule-executor/schedule-coil-classify");
/** Consecutive OFF reads (on different ticks) after an ON before the device is taken to have closed the coil. */
exports.OFF_READS_TO_RELEASE = 2;
function claimId(claim) {
    return `${claim.ownerId}@${claim.createdAt}`;
}
/** Executor coil groups (schedule-coil-classify.ts): pumps and power coils stop first and start last. */
function classifyActuatorKey(key) {
    if ((0, schedule_coil_classify_1.isPumpKey)(key) || (0, schedule_coil_classify_1.isSystemPowerKey)(key) || (0, schedule_coil_classify_1.isChannelPowerKey)(key))
        return 'pump';
    if ((0, schedule_coil_classify_1.isValveKey)(key))
        return 'valve';
    return 'other';
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
class Reconciler {
    constructor(core, deps) {
        this.core = core;
        this.deps = deps;
        this.failures = new Map();
        this.watch = new Map();
    }
    consecutiveFailures(key) {
        var _a;
        return (_a = this.failures.get(key)) !== null && _a !== void 0 ? _a : 0;
    }
    async tick() {
        const { deps } = this;
        const now = deps.now();
        const report = { desired: {}, winners: {}, actual: {}, diffs: [], writes: [], readFailed: [], closedByDevice: [] };
        const pending = [];
        for (const target of deps.targets) {
            let resolution = this.core.resolve(target.key, now);
            if (resolution.desired === null) {
                report.desired[target.key] = null;
                this.watch.delete(target.key);
                continue;
            }
            let actual;
            try {
                actual = Boolean(await deps.readCoil(target));
            }
            catch (_a) {
                report.desired[target.key] = resolution.desired;
                report.winners[target.key] = resolution.winner
                    ? { source: resolution.winner.source, ownerId: resolution.winner.ownerId }
                    : null;
                report.actual[target.key] = undefined;
                report.readFailed.push(target.key);
                continue;
            }
            report.actual[target.key] = actual;
            const verdict = this.judgeRead(target.key, resolution, actual);
            if (verdict === 'released') {
                report.closedByDevice.push(target.key);
                resolution = this.core.resolve(target.key, now);
            }
            const { desired, winner } = resolution;
            report.desired[target.key] = desired;
            report.winners[target.key] = winner ? { source: winner.source, ownerId: winner.ownerId } : null;
            if (desired === null)
                continue;
            if (actual === desired) {
                // The coil already shows what the winner wants: whatever failed before is resolved.
                this.failures.delete(target.key);
                continue;
            }
            report.diffs.push(target.key);
            if (verdict === 'hold')
                continue;
            pending.push({ target, value: desired });
        }
        if (deps.mode !== 'enforce' || pending.length === 0) {
            return report;
        }
        const group = (value, cls) => pending.filter(p => p.value === value && deps.classify(p.target.key) === cls);
        // A pause is due before a phase when the phase named in `pauseAfter` wrote in this tick.
        const phases = [
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
            if (phase.items.length === 0)
                continue;
            const due = (phase.pauseAfter === 'pumpsOff' && pumpsOff) ||
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
                    if (deps.classify(target.key) === 'pump')
                        pumpsOff = true;
                }
                else if (deps.classify(target.key) !== 'pump') {
                    onBeforePumps = true;
                }
            }
        }
        return report;
    }
    /**
     * Applies the manual-ON ceiling rule to one successful read of `key`: `write` = reconcile as usual,
     * `hold` = the coil read OFF once after it was seen ON, so write nothing this tick and keep the claim,
     * `released` = the second OFF read, the manual claim is gone (the caller resolves again).
     */
    judgeRead(key, resolution, actual) {
        const winner = resolution.winner;
        if (!winner || !winner.value || winner.source !== 'manual' || this.consecutiveFailures(key) > 0) {
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
        if (!state.seenOn)
            return 'write';
        state.offReads++;
        if (state.offReads < exports.OFF_READS_TO_RELEASE)
            return 'hold';
        this.core.release(winner.ownerId, key);
        this.watch.delete(key);
        return 'released';
    }
    async write(target, value) {
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
        }
        catch (error) {
            this.failures.set(target.key, this.consecutiveFailures(target.key) + 1);
            return { key: target.key, value, ok: false, error: errorText(error) };
        }
    }
}
exports.Reconciler = Reconciler;

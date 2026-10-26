"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reconciler = exports.BOARD_SILENT_READS_TO_SKIP = exports.OFF_READS_TO_RELEASE = void 0;
exports.classifyActuatorKey = classifyActuatorKey;
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
 * - Reads run per board in parallel (a board's own keys one after another, they share its Modbus queue), so
 *   a hung board cannot hold up the others: after two timeout / not-connected errors in a row the rest of
 *   that board's keys are skipped for the tick (one such error alone may be a glitch). A board whose circuit breaker is open (`boardOffline`) is not read at
 *   all; its keys are in `readFailed` and the board in `offlineBoards`.
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
const arbiter_core_1 = require("./arbiter-core");
const schedule_coil_classify_1 = require("../viis-schedule-executor/schedule-coil-classify");
/** Consecutive OFF reads (on different ticks) after an ON before an outside party is taken to have switched the coil. */
exports.OFF_READS_TO_RELEASE = 2;
/** Sources whose ON claims are judged against OFF reads; safety and alarm_action keep enforcing. */
const WATCHED_SOURCES = new Set(['manual', ...arbiter_core_1.SUSPENDABLE_SOURCES]);
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
/** Reads of one board in a row that got no answer before its remaining keys are skipped for the tick. */
exports.BOARD_SILENT_READS_TO_SKIP = 2;
/** A read error that says the whole board is not answering: its other keys would only wait out the same timeout. */
function boardNotAnswering(error) {
    return /timed? ?out|not connected|port not open|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH/i.test(errorText(error));
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
        var _a, _b;
        const { deps } = this;
        const now = deps.now();
        const report = { desired: {}, winners: {}, actual: {}, diffs: [], writes: [], readFailed: [], offlineBoards: [], externalOff: [], gateBlocked: [] };
        const pending = [];
        // Phase 1: what each key should be, and one read per key. Boards are read in parallel.
        const jobs = [];
        for (const target of deps.targets) {
            const resolution = this.core.resolve(target.key, now);
            if (resolution.desired === null) {
                report.desired[target.key] = null;
                this.watch.delete(target.key);
                continue;
            }
            jobs.push({ target, resolution });
        }
        const reads = new Map(); // key -> coil value, null = not read
        const byBoard = new Map();
        for (const job of jobs) {
            const list = (_a = byBoard.get(job.target.boardId)) !== null && _a !== void 0 ? _a : [];
            list.push(job);
            byBoard.set(job.target.boardId, list);
        }
        await Promise.all(Array.from(byBoard, async ([boardId, list]) => {
            var _a;
            if ((_a = deps.boardOffline) === null || _a === void 0 ? void 0 : _a.call(deps, boardId)) {
                report.offlineBoards.push(boardId);
                for (const { target } of list)
                    reads.set(target.key, null);
                return;
            }
            let silent = 0; // consecutive reads of this board that got no answer
            for (let i = 0; i < list.length; i++) {
                const { target } = list[i];
                try {
                    reads.set(target.key, Boolean(await deps.readCoil(target)));
                    silent = 0;
                }
                catch (error) {
                    reads.set(target.key, null);
                    silent = boardNotAnswering(error) ? silent + 1 : 0;
                    if (silent >= exports.BOARD_SILENT_READS_TO_SKIP) {
                        for (const { target: skipped } of list.slice(i + 1))
                            reads.set(skipped.key, null);
                        return;
                    }
                }
            }
        }));
        // Phase 2: judge every key against its read, in target order.
        for (const { target, resolution: first } of jobs) {
            let resolution = first;
            const read = reads.get(target.key);
            if (read === null || read === undefined) {
                report.desired[target.key] = resolution.desired;
                report.winners[target.key] = resolution.winner
                    ? { source: resolution.winner.source, ownerId: resolution.winner.ownerId }
                    : null;
                report.actual[target.key] = undefined;
                report.readFailed.push(target.key);
                continue;
            }
            const actual = read;
            report.actual[target.key] = actual;
            const verdict = this.judgeRead(target.key, resolution, actual, now);
            if (typeof verdict === 'object') {
                report.externalOff.push(verdict);
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
        if (deps.mode === 'enforce' && deps.allowOn) {
            for (let i = pending.length - 1; i >= 0; i--) {
                const { target, value } = pending[i];
                if (!value)
                    continue;
                const gate = deps.allowOn(target.key);
                if (gate.allowed)
                    continue;
                report.gateBlocked.push({ key: target.key, reason: (_b = gate.reason) !== null && _b !== void 0 ? _b : 'protection' });
                pending.splice(i, 1);
            }
            report.gateBlocked.reverse();
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
     * Judges one successful read of `key` against the claim that wins it: `write` = reconcile as usual,
     * `hold` = the coil read OFF once after it was seen ON, so write nothing this tick and keep the claims,
     * an `ExternalOff` = the second OFF read: the claims were released/suspended (the caller resolves again).
     */
    judgeRead(key, resolution, actual, now) {
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
        if (!state.seenOn)
            return 'write';
        state.offReads++;
        if (state.offReads < exports.OFF_READS_TO_RELEASE)
            return 'hold';
        const event = { key, winner: { source: winner.source, ownerId: winner.ownerId }, released: [], suspended: [] };
        for (const claim of this.core.rankedClaims(key, now)) {
            if (!claim.value)
                continue;
            if (claim.source === 'manual') {
                this.core.release(claim.ownerId, key);
                event.released.push(claim.ownerId);
            }
            else if (arbiter_core_1.SUSPENDABLE_SOURCES.has(claim.source) && this.core.suspend(claim.ownerId, key)) {
                event.suspended.push(claim.ownerId);
            }
        }
        this.watch.delete(key);
        return event;
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

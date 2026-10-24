"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reconciler = void 0;
exports.classifyActuatorKey = classifyActuatorKey;
const schedule_coil_classify_1 = require("../viis-schedule-executor/schedule-coil-classify");
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
    }
    consecutiveFailures(key) {
        var _a;
        return (_a = this.failures.get(key)) !== null && _a !== void 0 ? _a : 0;
    }
    async tick() {
        const { deps } = this;
        const now = deps.now();
        const report = { desired: {}, actual: {}, diffs: [], writes: [], readFailed: [] };
        const pending = [];
        for (const target of deps.targets) {
            const { desired } = this.core.resolve(target.key, now);
            report.desired[target.key] = desired;
            if (desired === null)
                continue;
            let actual;
            try {
                actual = Boolean(await deps.readCoil(target));
            }
            catch (_a) {
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
    async write(target, value) {
        try {
            await this.deps.writeCoil(target, value);
            this.failures.delete(target.key);
            return { key: target.key, value, ok: true };
        }
        catch (error) {
            this.failures.set(target.key, this.consecutiveFailures(target.key) + 1);
            return { key: target.key, value, ok: false, error: errorText(error) };
        }
    }
}
exports.Reconciler = Reconciler;

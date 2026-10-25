"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_CLAIM_GRACE_MS = void 0;
exports.scheduleOwnerId = scheduleOwnerId;
exports.enforcingArbiter = enforcingArbiter;
exports.claimingArbiter = claimingArbiter;
exports.isArbitratedCoil = isArbitratedCoil;
exports.withoutArbitratedCoils = withoutArbitratedCoils;
exports.scheduleWindowEndMs = scheduleWindowEndMs;
exports.startScheduleCommands = startScheduleCommands;
exports.beginScheduleFinish = beginScheduleFinish;
/**
 * The schedule executor as a claim source of the actuator arbiter (plan Task 13). Applies only to fc=5 keys
 * whose `actuatorPolicy` mode is `managed`; `hold` keys, unmanaged keys and holdings keep today's direct
 * writes. With the arbiter off, every helper here hands back today's commands unchanged.
 *
 * - `enforce`, START: each truthy managed coil becomes the claim `schedule:<name>` (source `schedule`) that
 *   expires at the window end + 5 min, instead of a write. A claim that lost is withdrawn and reported as a
 *   failed key (ADR-034: no `started` for a key that did not start).
 * - `enforce`, finish (and every other OFF of a run): the managed coils leave the reset list and the run's
 *   claims are released in the executor's water-hammer order (see beginScheduleFinish).
 * - `observe` (FIX-17): the same claims are submitted and released, so the arbiter can compare them with
 *   the coil, but nothing is answered from them and every command is still written directly, as today.
 */
const farm_time_1 = require("../../core/farm-time");
const schedule_run_window_1 = require("../../core/schedule-run-window");
const arbiter_registry_1 = require("../viis-actuator-arbiter/arbiter-registry");
const schedule_coil_classify_1 = require("./schedule-coil-classify");
/** A schedule claim outlives its window by this much, so a late finish still finds it. */
exports.SCHEDULE_CLAIM_GRACE_MS = 5 * 60 * 1000;
function scheduleOwnerId(scheduleName) {
    return `schedule:${scheduleName}`;
}
/** The registered arbiter when it enforces; null when it is off, observing or not deployed. */
function enforcingArbiter(arbiter = (0, arbiter_registry_1.getArbiter)()) {
    return arbiter !== null && arbiter.mode() === 'enforce' ? arbiter : null;
}
/** The registered arbiter when it observes or enforces (it takes the schedule's claims); null when off. */
function claimingArbiter(arbiter = (0, arbiter_registry_1.getArbiter)()) {
    return arbiter;
}
/**
 * An fc=5 command on a `managed` key: the enforcing arbiter writes it (no one else may). A `hold` key is
 * not one: with no claim the arbiter leaves it alone, so the schedule keeps writing it (and its OFF).
 */
function isArbitratedCoil(command, arbiter) {
    return arbiter !== null && command.fc === 5 && arbiter.keyMode(command.key) === 'managed';
}
/** `commands` without the coils the arbiter writes; the same array when there is no enforcing arbiter. */
function withoutArbitratedCoils(commands, arbiter = enforcingArbiter()) {
    if (arbiter === null)
        return commands;
    return commands.filter(command => !isArbitratedCoil(command, arbiter));
}
/** End (unix ms) of the window the schedule runs in at `nowMs` (ADR-030 farm time), null when not in one. */
function scheduleWindowEndMs(schedule, plan, nowMs, tz = farm_time_1.DEFAULT_FARM_TIMEZONE) {
    const decision = (0, schedule_run_window_1.evaluateScheduleRun)(schedule, plan, nowMs, tz);
    if (!decision.due)
        return null;
    return (0, farm_time_1.plannedWindowUnixMs)(decision.runDate, (0, schedule_run_window_1.civilTimeOnly)(schedule.start_time), (0, schedule_run_window_1.civilTimeOnly)(schedule.end_time), tz).endMs;
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
async function claimOn(arbiter, command, ownerId, expiresAt, phase) {
    var _a;
    const outcome = {
        key: command.key, phase, fc: 5, address: command.address, expected: true, status: 'fail', attempts: 1,
    };
    try {
        const result = await arbiter.claim({ key: command.key, value: true, source: 'schedule', ownerId, expiresAt });
        outcome.read = result.actual;
        if (!result.applied) {
            // The schedule is told this key failed, so the claim must not take effect later.
            await arbiter.release(ownerId, command.key).catch(() => undefined);
            outcome.error = `blocked_by:${(_a = result.blockedBy) !== null && _a !== void 0 ? _a : 'expired'}`;
        }
        else if (result.actual !== true) {
            // Won but not on the coil yet (Modbus down): the arbiter keeps the claim and retries.
            outcome.error = `not_confirmed:${command.key} reads ${String(result.actual)}`;
        }
        else {
            outcome.status = 'pass';
        }
    }
    catch (error) {
        outcome.error = errorText(error);
    }
    return outcome;
}
/** One step per phase; the claims of a step go to the arbiter together, so one tick writes them. */
async function claimStep(arbiter, phase, commands, ownerId, expiresAt) {
    if (commands.length === 0)
        return [];
    const ts = Date.now();
    const keys = await Promise.all(commands.map(command => claimOn(arbiter, command, ownerId, expiresAt(command), phase)));
    return [{ phase, ts, ok: keys.every(k => k.status === 'pass'), duration_ms: Date.now() - ts, keys }];
}
/**
 * START of a run. Order as today: holdings, valves and other coils, water-hammer delay, pumps, power.
 * Managed valves/others are claimed before the unmanaged coils are written; managed pumps/power after
 * them, behind the water-hammer delay unless the direct writes already waited before their pumps.
 */
async function startScheduleCommands(deps, scheduleName, runId, windowEndMs, commands) {
    const { arbiter } = deps;
    if (arbiter === null || !commands.coilCommands.some(command => isArbitratedCoil(command, arbiter))) {
        return deps.execute(commands);
    }
    if (arbiter.mode() === 'observe') {
        // observe: the claims a run would hold in enforce, recorded beside today's direct writes.
        for (const command of commands.coilCommands) {
            if (!isArbitratedCoil(command, arbiter) || !command.value)
                continue;
            const expiresAt = windowEndMs !== null
                ? windowEndMs + exports.SCHEDULE_CLAIM_GRACE_MS
                : deps.now() + arbiter.leaseMs('schedule', command.key);
            void arbiter
                .claim({ key: command.key, value: true, source: 'schedule', ownerId: scheduleOwnerId(scheduleName), expiresAt })
                .catch(() => undefined);
        }
        return deps.execute(commands);
    }
    const direct = commands.coilCommands.filter(command => !isArbitratedCoil(command, arbiter));
    // A falsy coil is not a claim (and START does not write it today either).
    const claimed = commands.coilCommands.filter(command => isArbitratedCoil(command, arbiter) && Boolean(command.value));
    const { powerCoils, pumpCoils, valveCoils, otherCoils } = (0, schedule_coil_classify_1.classifyCoils)(claimed);
    const ownerId = scheduleOwnerId(scheduleName);
    const expiresAt = (command) => windowEndMs !== null
        ? windowEndMs + exports.SCHEDULE_CLAIM_GRACE_MS
        : deps.now() + arbiter.leaseMs('schedule', command.key);
    const steps = [];
    if (commands.holdingCommands.length > 0) {
        steps.push(...(await deps.execute({ holdingCommands: commands.holdingCommands, coilCommands: [] })).steps);
    }
    steps.push(...await claimStep(arbiter, 'open_valves', valveCoils, ownerId, expiresAt));
    steps.push(...await claimStep(arbiter, 'other_coils', otherCoils, ownerId, expiresAt));
    if (direct.length > 0) {
        steps.push(...(await deps.execute({ holdingCommands: [], coilCommands: direct })).steps);
    }
    if (pumpCoils.length > 0 || powerCoils.length > 0) {
        const { pumpCoils: directPumps, powerCoils: directPower } = (0, schedule_coil_classify_1.classifyCoils)(direct);
        const opened = valveCoils.length + otherCoils.length + direct.length - directPumps.length - directPower.length > 0;
        const alreadyWaited = steps.some(step => step.phase === 'water_hammer_delay');
        if (opened && !alreadyWaited) {
            const t0 = Date.now();
            await deps.sleep(deps.waterHammerMs);
            steps.push({ phase: 'water_hammer_delay', ts: t0, ok: true, duration_ms: Date.now() - t0, keys: [] });
        }
        steps.push(...await claimStep(arbiter, 'start_pumps', pumpCoils, ownerId, expiresAt));
        steps.push(...await claimStep(arbiter, 'system_power', powerCoils, ownerId, expiresAt));
    }
    return { runId, action: 'start', scheduleId: scheduleName, steps };
}
/** A direct OFF that stopped a pump or another non-valve, non-power coil. */
function stoppedNonValve(report) {
    var _a;
    return ((_a = report === null || report === void 0 ? void 0 : report.steps) !== null && _a !== void 0 ? _a : []).some(step => step.keys.some(k => k.fc === 5 && !(0, schedule_coil_classify_1.isValveKey)(k.key) && !(0, schedule_coil_classify_1.isSystemPowerKey)(k.key)));
}
/**
 * Before a run's OFF (observe only drops the claims and leaves every command to the direct write). The
 * executor's finish order is pumps and other coils off, water-hammer delay, valves closed, power off; the
 * enforcing arbiter follows it across the direct writes:
 *
 * 1. now: release the run's managed pumps and other coils (the arbiter stops them within one tick);
 * 2. the caller writes `commands` directly (its own pumps → delay → valves order);
 * 3. `complete()`: if managed valves remain and a pump or other coil stopped without a delay after it
 *    (no direct valve made the reset wait), sleep `waterHammerMs`; then release the rest of the run's
 *    claims, so a managed valve never closes while a pump of the same run may still run.
 */
async function beginScheduleFinish(arbiter, scheduleName, commands, deps) {
    var _a;
    if (arbiter === null) {
        return { commands, complete: async () => undefined };
    }
    const warn = (_a = deps.warn) !== null && _a !== void 0 ? _a : ((message) => console.warn(message));
    const ownerId = scheduleOwnerId(scheduleName);
    if (arbiter.mode() === 'observe') {
        // observe: every command is still written directly; the run's claims go first, so the arbiter does
        // not report the OFF writes that follow as diffs against a claim that still says ON.
        try {
            await arbiter.release(ownerId);
        }
        catch (error) {
            warn(`[ARBITER] Claims of ${scheduleName} not released: ${errorText(error)}`);
        }
        return { commands, complete: async () => undefined };
    }
    const managed = commands.filter(command => isArbitratedCoil(command, arbiter));
    const { pumpCoils, otherCoils, valveCoils } = (0, schedule_coil_classify_1.classifyCoils)(managed);
    const firstKeys = Array.from(new Set([...pumpCoils, ...otherCoils].map(command => command.key)));
    for (const key of firstKeys) {
        try {
            await arbiter.release(ownerId, key);
        }
        catch (error) {
            warn(`[ARBITER] Claim ${key} of ${scheduleName} not released: ${errorText(error)}`);
        }
    }
    let completed = false;
    const complete = async (report) => {
        var _a;
        if (completed)
            return;
        completed = true;
        const waited = ((_a = report === null || report === void 0 ? void 0 : report.steps) !== null && _a !== void 0 ? _a : []).some(step => step.phase === 'water_hammer_delay');
        if (valveCoils.length > 0 && !waited && (firstKeys.length > 0 || stoppedNonValve(report))) {
            await deps.sleep(deps.waterHammerMs);
        }
        try {
            await arbiter.release(ownerId);
        }
        catch (error) {
            warn(`[ARBITER] Claims of ${scheduleName} not released: ${errorText(error)}`);
        }
    };
    return { commands: withoutArbitratedCoils(commands, arbiter), complete };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_CLAIM_GRACE_MS = void 0;
exports.scheduleOwnerId = scheduleOwnerId;
exports.enforcingArbiter = enforcingArbiter;
exports.isArbitratedCoil = isArbitratedCoil;
exports.withoutArbitratedCoils = withoutArbitratedCoils;
exports.scheduleWindowEndMs = scheduleWindowEndMs;
exports.startScheduleCommands = startScheduleCommands;
exports.prepareScheduleFinish = prepareScheduleFinish;
/**
 * The schedule executor as a claim source of the actuator arbiter (plan Task 13). Applies only while the
 * arbiter enforces (`ARBITER_MODE=enforce`) and only to fc=5 keys that `actuatorPolicy` lists as managed
 * or hold; with the arbiter off or observing, every helper here hands back today's commands unchanged.
 *
 * - START: each truthy managed coil becomes the claim `schedule:<name>` (source `schedule`) that expires at
 *   the window end + 5 min, instead of a write. Holdings and unmanaged coils are written as today. A claim
 *   that lost is withdrawn and reported as a failed key (ADR-034: no `started` for a key that did not start).
 * - Finish (and every other OFF of a run): release `schedule:<name>`; the managed coils leave the reset list.
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
/** An fc=5 command the enforcing arbiter writes (no one else may). */
function isArbitratedCoil(command, arbiter) {
    return arbiter !== null && command.fc === 5 && arbiter.manages(command.key);
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
/**
 * Before a run's OFF: releases its claims (the arbiter turns those coils off unless another owner holds
 * them) and returns the commands still written directly. The same array when there is no enforcing arbiter.
 */
async function prepareScheduleFinish(arbiter, scheduleName, commands, warn = message => console.warn(message)) {
    if (arbiter === null)
        return commands;
    try {
        await arbiter.release(scheduleOwnerId(scheduleName));
    }
    catch (error) {
        warn(`[ARBITER] Claims of ${scheduleName} not released: ${errorText(error)}`);
    }
    return withoutArbitratedCoils(commands, arbiter);
}

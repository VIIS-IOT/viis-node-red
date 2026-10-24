/**
 * The schedule executor as a claim source of the actuator arbiter (plan Task 13). Applies only while the
 * arbiter enforces (`ARBITER_MODE=enforce`) and only to fc=5 keys whose `actuatorPolicy` mode is `managed`;
 * `hold` keys, unmanaged keys and holdings keep today's direct writes. With the arbiter off or observing,
 * every helper here hands back today's commands unchanged.
 *
 * - START: each truthy managed coil becomes the claim `schedule:<name>` (source `schedule`) that expires at
 *   the window end + 5 min, instead of a write. A claim that lost is withdrawn and reported as a failed key
 *   (ADR-034: no `started` for a key that did not start).
 * - Finish (and every other OFF of a run): the managed coils leave the reset list and the run's claims are
 *   released in the executor's water-hammer order (see beginScheduleFinish).
 */
import { DEFAULT_FARM_TIMEZONE, plannedWindowUnixMs } from '../../core/farm-time';
import { civilTimeOnly, evaluateScheduleRun, PlanDateRange, ScheduleRunFields } from '../../core/schedule-run-window';
import type { ActuatorArbiterApi } from '../viis-actuator-arbiter/arbiter-api';
import { getArbiter } from '../viis-actuator-arbiter/arbiter-registry';
import { classifyCoils, isSystemPowerKey, isValveKey } from './schedule-coil-classify';
import { ExecutionReport, ExecutionStep, KeyOutcome, SchedulePhase } from './schedule-execution-types';
import { ModbusCmd } from './type';

/** A schedule claim outlives its window by this much, so a late finish still finds it. */
export const SCHEDULE_CLAIM_GRACE_MS = 5 * 60 * 1000;

export function scheduleOwnerId(scheduleName: string): string {
    return `schedule:${scheduleName}`;
}

/** The registered arbiter when it enforces; null when it is off, observing or not deployed. */
export function enforcingArbiter(arbiter: ActuatorArbiterApi | null = getArbiter()): ActuatorArbiterApi | null {
    return arbiter !== null && arbiter.mode() === 'enforce' ? arbiter : null;
}

/**
 * An fc=5 command on a `managed` key: the enforcing arbiter writes it (no one else may). A `hold` key is
 * not one: with no claim the arbiter leaves it alone, so the schedule keeps writing it (and its OFF).
 */
export function isArbitratedCoil(command: { key: string; fc: number }, arbiter: ActuatorArbiterApi | null): boolean {
    return arbiter !== null && command.fc === 5 && arbiter.keyMode(command.key) === 'managed';
}

/** `commands` without the coils the arbiter writes; the same array when there is no enforcing arbiter. */
export function withoutArbitratedCoils<T extends { key: string; fc: number }>(
    commands: T[],
    arbiter: ActuatorArbiterApi | null = enforcingArbiter()
): T[] {
    if (arbiter === null) return commands;
    return commands.filter(command => !isArbitratedCoil(command, arbiter));
}

/** End (unix ms) of the window the schedule runs in at `nowMs` (ADR-030 farm time), null when not in one. */
export function scheduleWindowEndMs(
    schedule: ScheduleRunFields,
    plan: PlanDateRange | null | undefined,
    nowMs: number,
    tz: string = DEFAULT_FARM_TIMEZONE
): number | null {
    const decision = evaluateScheduleRun(schedule, plan, nowMs, tz);
    if (!decision.due) return null;
    return plannedWindowUnixMs(decision.runDate, civilTimeOnly(schedule.start_time), civilTimeOnly(schedule.end_time), tz).endMs;
}

type StartCommands = { holdingCommands: ModbusCmd[]; coilCommands: ModbusCmd[] };

export interface ScheduleStartDeps {
    /** The enforcing arbiter, or null (then START is exactly today's `execute`). */
    arbiter: ActuatorArbiterApi | null;
    /** Today's direct writes (`ScheduleService.executeModbusCommands`). */
    execute(commands: StartCommands): Promise<ExecutionReport>;
    sleep(ms: number): Promise<void>;
    waterHammerMs: number;
    now(): number;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function claimOn(
    arbiter: ActuatorArbiterApi,
    command: ModbusCmd,
    ownerId: string,
    expiresAt: number,
    phase: SchedulePhase
): Promise<KeyOutcome> {
    const outcome: KeyOutcome = {
        key: command.key, phase, fc: 5, address: command.address, expected: true, status: 'fail', attempts: 1,
    };
    try {
        const result = await arbiter.claim({ key: command.key, value: true, source: 'schedule', ownerId, expiresAt });
        outcome.read = result.actual;
        if (!result.applied) {
            // The schedule is told this key failed, so the claim must not take effect later.
            await arbiter.release(ownerId, command.key).catch(() => undefined);
            outcome.error = `blocked_by:${result.blockedBy ?? 'expired'}`;
        } else if (result.actual !== true) {
            // Won but not on the coil yet (Modbus down): the arbiter keeps the claim and retries.
            outcome.error = `not_confirmed:${command.key} reads ${String(result.actual)}`;
        } else {
            outcome.status = 'pass';
        }
    } catch (error) {
        outcome.error = errorText(error);
    }
    return outcome;
}

/** One step per phase; the claims of a step go to the arbiter together, so one tick writes them. */
async function claimStep(
    arbiter: ActuatorArbiterApi,
    phase: SchedulePhase,
    commands: ModbusCmd[],
    ownerId: string,
    expiresAt: (command: ModbusCmd) => number
): Promise<ExecutionStep[]> {
    if (commands.length === 0) return [];
    const ts = Date.now();
    const keys = await Promise.all(commands.map(command => claimOn(arbiter, command, ownerId, expiresAt(command), phase)));
    return [{ phase, ts, ok: keys.every(k => k.status === 'pass'), duration_ms: Date.now() - ts, keys }];
}

/**
 * START of a run. Order as today: holdings, valves and other coils, water-hammer delay, pumps, power.
 * Managed valves/others are claimed before the unmanaged coils are written; managed pumps/power after
 * them, behind the water-hammer delay unless the direct writes already waited before their pumps.
 */
export async function startScheduleCommands(
    deps: ScheduleStartDeps,
    scheduleName: string,
    runId: string,
    windowEndMs: number | null,
    commands: StartCommands
): Promise<ExecutionReport> {
    const { arbiter } = deps;
    if (arbiter === null || !commands.coilCommands.some(command => isArbitratedCoil(command, arbiter))) {
        return deps.execute(commands);
    }

    const direct = commands.coilCommands.filter(command => !isArbitratedCoil(command, arbiter));
    // A falsy coil is not a claim (and START does not write it today either).
    const claimed = commands.coilCommands.filter(command => isArbitratedCoil(command, arbiter) && Boolean(command.value));
    const { powerCoils, pumpCoils, valveCoils, otherCoils } = classifyCoils(claimed);
    const ownerId = scheduleOwnerId(scheduleName);
    const expiresAt = (command: ModbusCmd) => windowEndMs !== null
        ? windowEndMs + SCHEDULE_CLAIM_GRACE_MS
        : deps.now() + arbiter.leaseMs('schedule', command.key);

    const steps: ExecutionStep[] = [];
    if (commands.holdingCommands.length > 0) {
        steps.push(...(await deps.execute({ holdingCommands: commands.holdingCommands, coilCommands: [] })).steps);
    }
    steps.push(...await claimStep(arbiter, 'open_valves', valveCoils, ownerId, expiresAt));
    steps.push(...await claimStep(arbiter, 'other_coils', otherCoils, ownerId, expiresAt));
    if (direct.length > 0) {
        steps.push(...(await deps.execute({ holdingCommands: [], coilCommands: direct })).steps);
    }

    if (pumpCoils.length > 0 || powerCoils.length > 0) {
        const { pumpCoils: directPumps, powerCoils: directPower } = classifyCoils(direct);
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

export interface ScheduleFinish<T> {
    /** The commands still written directly (the same array when there is no enforcing arbiter). */
    commands: T[];
    /**
     * Call once the direct OFF of `commands` returned (also when it failed or there was nothing to write):
     * waits the water-hammer delay when a pump stopped and no wait followed it yet, then releases the run's
     * remaining claims (valves, power and anything else it still holds).
     */
    complete(report?: ExecutionReport | null): Promise<void>;
}

export interface ScheduleFinishDeps {
    sleep(ms: number): Promise<void>;
    waterHammerMs: number;
    warn?: (message: string) => void;
}

/** A direct OFF that stopped a pump or another non-valve, non-power coil. */
function stoppedNonValve(report: ExecutionReport | null | undefined): boolean {
    return (report?.steps ?? []).some(step =>
        step.keys.some(k => k.fc === 5 && !isValveKey(k.key) && !isSystemPowerKey(k.key)));
}

/**
 * Before a run's OFF. The executor's finish order is pumps and other coils off, water-hammer delay, valves
 * closed, power off; the arbiter follows it across the direct writes:
 *
 * 1. now: release the run's managed pumps and other coils (the arbiter stops them within one tick);
 * 2. the caller writes `commands` directly (its own pumps → delay → valves order);
 * 3. `complete()`: if managed valves remain and a pump or other coil stopped without a delay after it
 *    (no direct valve made the reset wait), sleep `waterHammerMs`; then release the rest of the run's
 *    claims, so a managed valve never closes while a pump of the same run may still run.
 */
export async function beginScheduleFinish<T extends { key: string; fc: number }>(
    arbiter: ActuatorArbiterApi | null,
    scheduleName: string,
    commands: T[],
    deps: ScheduleFinishDeps
): Promise<ScheduleFinish<T>> {
    if (arbiter === null) {
        return { commands, complete: async () => undefined };
    }
    const warn = deps.warn ?? ((message: string) => console.warn(message));
    const ownerId = scheduleOwnerId(scheduleName);
    const managed = commands.filter(command => isArbitratedCoil(command, arbiter));
    const { pumpCoils, otherCoils, valveCoils } = classifyCoils(managed);

    const firstKeys = Array.from(new Set([...pumpCoils, ...otherCoils].map(command => command.key)));
    for (const key of firstKeys) {
        try {
            await arbiter.release(ownerId, key);
        } catch (error) {
            warn(`[ARBITER] Claim ${key} of ${scheduleName} not released: ${errorText(error)}`);
        }
    }

    let completed = false;
    const complete = async (report?: ExecutionReport | null): Promise<void> => {
        if (completed) return;
        completed = true;
        const waited = (report?.steps ?? []).some(step => step.phase === 'water_hammer_delay');
        if (valveCoils.length > 0 && !waited && (firstKeys.length > 0 || stoppedNonValve(report))) {
            await deps.sleep(deps.waterHammerMs);
        }
        try {
            await arbiter.release(ownerId);
        } catch (error) {
            warn(`[ARBITER] Claims of ${scheduleName} not released: ${errorText(error)}`);
        }
    };

    return { commands: withoutArbitratedCoils(commands, arbiter), complete };
}

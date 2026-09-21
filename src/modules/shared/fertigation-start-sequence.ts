import {
    classifyCoils,
    isNumberedValveKey,
    isSystemPowerKey,
} from '../viis-schedule-executor/schedule-coil-classify';
import {
    buildValveProgramCommand,
    isValveOn,
    isValveProgramHoldingKey,
} from '../viis-schedule-executor/schedule-valve-program';

export const WATER_HAMMER_DELAY_MS = 7000;

export function resolveWaterHammerDelayMs(seconds: unknown): number {
    if (seconds === undefined || seconds === null || seconds === '') {
        return WATER_HAMMER_DELAY_MS;
    }
    const n = typeof seconds === 'number' ? seconds : Number(seconds);
    if (!Number.isFinite(n) || n < 0) {
        return WATER_HAMMER_DELAY_MS;
    }
    return Math.round(n * 1000);
}

export type FertigationWriteOp =
    | { kind: 'write'; key: string; value: unknown }
    | { kind: 'delay'; ms: number };

export interface FertigationStartInput {
    commands: Array<{ key: string; value: unknown }>;
    holdings: Record<string, number>;
    coils: Record<string, number>;
}

const UNUSED_HOLDING_KEY = /(?:^|_)(time_valve_|set_flow)/i;
const FERTIGATION_PUMP_KEY = /(?:^|_)(main_pump|input_pump)$/i;

export function isFertigationBatch(keys: string[]): boolean {
    return keys.some((key) => isNumberedValveKey(key) || isSystemPowerKey(key) || FERTIGATION_PUMP_KEY.test(key));
}

export function planFertigationStartWrites(
    input: FertigationStartInput,
    options: { waterHammerDelayMs?: number } = {},
): FertigationWriteOp[] {
    const provided: Record<string, unknown> = {};
    for (const cmd of input.commands) {
        provided[cmd.key] = cmd.value;
    }

    const ops: FertigationWriteOp[] = [];
    const unusedResetKeys = new Set<string>();

    for (const key of Object.keys(input.holdings)) {
        if (!UNUSED_HOLDING_KEY.test(key)) continue;
        if (Object.prototype.hasOwnProperty.call(provided, key)) continue;
        unusedResetKeys.add(key);
        ops.push({ kind: 'write', key, value: 0 });
    }

    const valveProgram = buildValveProgramCommand(provided, input.holdings);
    if (valveProgram) {
        ops.push({ kind: 'write', key: valveProgram.key, value: valveProgram.value });
    }

    for (const [key, value] of Object.entries(provided)) {
        if (isValveProgramHoldingKey(key)) continue;
        if (unusedResetKeys.has(key)) continue;
        if (!Object.prototype.hasOwnProperty.call(input.holdings, key)) continue;
        ops.push({ kind: 'write', key, value });
    }

    const coilEntries = Object.entries(provided)
        .filter(([key, value]) => Object.prototype.hasOwnProperty.call(input.coils, key) && isValveOn(value))
        .map(([key, value]) => ({ key, value }));

    const { powerCoils, pumpCoils, valveCoils, otherCoils } = classifyCoils(coilEntries);
    const hammerMs = Number.isFinite(options.waterHammerDelayMs)
        ? Number(options.waterHammerDelayMs)
        : WATER_HAMMER_DELAY_MS;

    for (const cmd of valveCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    for (const cmd of otherCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }

    if (pumpCoils.length > 0 || powerCoils.length > 0) {
        ops.push({ kind: 'delay', ms: hammerMs });
    }

    for (const cmd of pumpCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    for (const cmd of powerCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }

    return ops;
}

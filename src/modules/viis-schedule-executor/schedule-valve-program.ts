import { ModbusCmd } from './type';

export const VALVE_PROGRAM_DEFAULT_ADDRESS = 20;

export function isValveOn(raw: unknown): boolean {
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

export function numberedValveIndex(key: string): number | null {
    const match = key.match(/(?<!time_)valve_(\d+)$/i);
    if (!match) return null;
    return Number(match[1]);
}

export function isValveProgramHoldingKey(key: string): boolean {
    return /(?:^|_)valve_program(_index)?$/i.test(key);
}

export function findValveProgramHoldingKey(holdingMap: Record<string, number>): string | undefined {
    if (Object.prototype.hasOwnProperty.call(holdingMap, 'valve_program')) {
        return 'valve_program';
    }
    return Object.keys(holdingMap).find((key) => isValveProgramHoldingKey(key));
}

export function buildValveProgramBitmask(actionObj: Record<string, unknown>): number {
    let mask = 0;
    for (const [key, value] of Object.entries(actionObj)) {
        const index = numberedValveIndex(key);
        if (index === null || index < 0 || index > 15) continue;
        if (isValveOn(value)) {
            mask |= (1 << index);
        }
    }
    return mask;
}

export function mergeHoldingMaps(...maps: Array<Record<string, number> | undefined>): Record<string, number> {
    return Object.assign({}, ...maps.filter(Boolean));
}

export function occupyingKeysAtAddress(
    holdingMap: Record<string, number>,
    address: number
): string[] {
    return Object.entries(holdingMap)
        .filter(([, addr]) => Number(addr) === address)
        .map(([key]) => key);
}

/** Resolve write address or null if a non-program key already owns the target addr. */
export function resolveValveProgramAddress(holdingMap: Record<string, number>): number | null {
    const programKey = findValveProgramHoldingKey(holdingMap);
    const mapped = programKey !== undefined ? holdingMap[programKey] : undefined;
    const target = mapped !== undefined ? Number(mapped) : VALVE_PROGRAM_DEFAULT_ADDRESS;
    const others = occupyingKeysAtAddress(holdingMap, target).filter(k => k !== programKey);
    if (others.length > 0) return null;
    if (mapped === undefined && occupyingKeysAtAddress(holdingMap, VALVE_PROGRAM_DEFAULT_ADDRESS).length > 0) {
        return null;
    }
    if (mapped === undefined) return VALVE_PROGRAM_DEFAULT_ADDRESS;
    return target;
}

function valveProgramWriteKey(holdingMap: Record<string, number>): string {
    return findValveProgramHoldingKey(holdingMap) || 'valve_program';
}

export function buildValveProgramCommand(
    actionObj: Record<string, unknown>,
    holdingMap: Record<string, number>,
    unitid: number = 1
): ModbusCmd | null {
    const address = resolveValveProgramAddress(holdingMap);
    if (address === null) return null;
    return {
        key: valveProgramWriteKey(holdingMap),
        value: buildValveProgramBitmask(actionObj),
        fc: 6,
        unitid,
        address,
        quantity: 1,
    };
}

export function buildValveProgramOffCommand(
    holdingMap: Record<string, number>,
    unitid: number = 1
): ModbusCmd | null {
    const address = resolveValveProgramAddress(holdingMap);
    if (address === null) return null;
    return {
        key: valveProgramWriteKey(holdingMap),
        value: 0,
        fc: 6,
        unitid,
        address,
        quantity: 1,
    };
}

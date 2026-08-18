import { ModbusCmd } from './type';

export const VALVE_PROGRAM_DEFAULT_ADDRESS = 20;

export function isValveOn(raw: unknown): boolean {
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

export function buildValveProgramBitmask(actionObj: Record<string, unknown>): number {
    let mask = 0;
    for (let i = 0; i < 16; i++) {
        if (isValveOn(actionObj[`valve_${i}`])) {
            mask |= (1 << i);
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

/** Resolve write address or null if a non-valve_program key already owns 20 / the mapped addr. */
export function resolveValveProgramAddress(holdingMap: Record<string, number>): number | null {
    const mapped = holdingMap.valve_program;
    const target = mapped !== undefined ? Number(mapped) : VALVE_PROGRAM_DEFAULT_ADDRESS;
    const others = occupyingKeysAtAddress(holdingMap, target).filter(k => k !== 'valve_program');
    if (others.length > 0) return null;
    if (mapped === undefined && occupyingKeysAtAddress(holdingMap, VALVE_PROGRAM_DEFAULT_ADDRESS).length > 0) {
        return null;
    }
    if (mapped === undefined) return VALVE_PROGRAM_DEFAULT_ADDRESS;
    return target;
}

export function buildValveProgramCommand(
    actionObj: Record<string, unknown>,
    holdingMap: Record<string, number>,
    unitid: number = 1
): ModbusCmd | null {
    const address = resolveValveProgramAddress(holdingMap);
    if (address === null) return null;
    return {
        key: 'valve_program',
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
        key: 'valve_program',
        value: 0,
        fc: 6,
        unitid,
        address,
        quantity: 1,
    };
}

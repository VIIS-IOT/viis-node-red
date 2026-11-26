import { ModbusCmd } from './type';

/** `power` or `…_power`, but not `power_1` / `fertigation_control_power_1`. */
export const isSystemPowerKey = (key: string): boolean => /(?:^|_)power$/i.test(key);
export const isChannelPowerKey = (key: string): boolean => /power/i.test(key) && !isSystemPowerKey(key);
export const isPumpKey = (key: string): boolean => /pump/i.test(key);
/** Numbered valve coil: `valve_0` or `fertigation_control_valve_0`, not `time_valve_0`. */
export const isNumberedValveKey = (key: string): boolean => /(?<!time_)valve_\d+$/i.test(key);
export const isValveKey = (key: string): boolean =>
    isNumberedValveKey(key)
    || (/valve_/i.test(key) && !/(?:^|_)time_valve_/i.test(key) && !/(?:^|_)valve_program/i.test(key));

export function classifyCoils<T extends { key: string }>(commands: T[]) {
    const powerCoils = commands.filter(cmd => isSystemPowerKey(cmd.key));
    const pumpCoils = commands.filter(cmd => isPumpKey(cmd.key) || isChannelPowerKey(cmd.key));
    const valveCoils = commands.filter(cmd => isValveKey(cmd.key));
    const otherCoils = commands.filter(cmd =>
        !isSystemPowerKey(cmd.key) && !isChannelPowerKey(cmd.key) && !isPumpKey(cmd.key) && !isValveKey(cmd.key));
    return { powerCoils, pumpCoils, valveCoils, otherCoils };
}

/** Fertigation main pumps (`main_pump`, `input_pump`, prefixed or not): the board can start them on power. */
export const isAutoStartPumpKey = (key: string): boolean => /(?:^|_)(main_pump|input_pump)$/i.test(key);

/**
 * Pumps a finishing schedule must also stop although it never wrote them: the firmware often auto-starts the
 * main pump when the system power turns on, so a schedule that switched the system power stops the mapped
 * main/input pumps. Nothing else: other pumps (sub/water pumps run by their own schedules) and pump status/error
 * coils are left alone. Stopping every coil named "pump" cut a running sub pump at the end of each unrelated
 * irrigation (Fertigation-VIIS-RS485-007, 2026-10-29 and 2026-11-26).
 */
export function impliedFinishPumpCommands(
    commands: Array<{ key: string; fc: number; address: number; boardId?: string }>,
    coilMap: Record<string, number>,
    unitid: number = 1,
    /** Multi-board: board owning a key. Same address on another board is a different coil. */
    boardOf?: (key: string) => string | undefined
): ModbusCmd[] {
    if (!commands.some(cmd => isSystemPowerKey(cmd.key))) return [];
    const sameTarget = (cmd: { boardId?: string }, key: string) =>
        !boardOf || (cmd.boardId ?? undefined) === boardOf(key);
    return Object.entries(coilMap)
        .filter(([key]) => isAutoStartPumpKey(key))
        .filter(([key, address]) =>
            !commands.some(cmd => cmd.key === key
                || (cmd.fc === 5 && Number(cmd.address) === Number(address) && sameTarget(cmd, key)))
        )
        .map(([key, address]) => ({
            key,
            value: false,
            fc: 5,
            unitid,
            address: Number(address),
            quantity: 1,
        }));
}

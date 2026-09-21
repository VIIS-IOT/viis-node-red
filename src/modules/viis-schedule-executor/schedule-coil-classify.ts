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

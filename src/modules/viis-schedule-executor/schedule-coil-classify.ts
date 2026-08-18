export const isSystemPowerKey = (key: string): boolean => key === 'power';
export const isChannelPowerKey = (key: string): boolean => key.includes('power') && key !== 'power';
export const isPumpKey = (key: string): boolean => key.includes('pump');
export const isValveKey = (key: string): boolean => key.includes('valve_');

export function classifyCoils<T extends { key: string }>(commands: T[]) {
    const powerCoils = commands.filter(cmd => isSystemPowerKey(cmd.key));
    const pumpCoils = commands.filter(cmd => isPumpKey(cmd.key) || isChannelPowerKey(cmd.key));
    const valveCoils = commands.filter(cmd => isValveKey(cmd.key));
    const otherCoils = commands.filter(cmd =>
        !isSystemPowerKey(cmd.key) && !isChannelPowerKey(cmd.key) && !isPumpKey(cmd.key) && !isValveKey(cmd.key));
    return { powerCoils, pumpCoils, valveCoils, otherCoils };
}

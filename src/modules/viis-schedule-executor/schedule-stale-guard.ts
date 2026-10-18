/**
 * Power-recovery check: a "running" schedule with no stored active commands is stale
 * only if its START would write Modbus. A config-only start never stores commands,
 * so treating it as stale restarts it on every tick.
 */
export function isStaleRunningSchedule(
    status: string | null | undefined,
    activeCommandCount: number,
    hasWritableCommands: () => boolean
): boolean {
    if (status !== "running" || activeCommandCount > 0) {
        return false;
    }
    return hasWritableCommands();
}

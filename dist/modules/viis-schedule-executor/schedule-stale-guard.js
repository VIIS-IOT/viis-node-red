"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStaleRunningSchedule = isStaleRunningSchedule;
/**
 * Power-recovery check: a "running" schedule with no stored active commands is stale
 * only if its START would write Modbus. A config-only start never stores commands,
 * so treating it as stale restarts it on every tick.
 */
function isStaleRunningSchedule(status, activeCommandCount, hasWritableCommands) {
    if (status !== "running" || activeCommandCount > 0) {
        return false;
    }
    return hasWritableCommands();
}
